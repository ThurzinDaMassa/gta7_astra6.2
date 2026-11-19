import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const unitBox = new THREE.BoxGeometry()
const wheelCylinder = new THREE.CylinderGeometry(1, 1, 1, 16)
const surface = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.64,
  metalness: 0.14,
})
const glass = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.22,
  metalness: 0.5,
})
const shadowPlane = new THREE.PlaneGeometry(1, 1)
const shadowSurface = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  vertexShader:
    'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:
    'varying vec2 vUv; void main(){vec2 p=abs(vUv*2.-1.);float radius=pow(pow(p.x,3.)+pow(p.y,3.),1./3.);gl_FragColor=vec4(.12,.095,.115,.34*(1.-smoothstep(.47,1.,radius)));}',
})
function contactShadow(width: number, length: number) {
  const mesh = new THREE.Mesh(shadowPlane, shadowSurface)
  mesh.name = 'contactShadow'
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.set(width, length, 1)
  mesh.position.set(0.13, 0.056, -0.08)
  return mesh
}

// Bake fixed parts into one colored mesh. The moving limb groups retain independent pivots.
class Parts {
  private shapes: THREE.BufferGeometry[] = []
  add(
    geometry: THREE.BufferGeometry,
    xyz: number[],
    size: number[],
    color: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    g.deleteAttribute('uv')
    g.scale(size[0], size[1], size[2])
    g.rotateX(rx)
    g.rotateY(ry)
    g.rotateZ(rz)
    g.translate(xyz[0], xyz[1], xyz[2])
    const tint = new THREE.Color(color),
      rgb = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < rgb.length; i += 3) {
      rgb[i] = tint.r
      rgb[i + 1] = tint.g
      rgb[i + 2] = tint.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
    this.shapes.push(g)
  }
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    c: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ) {
    this.add(unitBox, [x, y, z], [w, h, d], c, rx, ry, rz)
  }
  finish(material = surface) {
    const g = mergeGeometries(this.shapes)!
    this.shapes.forEach((shape) => shape.dispose())
    const mesh = new THREE.Mesh(g, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }
}

// Successive cross sections give the coupe tapered bumpers and sloping glazing.
function hull(rings: number[][]) {
  const points: number[] = []
  const ring = ([z, w, lo, hi, topW]: number[]) => [
    [-w, lo, z],
    [-topW, hi, z],
    [topW, hi, z],
    [w, lo, z],
  ]
  const sections = rings.map(ring)
  function face(a: number[], b: number[], c: number[], d: number[]) {
    points.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1],
      b = sections[i]
    for (let j = 0; j < 4; j++) face(a[j], b[j], b[(j + 1) % 4], a[(j + 1) % 4])
  }
  const a = sections[0],
    b = sections[sections.length - 1]
  face(a[0], a[1], a[2], a[3])
  face(b[3], b[2], b[1], b[0])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  g.computeVertexNormals()
  return g
}

