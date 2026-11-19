import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

export const ROADS = [-240, -160, -80, 0, 80, 160, 240]

export function district(x: number, z: number): string {
  if (Math.abs(z - 240) < 8 && x < 247) return 'Via Costeira'
  if (x > 202) return 'Orla do Sol'
  if (z > 157 && x < -44) return 'Porto Industrial'
  if (x < -144 || z > 87) return 'Vila das Flores'
  if (x < -32 && z < 76) return 'Centro Financeiro'
  return 'Costa Dourada'
}

type Instance = { matrix: THREE.Matrix4; color: THREE.Color }
type Shape = 'box' | 'road' | 'round' | 'trunk' | 'crown' | 'leaf' | 'roof'

/** One faceted palm frond, including a spine and individual pointed leaflets. */
function frondGeometry() {
  const vertices: number[] = []
  const spine = (t: number) =>
    new THREE.Vector3(t, 0.19 * Math.sin(t * Math.PI) - 0.15 * t * t, 0)
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) =>
    vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray())
  for (let i = 0; i < 11; i++) {
    const t = i / 11,
      a = spine(t),
      b = spine((i + 1) / 11)
    for (const side of [-1, 1]) {
      const width = 0.018 + 0.128 * Math.sin(Math.PI * (0.1 + t * 0.88))
      const ridge = a.clone().add(new THREE.Vector3(0, 0.012, side * 0.03))
      const tip = a
        .clone()
        .add(new THREE.Vector3(0.12, -width * 0.63, width * side))
      triangle(a, ridge, tip)
      triangle(ridge, b, tip)
      triangle(a, b, ridge)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geo.computeVertexNormals()
  return geo
}

export function buildWorld(scene: THREE.Scene, physics: RAPIER.World) {
  let seed = 12587
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const pick = <T>(values: T[]) => values[Math.floor(rand() * values.length)]
  const meshMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    flatShading: true,
  })
  const frondMaterial = meshMaterial.clone()
  frondMaterial.side = THREE.DoubleSide
  const roadMaterial = meshMaterial.clone()
  // World-space aggregate, faded tire tracks and repairs stay continuous across intersections.
  roadMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'varying vec3 pavement;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\npavement = (instanceMatrix * vec4(position,1.)).xyz;',
      )
    shader.fragmentShader =
      'varying vec3 pavement;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 p=pavement.xz;
        float grain=fract(sin(dot(floor(p*34.),vec2(21.17,55.31)))*4187.);
        vec2 center=abs(mod(p+40.,80.)-40.);
        float t=min(center.x,center.y);
        float track=exp(-3.*abs(t-1.25))+exp(-3.*abs(t-2.72))+exp(-3.*abs(t-5.15))+exp(-3.*abs(t-6.62));
        float coarse=sin(p.x*.31+p.y*.21)*sin(p.y*.43-p.x*.13);
        diffuseColor.rgb*=1.+.12*(grain-.5)*clamp(1.-length(fwidth(p))*4.,0.,1.)+.026*coarse-.062*track;`,
      )
  }
  const shapes: Record<Shape, THREE.BufferGeometry> = {
    box: new THREE.BoxGeometry(),
    road: new THREE.BoxGeometry(),
    round: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    trunk: new THREE.CylinderGeometry(0.43, 0.5, 1, 8),
    crown: new THREE.IcosahedronGeometry(0.5, 0),
    leaf: frondGeometry(),
    roof: new THREE.CylinderGeometry(0, 0.71, 1, 4, 1, false, Math.PI / 4),
  }
  const batches = new Map<string, Instance[]>()
  const transform = new THREE.Object3D()
  function add(
    shape: Shape,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
    ry = 0,
    rz = 0,
    rx = 0,
  ) {
    transform.position.set(x, y, z)
    transform.rotation.set(rx, ry, rz, 'YXZ')
    transform.scale.set(w, h, d)
    transform.updateMatrix()
    // Spatial batches allow Three.js to cull whole blocks outside the camera.
    const key = shape + ':' + Math.floor(x / 96) + ':' + Math.floor(z / 96)
    if (!batches.has(key)) batches.set(key, [])
    batches
      .get(key)!
      .push({ matrix: transform.matrix.clone(), color: new THREE.Color(color) })
  }
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: string,
    ry = 0,
  ) => add('box', x, y, z, w, h, d, color, ry)
  function solid(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) {
    physics.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setTranslation(x, y, z)
        .setFriction(0.76),
    )
  }

  scene.fog = new THREE.FogExp2(0xf2d7bf, 0.0027)
  scene.background = new THREE.Color(0x9bced8)
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1100, 48, 28),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 vDir; void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_Position.z=gl_Position.w;}',
      fragmentShader: `
      varying vec3 vDir;
      float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.545);}
      float noise(vec2 p){vec2 f=fract(p);f=f*f*(3.-2.*f);vec2 i=floor(p);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
      void main(){
        vec3 n=normalize(vDir);float h=max(n.y,0.);
        vec3 c=mix(vec3(.94,.82,.70),vec3(.61,.79,.84),smoothstep(-.02,.24,h));
        c=mix(c,vec3(.25,.55,.72),smoothstep(.12,.86,h));
        vec2 p=n.xz/max(.08,n.y+.10);p*=vec2(2.1,7.4);
        float cloud=noise(p)*.57+noise(p*2.04)*.29+noise(p*4.15)*.14;
        c=mix(c,vec3(1.,.94,.84),smoothstep(.60,.83,cloud)*.52*smoothstep(.01,.13,h));
        float s=max(dot(n,normalize(vec3(-.57,.36,-1.))),0.);
        c+=vec3(.16,.10,.035)*pow(s,12.);c=mix(c,vec3(1.,.965,.81),smoothstep(.9988,.99955,s));
        gl_FragColor=vec4(c,1.);
      }`,
    }),
  )
  sky.frustumCulled = false
  sky.renderOrder = -10
  scene.add(sky)
  scene.add(new THREE.HemisphereLight(0xe5f4ff, 0xc5babb, 1.84))
  const sun = new THREE.DirectionalLight(0xffe6c7, 2.15)
  sun.position.set(-100, 115, 72)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, {
    left: -65,
    right: 65,
    top: 65,
    bottom: -65,
    near: 1,
    far: 290,
  })
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.normalBias = 0.045
  sun.shadow.bias = -0.00025
  scene.add(sun, sun.target)
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x614d56,
    transparent: true,
    opacity: 0.105,
    depthWrite: false,
  })
  const shadows: THREE.Matrix4[] = []
  function shade(
    x: number,
    z: number,
    width: number,
    depth: number,
    rot = 0,
    y = 0.034,
  ) {
    transform.position.set(x, y, z)
    transform.rotation.set(-Math.PI / 2, 0, rot)
    transform.scale.set(width, depth, 1)
    transform.updateMatrix()
    shadows.push(transform.matrix.clone())
  }

  // Ground and the boulevard/right-of-way bounding the street network.
  box(-15, -0.35, 0, 570, 0.65, 600, '#c8b795')
  solid(0, -1, 0, 640, 2, 600)
  for (const z of [-295, 295]) solid(0, 5, z, 650, 10, 2)
  for (const x of [-294, 314]) solid(x, 5, 0, 2, 10, 600)
  box(286, -0.09, 0, 64, 0.19, 600, '#e9cda2')
  box(567, -0.16, 0, 510, 0.18, 1080, '#65b9b5')
  for (let i = 0; i < 270; i++) {
    const x = 315 + rand() * 210,
      z = (rand() - 0.5) * 760
    box(
      x,
      -0.052,
      z,
      0.24 + rand(),
      0.02,
      1 + rand() * 8,
      pick(['#b7dacf', '#8ccac1', '#80c4bf']),
    )
  }
  // Distant headlands and layered pale mountains close the horizon.
  for (let i = 0; i < 40; i++) {
    const x = -650 + i * 28
    add(
      'crown',
      x,
      -10,
      -410 - rand() * 100,
      100 + rand() * 110,
      40 + rand() * 65,
      90,
      pick(['#a4aaa1', '#a0ada7', '#b6b5a2']),
    )
  }
  const asphalt = '#525967',
    stripe = '#dfd8c7',
    gold = '#dec17b'
  for (const road of ROADS) {
    for (const alongZ of [true, false]) {
      const line = (
        s: number,
        off: number,
        y: number,
        length: number,
        width: number,
        color: string,
      ) =>
        box(
          alongZ ? road + off : s,
          y,
          alongZ ? s : road + off,
          alongZ ? width : length,
          0.018,
          alongZ ? length : width,
          color,
        )
      add(
        'road',
        alongZ ? road : 0,
        alongZ ? 0.003 : 0.013,
        alongZ ? 0 : road,
        alongZ ? 16 : 576,
        0.018,
        alongZ ? 576 : 16,
        asphalt,
      )
      for (let s = -280; s < 282; s += 8) {
        if (ROADS.some((v) => Math.abs(v - s) < 12)) continue
        line(s, -0.16, 0.029, 8.05, 0.105, gold)
        line(s, 0.16, 0.029, 8.05, 0.105, gold)
        for (const side of [-1, 1]) {
          line(s, side * 3.9, 0.029, 2.85, 0.11, stripe)
        }
      }
      for (const s of ROADS) {
        for (const direction of [-1, 1]) {
          for (let k = -6.8; k < 7.5; k += 1.38)
            line(s + direction * 9.15, k, 0.036, 2.0, 0.61, '#d6d4ca')
          line(s + direction * 11.3, direction * 3.85, 0.035, 0.26, 7, stripe)
        }
      }
    }
  }

  function palm(
    x: number,
    z: number,
    height: number,
    angle: number,
    physical = true,
  ) {
    const lean = 0.07 + rand() * 0.085,
      ax = Math.cos(angle),
      az = Math.sin(angle)
    let tx = x,
      tz = z
    for (let i = 0; i < 4; i++) {
      const delta = (lean * height * (1.6 - i * 0.24)) / 4
      const width = (0.048 - i * 0.005) * height
      add(
        'trunk',
        tx + (ax * delta) / 2,
        (height * (i + 0.5)) / 4,
        tz + (az * delta) / 2,
        width,
        height / 4 + 0.05,
        width,
        ['#87705b', '#9e8568', '#aa9273', '#aa966e'][i],
        -angle,
        -Math.atan2(delta, height / 4),
      )
      tx += ax * delta
      tz += az * delta
    }
    add(
      'trunk',
      tx,
      height - 0.05,
      tz,
      height * 0.047,
      0.95,
      height * 0.047,
      '#918b51',
    )
    const phase = rand() * 6.28
    for (let k = 0; k < 13; k++) {
      const a = phase + k * 2.399
      const length = height * (0.36 + rand() * 0.16)
      add(
        'leaf',
        tx,
        height + 0.3,
        tz,
        length,
        length,
        length,
        pick([
          '#3f7353',
          '#4b8156',
          '#668b55',
          '#75975c',
          '#426e47',
          '#567b4e',
        ]),
        a,
        k < 4 ? 0.42 + rand() * 0.15 : rand() * 0.22 - 0.21,
      )
    }
    if (physical)
      physics.createCollider(
        RAPIER.ColliderDesc.cylinder(
          height * 0.45,
          height * 0.022,
        ).setTranslation(x, height * 0.45, z),
      )
    shade(x + 1.8, z - 1.25, height * 0.67, height * 0.41, -0.32, 0.205)
  }

  const signs = new Map<string, THREE.MeshBasicMaterial>()
  function sign(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    angle: number,
    label: string,
    bg: string,
    fg: string,
    italic = false,
  ) {
    const key = [label, bg, fg, italic].join('|')
    if (!signs.has(key)) {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 96
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, 512, 96)
      ctx.strokeStyle = fg
      ctx.lineWidth = 2
      ctx.strokeRect(5, 5, 502, 86)
      ctx.fillStyle = fg
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = italic ? 'italic bold 54px Georgia' : 'bold 54px Arial'
      ctx.fillText(label, 256, 51, 480)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      signs.set(key, new THREE.MeshBasicMaterial({ map: texture }))
    }
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      signs.get(key),
    )
    mesh.position.set(x, y, z)
    mesh.rotation.y = angle
    scene.add(mesh)
  }
  const walls = [
    '#edac91',
    '#a5c9c1',
    '#ebcfaa',
    '#e1beb1',
    '#e6ba90',
    '#a7c5ce',
    '#d5bbb8',
    '#e8d9b8',
  ]
  const trims = ['#f3e0bf', '#f4dcbb', '#e9d8be']
  const glass = ['#4f777d', '#557780', '#5d8186', '#79979a', '#67858e']
  function building(
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    kind: string,
    face: number,
    featured = false,
  ) {
    const base = pick(walls),
      main = featured ? (face === 1 ? '#eea185' : '#86c9be') : base
    const trim = pick(trims),
      accent = pick(['#c97761', '#548d87', '#b78273', '#59858b'])
    const win = pick(glass)
    box(x, h / 2 + 0.18, z, w, h, d, main)
    solid(x, h / 2, z, w, h, d)
    box(x, h + 0.12, z, w + 0.48, 0.42, d + 0.54, trim)
    box(x, h + 0.36, z, w - 0.55, 0.18, d - 0.55, '#9b9688')
    shade(x + 1.9, z - 1.4, w * 1.15, d * 1.08, 0, 0.199)
    if (kind === 'apartment' || kind === 'tower') {
      const floors = Math.max(2, Math.floor(h / 3.6))
      for (let f = 1; f < floors; f++) {
        const y = 1.95 + (f * (h - 2.3)) / floors
        for (const orientation of [0, 1]) {
          const span = orientation ? d : w
          const cols = Math.max(
            2,
            Math.round(span / (kind === 'tower' ? 4.9 : 3.9)),
          )
          for (const side of [-1, 1]) {
            if (kind === 'tower') {
              box(
                orientation ? x + side * (w / 2 + 0.02) : x,
                y,
                orientation ? z : z + side * (d / 2 + 0.02),
                orientation ? 0.1 : w - 0.8,
                1.85,
                orientation ? d - 0.8 : 0.1,
                win,
              )
            } else {
              for (let c = 0; c < cols; c++) {
                const local = ((c + 0.5) / cols - 0.5) * span
                box(
                  orientation ? x + side * (w / 2 + 0.035) : x + local,
                  y,
                  orientation ? z + local : z + side * (d / 2 + 0.035),
                  orientation ? 0.12 : 1.8,
                  1.4,
                  orientation ? 1.8 : 0.12,
                  win,
                )
              }
            }
          }
        }
      }
      if (kind === 'tower') {
        const sw = w * 0.78,
          sd = d * 0.78,
          sh = Math.min(6, h * 0.13)
        box(x, h + sh / 2, z, sw, sh, sd, main)
        box(x, h + sh, z, sw + 0.4, 0.29, sd + 0.4, trim)
        for (const side of [-1, 1]) {
          for (let off = -0.36; off <= 0.4; off += 0.18) {
            box(
              x + off * w,
              h / 2,
              z + side * (d / 2 + 0.09),
              0.22,
              h,
              0.25,
              trim,
            )
            box(
              x + side * (w / 2 + 0.09),
              h / 2,
              z + off * d,
              0.25,
              h,
              0.22,
              trim,
            )
          }
        }
      }
    } else if (kind === 'house') {
      add(
        'roof',
        x,
        h + 0.8,
        z,
        w + 0.8,
        1.9,
        d + 0.8,
        pick(['#bb795e', '#8e9591', '#aa8273']),
      )
      for (const dx of [-0.27, 0.27])
        box(x + dx * w, 1.9, z + d / 2 + 0.02, 1.8, 1.3, 0.12, win)
    } else {
      box(x, h - 0.6, z, w + 0.25, 0.35, d + 0.28, accent)
      for (let i = -1; i <= 1; i++)
        box(x + (i * w) / 3.8, 2, z + d / 2 + 0.025, w / 4.7, 2.55, 0.13, win)
    }
    // Storefronts open onto the nearest north-south street.
    for (let col = 0; col < Math.ceil(d / 4); col++) {
      const zz = z + ((col + 0.5) / Math.ceil(d / 4) - 0.5) * d
      box(
        x + face * (w / 2 + 0.03),
        1.62,
        zz,
        0.15,
        2.48,
        d / Math.ceil(d / 4) - 0.55,
        win,
      )
    }
    if (kind !== 'house') {
      box(x + face * (w / 2 + 0.42), 3.08, z, 1.06, 0.34, d + 0.35, accent)
      box(x + face * (w / 2 + 0.91), 3.05, z, 0.13, 0.2, d + 0.35, trim)
      box(x + 1.1, h + 0.94, z - 1.3, 2.4, 1.25, 1.65, '#a3a398')
    }
    if (featured) {
      const left = face === 1
      const color = left ? '#357a79' : '#b76050'
      const label = left ? 'HOTEL MARÉ' : 'CAFÉ LUZ'
      const front = z + d / 2 + 0.13
      for (let i = 0; i < 5; i++) {
        const wx = x + ((i - 2) * (w - 2)) / 5
        const opening = (w - 3.2) / 5
        box(wx, 1.49, front, opening, 2.54, 0.16, '#325e67')
        box(
          wx - opening * 0.45,
          1.49,
          front + 0.11,
          0.085,
          2.56,
          0.1,
          '#dbcdb0',
        )
        box(wx, 2.15, front + 0.12, opening, 0.1, 0.1, '#d8c9a9')
        box(wx + 0.36, 1.5, front + 0.11, 0.07, 2.5, 0.08, '#7d9a96')
      }
      if (!left) {
        for (let i = 0; i < 20; i++) {
          const wx = x - w / 2 + ((i + 0.5) * w) / 20
          const stripeColor = i % 2 ? '#e8d7b7' : '#ce7c63'
          add(
            'box',
            wx,
            3.05,
            front + 0.65,
            w / 20 + 0.008,
            0.13,
            1.56,
            stripeColor,
            0,
            0,
            0.22,
          )
          box(wx, 2.77, front + 1.39, w / 20 + 0.008, 0.24, 0.11, stripeColor)
        }
        for (const dx of [-4.2, 2.8]) {
          add('round', x + dx, 0.98, front + 2.0, 1.32, 0.13, 1.32, '#d6aa7f')
          add('round', x + dx, 0.56, front + 2.0, 0.14, 0.78, 0.14, '#50625d')
          for (const s of [-1, 1]) {
            box(x + dx + s * 0.86, 0.59, front + 2, 0.5, 0.13, 0.53, '#b57f5d')
            box(x + dx + s * 1.11, 0.71, front + 2, 0.11, 0.84, 0.54, '#b57f5d')
          }
        }
      } else {
        box(x, 3.18, front + 0.69, w * 0.81, 0.31, 1.65, '#497f79')
        for (const dx of [-w * 0.35, w * 0.35]) {
          box(x + dx, 1.65, front + 1.24, 0.28, 2.95, 0.28, trim)
          box(x + dx, 0.34, front + 1.24, 0.48, 0.41, 0.46, trim)
        }
      }
      // Raised corner tower and a stepped parapet, classic oceanfront Art Déco.
      const xx = x + face * (w / 2 - 2.3),
        zz = z + d / 2 - 2
      box(xx, h * 0.57, zz, 4.9, h * 1.14, 4.6, main)
      box(xx, h * 1.15, zz, 4.5, 0.55, 4.1, trim)
      for (const offset of [-0.65, 0, 0.65])
        box(
          xx + offset,
          h + 0.55,
          zz + 2.34,
          0.28,
          3.3 - Math.abs(offset),
          0.16,
          trim,
        )
      for (let i = 0; i < 3; i++)
        box(x, h - 1.05 + i * 0.35, z + d / 2, w + 0.35, 0.13, 0.42, trim)
      sign(
        x,
        h - 2.5,
        z + d / 2 + 0.24,
        w * 0.81,
        1.35,
        0,
        label,
        color,
        '#fff0cf',
        left,
      )
      sign(
        x + face * (w / 2 + 0.14),
        4.26,
        z,
        d * 0.7,
        1.25,
        (face * Math.PI) / 2,
        label,
        color,
        '#fff0cf',
        left,
      )
      if (left) {
        const hx = x + face * (w / 2 + 0.7),
          hz = z + d / 2 - 0.65
        box(hx, h * 0.77, hz, 1.38, 6.45, 0.6, color)
        const canvas = document.createElement('canvas')
        canvas.width = 96
        canvas.height = 448
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 96, 448)
        ctx.fillStyle = '#ffddb1'
        ctx.textAlign = 'center'
        ctx.font = 'bold 68px Arial'
        for (let i = 0; i < 5; i++) ctx.fillText('HOTEL'[i], 48, 72 + 82 * i)
        const tex = new THREE.CanvasTexture(canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        const blade = new THREE.Mesh(
          new THREE.PlaneGeometry(1.28, 6.22),
          new THREE.MeshBasicMaterial({ map: tex }),
        )
        blade.position.set(hx, h * 0.77, hz + 0.31)
        scene.add(blade)
      }
    }
  }
  function lamp(x: number, z: number, face: number) {
    add('round', x, 0.52, z, 0.34, 0.8, 0.34, '#676c69')
    add('trunk', x, 3.42, z, 0.19, 6.6, 0.19, '#777d78')
    box(x + face * 0.58, 6.59, z, 1.35, 0.14, 0.14, '#717875')
    box(x + face * 1.21, 6.53, z, 0.72, 0.18, 0.39, '#596565')
    box(x + face * 1.24, 6.42, z, 0.61, 0.04, 0.3, '#e8d8a7')
  }
  function bench(x: number, z: number, face: number) {
    for (const ds of [-0.74, 0.74])
      box(x, 0.47, z + ds, 0.63, 0.55, 0.12, '#505e5c')
    for (let b = 0; b < 3; b++)
      box(x - 0.25 + b * 0.24, 0.77, z, 0.2, 0.12, 2.15, '#b48a68')
    box(x - face * 0.32, 1.11, z, 0.12, 0.35, 2.15, '#aa8064')
  }
  for (let ix = 0; ix < ROADS.length - 1; ix++) {
    for (let iz = 0; iz < ROADS.length - 1; iz++) {
      const x0 = ROADS[ix],
        z0 = ROADS[iz],
        cx = x0 + 40,
        cz = z0 + 40
      const area = district(cx, cz)
      box(cx, 0.085, cz, 63.95, 0.19, 63.95, '#d5c6ae')
      box(
        cx,
        0.174,
        cz,
        54,
        0.025,
        54,
        area === 'Porto Industrial' ? '#aba99c' : '#b4b194',
      )
      for (const side of [-1, 1]) {
        const curbX = cx + side * 31.88,
          curbZ = cz + side * 31.88
        box(curbX, 0.108, cz, 0.24, 0.19, 64, '#e9dac4')
        box(cx, 0.108, curbZ, 64, 0.19, 0.24, '#e9dac4')
        for (let i = -27; i < 29; i += 5) {
          box(cx + side * 29.4, 0.186, cz + i, 5, 0.012, 0.034, '#b5aa97')
          box(cx + i, 0.186, cz + side * 29.4, 0.034, 0.012, 5, '#b5aa97')
        }
      }
      for (const side of [-1, 1]) {
        const face = side
        // Each frontage has its own setback, cornice, roof height and shop windows.
        for (let row = 0; row < 3; row++) {
          const f = cx + side * 40 === 0 && z0 === -80 && row === 2
          const w = 15.3 + rand() * 5,
            d = 13.7 + rand() * 2.5
          const x = cx + side * (26.5 - w / 2),
            z = cz + (row - 1) * 18.5
          let kind: string = 'apartment',
            h = 7.8 + rand() * 6
          if (area === 'Centro Financeiro') {
            kind = 'tower'
            h = 22 + rand() * 49
          } else if (area === 'Vila das Flores') {
            kind = 'house'
            h = 3 + rand() * 3.1
          } else if (area === 'Porto Industrial') {
            kind = 'warehouse'
            h = 5 + rand() * 4
          } else if (rand() < 0.36) {
            kind = 'shop'
            h = 4.7 + rand() * 2.3
          }
          if (f) {
            kind = 'apartment'
            h = face === 1 ? 13.3 : 8.3
          }
          if (Math.abs(x) < 28 && z > -80 && z < 80 && !f) {
            kind = 'apartment'
            h = 5.7 + rand() * 7.4
          }
          building(x, z, w, d, h, kind, face, f)
          if (row === 1 && rand() > 0.68 && !f && kind !== 'house') {
            const name = pick([
              'LIVRARIA',
              'SOLAR',
              'CASA FLORA',
              'MERCADO',
              'ATLÂNTICA',
            ])
            sign(
              x + side * (w / 2 + 0.15),
              3.94,
              z,
              7.1,
              1.1,
              (side * Math.PI) / 2,
              name,
              '#548780',
              '#faf0ca',
            )
          }
        }
        const avenue = cx + side * 40
        for (const off of [-22, 0, 22]) {
          const x = avenue - side * 10.95,
            z = cz + off
          if (
            area !== 'Porto Industrial' &&
            (Math.abs(avenue) <= 1 ||
              avenue >= 160 ||
              (off !== 0 && rand() < 0.53))
          ) {
            box(x, 0.19, z, 1.17, 0.025, 1.17, '#9c967d')
            palm(x, z, 6.2 + rand() * 3.1, rand() * 6.28)
          }
        }
        lamp(avenue - side * 11.5, cz + 11, side)
        if (area !== 'Porto Industrial' && rand() > 0.3)
          bench(avenue - side * 12.3, cz - 6.8, side)
      }
      // Deco pavilion or interior planting makes the central alley legible from cross streets.
      if (area === 'Porto Industrial') {
        for (let i = -2; i <= 2; i++)
          box(
            cx,
            1.35,
            cz + i * 7.9,
            3.6,
            2.3,
            6.1,
            pick(['#949c94', '#b27e68', '#668b88']),
          )
        for (const zz of [-19, 18]) {
          add('round', cx + 4, 2.32, cz + zz, 4.2, 4.4, 4.2, '#b3c3be')
          add('round', cx + 4, 4.58, cz + zz, 4.28, 0.18, 4.28, '#768d89')
          solid(cx + 4, 2.2, cz + zz, 3.8, 4.4, 3.8)
        }
        add('trunk', cx - 4.5, 8.3, cz, 1.4, 16.3, 1.4, '#bd8a76')
        for (let y = 11; y < 16; y += 1.9)
          add('round', cx - 4.5, y, cz, 1.33, 0.74, 1.33, '#ead8c1')
      } else {
        for (const zz of [-22, 0, 22]) {
          add('trunk', cx, 1.65, cz + zz, 0.35, 3.2, 0.35, '#907457')
          add(
            'crown',
            cx,
            4,
            cz + zz,
            4.8,
            4.1,
            4.8,
            pick(['#809565', '#90a16f', '#759066']),
          )
        }
      }
    }
  }
  // Southbound city roads feed the divided coastal expressway at grade.
  for (let i = 0; i < ROADS.length - 1; i++) {
    const center = (ROADS[i] + ROADS[i + 1]) / 2
    box(center, 0.24, 240, 47, 0.43, 0.63, '#b0b3a8')
    box(center, 0.49, 240, 47, 0.08, 0.71, '#d9d4bf')
    solid(center, 0.25, 240, 47, 0.5, 0.69)
    for (let offset = -18; offset < 22; offset += 9)
      box(center + offset, 0.34, 239.65, 0.48, 0.11, 0.04, '#dbb969')
    if (i % 2 === 0) {
      for (const side of [-1, 1]) {
        add(
          'round',
          center + 13,
          3.1,
          240 + side * 8.6,
          0.3,
          6.25,
          0.3,
          '#77847d',
        )
        box(center + 13, 5.98, 240 + side * 4, 0.15, 0.17, 8.8, '#79857c')
        sign(
          center + 12.85,
          5.42,
          240 + side * 3.8,
          5.3,
          1.0,
          -Math.PI / 2,
          side === 1 ? 'ORLA DO SOL  ↑' : 'PORTO  ↑',
          '#347a6b',
          '#fff3cf',
        )
        sign(
          center + 13.1,
          5.42,
          240 + side * 3.8,
          5.3,
          1.0,
          Math.PI / 2,
          'VIA COSTEIRA  ↑',
          '#347a6b',
          '#fff3cf',
        )
      }
    }
  }
  // Taller palms frame the arrival at Praça da Maré.
  palm(-11.55, -10.9, 9.5, 3.65)
  palm(12.55, -11.5, 10.3, 2.1)
  // Signal heads and direction signs clear all approaching vehicle lanes.
  for (const x of [-160, -80, 0, 80, 160, 240]) {
    for (const z of [-160, -80, 0, 80, 160]) {
      for (const dir of [-1, 1]) {
        if (x === 0 && z === 0 && dir === 1) continue
        const xx = x + dir * 11.2,
          zz = z + dir * 11.8
        add('round', xx, 2.83, zz, 0.19, 5.5, 0.19, '#69716f')
        box(xx - dir * 3.5, 5.45, zz, 7.1, 0.16, 0.16, '#69716f')
        box(xx - dir * 7.05, 4.96, zz, 0.52, 1.38, 0.42, '#414b49')
        for (let j = 0; j < 3; j++)
          add(
            'round',
            xx - dir * 7.05,
            5.38 - j * 0.41,
            zz + dir * 0.24,
            0.26,
            0.09,
            0.26,
            ['#924e3f', '#9d8859', '#83bc8d'][j],
            0,
            0,
            Math.PI / 2,
          )
        box(xx, 3.45, zz + 0.14, 1.7, 0.37, 0.12, '#51847a')
      }
    }
  }
  // Beach promenade, cabanas, parasols, highway rail and the horizon suburbs.
  box(253, 0.04, 0, 8, 0.13, 570, '#d9c5a5')
  for (let z = -270; z < 280; z += 13) {
    palm(255 + rand() * 3, z, 6.7 + rand() * 2.5, rand() * 6.28)
    if (rand() > 0.32) {
      const x = 278 + rand() * 17
      add('round', x, 1.1, z, 0.09, 2.15, 0.09, '#aa906d')
      add(
        'trunk',
        x,
        2.1,
        z,
        3.3,
        0.62,
        3.3,
        pick(['#cc806d', '#719e9e', '#dbac66']),
      )
      box(x + 1.35, 0.04, z, 0.89, 0.03, 1.85, pick(['#8eaea3', '#d5a18d']))
    }
  }
  for (let z = -216; z <= 216; z += 72) {
    const x = 271 + rand() * 4
    box(x, 1.88, z, 3.2, 2.7, 3.2, '#87b1b0')
    box(x, 3.37, z, 3.9, 0.42, 3.9, '#e6b69a')
    box(x, 2.25, z + 1.62, 2.35, 0.8, 0.12, '#466d75')
    solid(x, 1.65, z, 3.2, 3.3, 3.2)
  }
  for (let i = 0; i < 23; i++) {
    const z = -268 + i * 24
    if (ROADS.some((v) => Math.abs(v - z) < 12)) continue
    box(-249, 0.82, z, 0.13, 0.35, 13, '#a4aba4')
    for (const off of [-5, 0, 5])
      box(-249, 0.47, z + off, 0.18, 0.91, 0.18, '#92968d')
  }
  for (const side of [0, 1, 2]) {
    for (let block = 0; block < ROADS.length - 1; block++) {
      for (const lot of [20, 40, 60]) {
        const along = ROADS[block] + lot + (rand() - 0.5) * 4
        const x = side === 0 ? -264 - rand() * 12 : along
        const z =
          side === 0 ? along : (side === 1 ? -1 : 1) * (262 + rand() * 12)
        building(
          x,
          z,
          8 + rand() * 6,
          7 + rand() * 5,
          4 + rand() * 10,
          'apartment',
          1,
        )
      }
    }
  }
  for (const [key, batch] of batches) {
    const shape = key.split(':')[0] as Shape
    const mesh = new THREE.InstancedMesh(
      shapes[shape],
      shape === 'leaf'
        ? frondMaterial
        : shape === 'road'
          ? roadMaterial
          : meshMaterial,
      batch.length,
    )
    mesh.castShadow = shape !== 'road'
    mesh.receiveShadow = true
    for (let i = 0; i < batch.length; i++) {
      mesh.setMatrixAt(i, batch[i].matrix)
      mesh.setColorAt(i, batch[i].color)
    }
    mesh.computeBoundingSphere()
    scene.add(mesh)
  }
  const contact = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.5, 14),
    shadowMat,
    shadows.length,
  )
  shadows.forEach((m, i) => contact.setMatrixAt(i, m))
  scene.add(contact)
  return sun
}