// Octagonal horizontal sections keep broad cloth panels and bevel the silhouette.
function tailoredPart(parts: Parts, sections: number[][], color: number) {
  const outline = [
    [-0.68, 1],
    [0.68, 1],
    [1, 0.52],
    [1, -0.48],
    [0.68, -1],
    [-0.68, -1],
    [-1, -0.48],
    [-1, 0.52],
  ]
  const points: number[] = []
  const rings = sections.map(([y, w, d, z = 0]) =>
    outline.map(([sx, sz]) => [sx * w, y, sz * d + z]),
  )
  for (let i = 1; i < rings.length; i++) {
    const low = rings[i - 1],
      high = rings[i]
    for (let j = 0; j < 8; j++) {
      const k = (j + 1) % 8
      points.push(
        ...low[j],
        ...low[k],
        ...high[k],
        ...low[j],
        ...high[k],
        ...high[j],
      )
    }
  }
  for (let i = 1; i < 7; i++) {
    points.push(...rings[0][0], ...rings[0][i + 1], ...rings[0][i])
    const last = rings[rings.length - 1]
    points.push(...last[0], ...last[i], ...last[i + 1])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  g.computeVertexNormals()
  parts.add(g, [0, 0, 0], [1, 1, 1], color)
  g.dispose()
}

const cars = new Map<string, THREE.Group>()
export function createCar(color: number, police = false): THREE.Group {
  const key = color + '/' + police
  const cached = cars.get(key)
  if (cached) return cached.clone()
  const model = new THREE.Group(),
    p = new Parts(),
    windows = new Parts()
  const paint = police ? 0x273742 : color,
    dark = 0x1a2125,
    trim = 0x434b4c,
    silver = 0xcdcec3
  const sculpt = (parts: Parts, rings: number[][], tint: number) => {
    const shape = hull(rings)
    parts.add(shape, [0, 0, 0], [1, 1, 1], tint)
    shape.dispose()
  }
  sculpt(
    p,
    [
      [-2.3, 0.84, 0.39, 0.76, 0.86],
      [-1.9, 0.96, 0.34, 0.9, 0.9],
      [-0.35, 0.98, 0.33, 0.91, 0.93],
      [0.85, 0.99, 0.34, 0.82, 0.93],
      [2.24, 0.87, 0.39, 0.69, 0.86],
    ],
    paint,
  )
  sculpt(
    windows,
    [
      [-1.37, 0.84, 0.87, 0.89, 0.83],
      [-0.78, 0.83, 0.88, 1.42, 0.69],
      [0.12, 0.85, 0.86, 1.43, 0.7],
      [0.92, 0.9, 0.81, 0.83, 0.89],
    ],
    0x416773,
  )
  p.box(0, 1.435, -0.33, 1.42, 0.055, 0.95, paint)
  for (const side of [-1, 1]) {
    p.box(
      side * 0.78,
      1.1,
      0.53,
      0.055,
      0.76,
      0.08,
      paint,
      -0.9,
      0,
      side * 0.16,
    )
    p.box(
      side * 0.76,
      1.12,
      -1.04,
      0.09,
      0.69,
      0.08,
      paint,
      0.81,
      0,
      side * 0.15,
    )
    p.box(side * 0.77, 1.155, -0.5, 0.052, 0.52, 0.105, dark, 0, 0, side * 0.23)
    p.box(side * 0.971, 0.55, -0.04, 0.03, 0.055, 3.92, dark)
    p.box(side * 0.953, 0.82, -0.4, 0.04, 0.048, 0.2, silver)
    p.box(side * 0.966, 0.91, 0.42, 0.24, 0.105, 0.19, paint)
    p.box(side * 0.53, 0.65, 2.235, 0.49, 0.16, 0.05, 0xffefb8)
    p.box(side * 0.81, 0.655, 2.206, 0.12, 0.14, 0.065, 0xffad44)
    p.box(side * 0.58, 0.65, -2.3, 0.47, 0.145, 0.044, 0xe94b39)
    p.box(side * 0.86, 0.65, -2.27, 0.11, 0.13, 0.05, 0xffae51)
    p.box(side * 0.6, 0.38, -2.29, 0.15, 0.09, 0.15, trim)
    if (police) p.box(side * 0.98, 0.66, -0.04, 0.02, 0.27, 1.16, 0xe6e5d6)
    for (const z of [-1.42, 1.39]) {
      p.add(
        wheelCylinder,
        [side * 0.933, 0.395, z],
        [0.395, 0.19, 0.395],
        0x1e2224,
        0,
        0,
        Math.PI / 2,
      )
      p.add(
        wheelCylinder,
        [side * 1.034, 0.395, z],
        [0.27, 0.018, 0.27],
        silver,
        0,
        0,
        Math.PI / 2,
      )
      p.add(
        wheelCylinder,
        [side * 1.048, 0.395, z],
        [0.212, 0.02, 0.212],
        0x303a3d,
        0,
        0,
        Math.PI / 2,
      )
      for (let i = 0; i < 5; i++) {
        const angle = (i * Math.PI) / 5
        p.box(side * 1.063, 0.395, z, 0.015, 0.39, 0.032, silver, angle)
      }
      p.add(
        wheelCylinder,
        [side * 1.074, 0.395, z],
        [0.08, 0.02, 0.08],
        0x939991,
        0,
        0,
        Math.PI / 2,
      )
    }
  }
  p.box(0, 0.444, -2.3, 1.78, 0.095, 0.09, dark)
  p.box(0, 0.44, 2.25, 1.75, 0.09, 0.09, dark)
  p.box(0, 0.62, 2.247, 0.44, 0.12, 0.032, dark)
  p.box(0, 0.61, -2.325, 0.36, 0.115, 0.02, 0xf7e7ba)
  for (let i = 0; i < 5; i++)
    p.box(
      0,
      0.93 + i * 0.083,
      -1.32 + i * 0.097,
      1.55 - i * 0.042,
      0.042,
      0.085,
      dark,
    )
  p.box(-0.56, 0.91, -1.93, 0.07, 0.13, 0.12, dark)
  p.box(0.56, 0.91, -1.93, 0.07, 0.13, 0.12, dark)
  p.box(0, 0.993, -1.97, 1.88, 0.08, 0.25, paint)
  if (police) {
    p.box(0, 1.51, -0.3, 1.12, 0.1, 0.25, dark)
    p.box(-0.31, 1.59, -0.3, 0.5, 0.13, 0.24, 0xff322d)
    p.box(0.31, 1.59, -0.3, 0.5, 0.13, 0.24, 0x3688ff)
  }
  model.add(p.finish(), windows.finish(glass), contactShadow(3.02, 5.4))
  cars.set(key, model)
  return model.clone()
}

const people = new Map<number, THREE.Group>()
export function createPerson(variant: number): THREE.Group {
  const idx = Math.abs(Math.trunc(variant)) % 8,
    cached = people.get(idx)
  if (cached) return cached.clone()
  const person = new THREE.Group(),
    p = new Parts()
  const coat = [
    0x1b7e82, 0xedaa4d, 0xf1d7b6, 0xcd6754, 0x78849c, 0x576e61, 0xa07789,
    0x284659,
  ][idx]
  const skin = [0xac7153, 0xca9670, 0x885b46, 0xbe8867][idx % 4]
  const pants = idx === 1 ? 0x646957 : 0x283541,
    hair = 0x302722
  tailoredPart(
    p,
    [
      [0.88, 0.201, 0.132],
      [0.95, 0.224, 0.148],
      [1.16, 0.222, 0.153],
      [1.38, 0.266, 0.152],
      [1.44, 0.25, 0.115],
      [1.48, 0.113, 0.1],
    ],
    coat,
  )
  tailoredPart(
    p,
    [
      [0.83, 0.206, 0.133],
      [0.915, 0.203, 0.14],
    ],
    pants,
  )
  p.box(0, 1.19, 0.151, 0.17, 0.5, 0.02, 0xede5cf)
  p.box(0, 1.49, 0, 0.18, 0.16, 0.19, skin)
  tailoredPart(
    p,
    [
      [1.511, 0.092, 0.088, 0.032],
      [1.55, 0.132, 0.115, 0.02],
      [1.65, 0.157, 0.143],
      [1.78, 0.155, 0.138],
      [1.82, 0.12, 0.118],
    ],
    skin,
  )
  tailoredPart(
    p,
    [
      [1.77, 0.161, 0.138, -0.009],
      [1.84, 0.169, 0.157, -0.007],
      [1.897, 0.129, 0.12, -0.026],
    ],
    hair,
  )
  p.box(0, 1.73, -0.124, 0.233, 0.15, 0.056, hair)
  p.box(-0.106, 1.8, 0.118, 0.14, 0.09, 0.09, hair, 0, 0, -0.18)
  for (const s of [-1, 1]) {
    p.box(s * 0.158, 1.67, 0, 0.05, 0.086, 0.068, skin)
    p.box(s * 0.08, 1.705, 0.138, 0.053, 0.025, 0.018, 0x413733)
    p.box(s * 0.067, 1.73, 0.14, 0.085, 0.018, 0.01, hair)
  }
  p.box(0, 1.665, 0.15, 0.055, 0.073, 0.052, skin)
  if (idx === 0) {
    p.box(0, 1.25, -0.15, 0.3, 0.18, 0.013, 0xf0dac1)
    p.box(0, 1.25, -0.161, 0.252, 0.135, 0.013, 0xd68050)
    for (let n = 0; n < 3; n++)
      p.box(0, 1.205 + n * 0.028, -0.17, 0.25, 0.012, 0.013, coat)
    p.box(-0.07, 1.255, -0.177, 0.017, 0.11, 0.012, 0x194a51, 0, 0, -0.23)
    p.box(-0.07, 1.3, -0.177, 0.11, 0.018, 0.012, 0x194a51, 0, 0, -0.22)
  }
  person.add(p.finish(), contactShadow(1.23, 1.03))
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(),
      l = new Parts()
    leg.name = s < 0 ? 'leftLeg' : 'rightLeg'
    leg.position.set(s * 0.108, 0.882, 0)
    tailoredPart(
      l,
      [
        [-0.737, 0.078, 0.097],
        [-0.57, 0.088, 0.105],
        [-0.41, 0.096, 0.11, 0.008],
        [-0.25, 0.1, 0.12],
        [0.014, 0.108, 0.132],
      ],
      pants,
    )
    l.box(0, -0.746, 0.011, 0.155, 0.095, 0.201, 0x989b94)
    l.box(0, -0.8, 0.047, 0.194, 0.112, 0.31, 0xe4dcc8)
    l.box(0, -0.86, 0.05, 0.202, 0.043, 0.32, 0x977457)
    leg.add(l.finish())
    person.add(leg)
    const arm = new THREE.Group(),
      a = new Parts()
    arm.name = s < 0 ? 'leftArm' : 'rightArm'
    arm.position.set(s * 0.294, 1.41, 0)
    tailoredPart(
      a,
      [
        [-0.245, 0.074, 0.096],
        [-0.12, 0.086, 0.109],
        [0.006, 0.094, 0.107],
        [0.057, 0.063, 0.075],
      ],
      coat,
    )
    tailoredPart(
      a,
      [
        [-0.297, 0.071, 0.09, 0.009],
        [-0.235, 0.078, 0.101, 0.004],
      ],
      0xc3d0bc,
    )
    tailoredPart(
      a,
      [
        [-0.515, 0.052, 0.062, 0.033],
        [-0.395, 0.067, 0.078, 0.02],
        [-0.293, 0.065, 0.078, 0.011],
      ],
      skin,
    )
    a.box(0, -0.55, 0.03, 0.115, 0.095, 0.133, skin)
    arm.add(a.finish())
    arm.rotation.z = s * 0.058
    person.add(arm)
  }
  people.set(idx, person)
  return person.clone()
}

const Y = new THREE.Vector3(0, 1, 0)
const wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v))
const blend = (dt: number, rate: number) => 1 - Math.exp(-rate * dt)
const down = { x: 0, y: -1, z: 0 }

export class Actors {
  readonly person = createPerson(0)
  readonly car = createCar(0xd65236)
  private body: RAPIER.RigidBody
  private vehicle: RAPIER.RigidBody
  private world: RAPIER.World
  private driving = false
  private yaw = Math.PI
  private viewYaw = Math.PI
  private pitch = 0.055
  private orbitTime = 0
  private cameraReady = false
  private walkTime = 0
  private walking = 0
  private shadowHeight = 0.056
  private jumpDown = false
  private lean = 0
  private leanZ = 0
  private wheelSpeed = 0
  private location = new THREE.Vector3(5, 1, 14)
  private carLocation = new THREE.Vector3(1.6, 0.8, 10.2)
  private cameraTarget = new THREE.Vector3()
  private arms: THREE.Object3D[]
  private legs: THREE.Object3D[]

  constructor(scene: THREE.Scene, physics: RAPIER.World) {
    this.world = physics
    this.body = physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(5, 1, 14)
        .lockRotations()
        .setCcdEnabled(true)
        .setCanSleep(false),
    )
    physics.createCollider(
      RAPIER.ColliderDesc.capsule(0.565, 0.32).setFriction(0).setRestitution(0),
      this.body,
    )
    this.vehicle = physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(1.6, 0.81, 10.2)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(Y, -2.39))
        .enabledRotations(false, true, false)
        .setAngularDamping(4)
        .setCcdEnabled(true)
        .setCanSleep(false),
    )
    physics.createCollider(
      RAPIER.ColliderDesc.cuboid(0.96, 0.32, 2.21)
        .setMass(980)
        .setFriction(0.3)
        .setRestitution(0.04),
      this.vehicle,
    )
    this.legs = ['leftLeg', 'rightLeg'].map(
      (n) => this.person.getObjectByName(n)!,
    )
    this.arms = ['leftArm', 'rightArm'].map(
      (n) => this.person.getObjectByName(n)!,
    )
    scene.add(this.person, this.car)
  }
  get position() {
    return this.location
  }
  get carCollider() {
    return this.vehicle.collider(0)
  }
  get carPosition() {
    return this.carLocation
  }
  get inCar() {
    return this.driving
  }
  get speed() {
    return Math.round(Math.abs(this.wheelSpeed) * 3.6)
  }
  get nearCar() {
    return (
      Math.hypot(
        this.location.x - this.carLocation.x,
        this.location.z - this.carLocation.z,
      ) < 7.4
    )
  }
  get heading() {
    return this.driving ? this.carYaw() : this.yaw
  }
  private carYaw() {
    const q = this.vehicle.rotation()
    return Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.x * q.x + q.y * q.y),
    )
  }
  orbit(dx: number, dy: number) {
    this.viewYaw -= dx * 0.0045
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.003, -0.04, 0.83)
    this.orbitTime = 2
  }
  reset() {
    this.driving = false
    this.body.setEnabled(true)
    this.person.visible = true
    this.body.setTranslation({ x: 5, y: 1.15, z: 14 }, true)
    this.vehicle.setTranslation({ x: 1.6, y: 0.85, z: 10.2 }, true)
    this.vehicle.setRotation(
      new THREE.Quaternion().setFromAxisAngle(Y, -2.39),
      true,
    )
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.vehicle.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.vehicle.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.yaw = this.viewYaw = Math.PI
    this.pitch = 0.055
    this.cameraReady = false
    this.location.set(5, 1.15, 14)
    this.carLocation.set(1.6, 0.85, 10.2)
    this.wheelSpeed = 0
  }
  toggleCar() {
    if (this.driving) {
      const p = this.vehicle.translation(),
        angle = this.carYaw()
      for (const offset of [
        [1.85, 0],
        [-1.85, 0],
        [0, -3.1],
        [0, 3.1],
      ]) {
        const x =
          p.x + Math.cos(angle) * offset[0] + Math.sin(angle) * offset[1]
        const z =
          p.z - Math.sin(angle) * offset[0] + Math.cos(angle) * offset[1]
        const pos = { x, y: p.y + 0.3, z }
        if (
          this.world.intersectionWithShape(
            pos,
            { x: 0, y: 0, z: 0, w: 1 },
            new RAPIER.Capsule(0.54, 0.31),
            undefined,
            undefined,
            undefined,
            this.vehicle,
          )
        )
          continue
        this.body.setEnabled(true)
        this.body.setTranslation(pos, true)
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        this.person.visible = true
        this.driving = false
        this.yaw = angle
        break
      }
    } else if (this.nearCar) {
      this.body.setEnabled(false)
      this.person.visible = false
      this.driving = true
      this.orbitTime = 0
    }
  }
  update(dt: number, keys: Set<string>) {
    if (this.location.y < -15 || this.carLocation.y < -15) this.reset()
    this.orbitTime = Math.max(0, this.orbitTime - dt)
    const axis = (positive: string[], negative: string[]) =>
      Number(positive.some((k) => keys.has(k))) -
      Number(negative.some((k) => keys.has(k)))
    const forward = axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
      side = axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft'])
    const space = keys.has('Space')
    if (!this.driving) {
      const p = this.body.translation(),
        v = this.body.linvel()
      const floor = this.world.castRay(
        new RAPIER.Ray(p, down),
        1.02,
        true,
        undefined,
        undefined,
        undefined,
        this.body,
      )
      const ground = Boolean(floor)
      this.shadowHeight = ground ? 0.056 : Math.min(0.056, 0.886 - p.y + 0.056)
      const haste = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 7.4 : 3.85
      const m = Math.hypot(forward, side) || 1,
        cs = Math.cos(this.viewYaw),
        sn = Math.sin(this.viewYaw)
      const tx = ((forward * sn - side * cs) * haste) / m,
        tz = ((forward * cs + side * sn) * haste) / m
      const k = blend(dt, ground ? 16 : 4)
      this.body.setLinvel(
        {
          x: THREE.MathUtils.lerp(v.x, tx, k),
          y: ground && space && !this.jumpDown ? 6.2 : v.y,
          z: THREE.MathUtils.lerp(v.z, tz, k),
        },
        true,
      )
      this.walking = Math.hypot(v.x, v.z)
      if (forward || side)
        this.yaw += wrap(Math.atan2(tx, tz) - this.yaw) * blend(dt, 14)
      this.walkTime += dt * this.walking * 2.8
    }
    this.jumpDown = space
    const p = this.vehicle.translation(),
      v = this.vehicle.linvel(),
      angle = this.carYaw(),
      sn = Math.sin(angle),
      cs = Math.cos(angle)
    const ray = this.world.castRay(
      new RAPIER.Ray(p, down),
      1.4,
      true,
      undefined,
      undefined,
      undefined,
      this.vehicle,
    )
    const onRoad = ray !== null && ray.timeOfImpact < 1.1
    let longitudinal = v.x * sn + v.z * cs,
      lateral = v.x * cs - v.z * sn
    this.wheelSpeed = longitudinal
    let vy = v.y
    if (ray) {
      // A damped vertical spring carries the chassis above the road surface.
      vy +=
        THREE.MathUtils.clamp(
          (0.78 - ray.timeOfImpact) * 115 - v.y * 16 + 9.81,
          -28,
          50,
        ) * dt
    }
    let turn = 0
    if (onRoad) {
      if (this.driving && forward) {
        const braking = forward * longitudinal < -0.5
        const force = braking ? 19 : forward > 0 ? 10.8 : 6.8
        longitudinal = THREE.MathUtils.clamp(
          longitudinal + forward * force * dt,
          -11,
          43,
        )
      }
      const brake = this.driving && space
      longitudinal *= Math.exp(-dt * (brake ? 2.6 : this.driving ? 0.12 : 1.55))
      lateral *= Math.exp(-dt * (brake ? 2.6 : 11))
      turn = this.driving
        ? (-side *
            Math.sign(longitudinal) *
            Math.min(Math.abs(longitudinal) * 0.15, 1.38)) /
          (1 + Math.abs(longitudinal) * 0.018)
        : 0
      this.vehicle.setAngvel({ x: 0, y: turn, z: 0 }, true)
    }
    this.vehicle.setLinvel(
      {
        x: sn * longitudinal + cs * lateral,
        y: vy,
        z: cs * longitudinal - sn * lateral,
      },
      true,
    )
    this.lean = THREE.MathUtils.lerp(
      this.lean,
      this.driving && onRoad ? forward * 0.023 : 0,
      blend(dt, 6),
    )
    this.leanZ = THREE.MathUtils.lerp(
      this.leanZ,
      turn * longitudinal * 0.002,
      blend(dt, 7),
    )
    if (this.driving && this.orbitTime === 0)
      this.viewYaw += wrap(angle - this.viewYaw) * blend(dt, 3.1)
  }
  sync(dt: number, camera: THREE.PerspectiveCamera) {
    const p = this.body.translation(),
      v = this.vehicle.translation(),
      angle = this.carYaw()
    this.carLocation.set(v.x, v.y, v.z)
    this.car.position.set(v.x, v.y - 0.78, v.z)
    this.car.rotation.set(this.lean, angle, this.leanZ, 'YXZ')
    this.person.position.set(p.x, p.y - 0.885, p.z)
    this.person.rotation.y = this.yaw
    this.person.getObjectByName('contactShadow')!.position.y = this.shadowHeight
    const swing = Math.sin(this.walkTime) * Math.min(this.walking * 0.134, 0.82)
    this.legs[0].rotation.x = swing
    this.legs[1].rotation.x = -swing
    this.arms[0].rotation.x = -swing * 0.79
    this.arms[1].rotation.x = swing * 0.79
    if (this.driving) this.location.copy(this.carLocation)
    else this.location.set(p.x, p.y, p.z)
    const sn = Math.sin(this.viewYaw),
      cs = Math.cos(this.viewYaw)
    const range = this.driving ? 8.8 + Math.abs(this.wheelSpeed) * 0.033 : 5.1
    const target = this.location.clone()
    target.y += this.driving ? 0.75 : 0.52
    const offset = new THREE.Vector3(
      -sn * range,
      (this.driving ? 1.85 : 1.05) + Math.sin(this.pitch) * range,
      -cs * range,
    )
    offset.x += cs * (this.driving ? 0 : 0.75)
    offset.z -= sn * (this.driving ? 0 : 0.75)
    const length = offset.length()
    const ray = this.world.castRay(
      new RAPIER.Ray(target, offset.clone().normalize()),
      length,
      true,
      undefined,
      undefined,
      undefined,
      this.driving ? this.vehicle : this.body,
    )
    if (ray)
      offset.multiplyScalar(Math.max(0.25, ray.timeOfImpact - 0.22) / length)
    const desired = target.clone().add(offset)
    target.x += sn * (this.driving ? 3.2 : 1.6)
    target.z += cs * (this.driving ? 3.2 : 1.6)
    target.y += this.driving ? 0.48 : 0.55
    const k = this.cameraReady ? blend(dt, 9) : 1
    camera.position.lerp(desired, k)
    this.cameraTarget.lerp(target, k)
    camera.lookAt(this.cameraTarget)
    this.cameraReady = true
  }
}
