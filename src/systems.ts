import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { Actors, createCar, createPerson } from './actors'
import { ROADS, district } from './world'

type Junction = { x: number; z: number }
type Driver = {
  mesh: THREE.Group
  body: RAPIER.RigidBody
  from: Junction
  to: Junction
  waypoint: THREE.Vector3
  speed: number
  cruise: number
  cop: boolean
  direct: boolean
}
type Walker = {
  mesh: THREE.Group
  path: THREE.Vector3[]
  next: number
  gait: number
  legs: (THREE.Object3D | undefined)[]
  rest: number
  reverse: boolean
}
type Stop = {
  x: number
  z: number
  instruction: string
  car?: boolean
  escape?: boolean
}
type Mission = { title: string; reward: number; seconds: number; stops: Stop[] }
const missions: Mission[] = [
  {
    title: 'Primeiro turno',
    reward: 450,
    seconds: 135,
    stops: [
      { x: 2, z: -18, instruction: 'Encontre o contato no boulevard.' },
      {
        x: 80,
        z: -78,
        instruction: 'Dirija até o ponto de coleta.',
        car: true,
      },
      {
        x: 158,
        z: -4,
        instruction: 'Estacione na entrega em frente à orla.',
        car: true,
      },
    ],
  },
  {
    title: 'Expresso da orla',
    reward: 850,
    seconds: 100,
    stops: [
      { x: 161, z: -35, instruction: 'Encontre a despachante na orla.' },
      {
        x: 239,
        z: -80,
        instruction: 'Recolha a encomenda no litoral.',
        car: true,
      },
      {
        x: 163,
        z: 80,
        instruction: 'Passe pelo posto de conferência.',
        car: true,
      },
      {
        x: -1,
        z: 159,
        instruction: 'Entregue a encomenda antes do prazo.',
        car: true,
      },
    ],
  },
  {
    title: 'Última saída',
    reward: 1400,
    seconds: 180,
    stops: [
      { x: -30, z: 161, instruction: 'Encontre o motorista na avenida.' },
      {
        x: -160,
        z: 81,
        instruction: 'Busque a carga no ponto de retirada.',
        car: true,
      },
      {
        x: -80,
        z: -158,
        instruction: 'Despiste a polícia e estacione no refúgio.',
        car: true,
        escape: true,
      },
    ],
  },
]
const colors = [0xa24337, 0xe4b953, 0x488a82, 0xb0b6ac, 0x5a778c, 0xd3a58b]
const hdist = (a: THREE.Vector3, b: THREE.Vector3) =>
  Math.hypot(a.x - b.x, a.z - b.z)
const nearIndex = (v: number) =>
  ROADS.reduce(
    (best, n, i) => (Math.abs(n - v) < Math.abs(ROADS[best] - v) ? i : best),
    0,
  )
const coordinates = (j: Junction) =>
  new THREE.Vector3(ROADS[j.x], 0, ROADS[j.z])
function neighbors(j: Junction): Junction[] {
  return [
    { x: j.x + 1, z: j.z },
    { x: j.x - 1, z: j.z },
    { x: j.x, z: j.z + 1 },
    { x: j.x, z: j.z - 1 },
  ].filter(
    (n) => n.x >= 0 && n.z >= 0 && n.x < ROADS.length && n.z < ROADS.length,
  )
}
function lane(from: Junction, to: Junction) {
  const dx = to.x - from.x,
    dz = to.z - from.z
  return coordinates(to).add(new THREE.Vector3(-dz * 3.3, 0, dx * 3.3))
}
export class Systems {
  money = 1250
  health = 100
  wanted = 0
  missionIndex = 0
  timeLeft = 0
  readonly trafficPoints: THREE.Vector3[] = []
  private drivers: Driver[] = []
  private walkers: Walker[] = []
  private step = 0
  private active = false
  private marker = new THREE.Group()
  private objective = new THREE.Vector3()
  private elapsed = 0
  private calm = 0
  private crimeCooldown = 0
  private injuryCooldown = 0
  private previousSpeed = 0
  private dispatchCooldown = 0
  private seed = 17491
  private scene: THREE.Scene
  private physics: RAPIER.World
  private actors: Actors
  private notify: (text: string) => void

  constructor(
    scene: THREE.Scene,
    physics: RAPIER.World,
    actors: Actors,
    notify: (s: string) => void,
  ) {
    this.scene = scene
    this.physics = physics
    this.actors = actors
    this.notify = notify
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd563,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.46, 40), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.11
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.64),
      new THREE.MeshStandardMaterial({
        color: 0xffbb45,
        emissive: 0xad690e,
        emissiveIntensity: 0.7,
        flatShading: true,
      }),
    )
    gem.scale.y = 1.5
    this.marker.add(ring, gem)
    scene.add(this.marker)
    this.setTarget()
    const middle = nearIndex(0)
    this.spawnDriver(
      { x: middle, z: middle },
      { x: middle, z: middle - 1 },
      0.56,
      false,
    )
    this.spawnDriver(
      { x: middle, z: middle - 1 },
      { x: middle, z: middle },
      0.36,
      false,
    )
    for (let i = 0; i < 15; i++) {
      const start = {
        x: Math.floor(this.random() * ROADS.length),
        z: Math.floor(this.random() * ROADS.length),
      }
      const edges = neighbors(start)
      this.spawnDriver(
        start,
        edges[Math.floor(this.random() * edges.length)],
        this.random() * 0.8,
        false,
      )
    }
    for (let i = 0; i < 24; i++) {
      const x =
        i < 4
          ? middle - (i % 2)
          : Math.floor(this.random() * (ROADS.length - 1))
      const z =
        i < 4
          ? middle - Math.floor(i / 2)
          : Math.floor(this.random() * (ROADS.length - 1))
      const ax = ROADS[x] + 9.4,
        bx = ROADS[x + 1] - 9.4,
        az = ROADS[z] + 9.4,
        bz = ROADS[z + 1] - 9.4
      const path = [
        [ax, az],
        [bx, az],
        [bx, bz],
        [ax, bz],
      ].map(([px, pz]) => new THREE.Vector3(px, 0.23, pz))
      const next = i < 4 ? (i % 2 ? 2 : 0) : Math.floor(this.random() * 4)
      const mesh = createPerson(i + 1)
      mesh.position.copy(path[(next + 3) % 4]).lerp(path[next], this.random())
      scene.add(mesh)
      this.walkers.push({
        mesh,
        path,
        next,
        gait: i,
        legs: ['leftLeg', 'rightLeg', 'leftArm', 'rightArm'].map((n) =>
          mesh.getObjectByName(n),
        ),
        rest: 0,
        reverse: false,
      })
    }
  }

  get target() {
    return this.missionIndex < missions.length ? this.objective : null
  }
  get missionTitle() {
    return missions[this.missionIndex]?.title ?? 'Cidade livre'
  }
  get missionText() {
    const stop = missions[this.missionIndex]?.stops[this.step]
    if (!stop) return 'Explore os bairros de Costa Livre.'
    if (this.active && stop.escape && this.wanted)
      return 'Abra distância das viaturas até perder as estrelas.'
    return stop.instruction
  }
  get missionTag() {
    if (!this.target) return 'CAMPANHA CONCLUÍDA'
    return this.active ? 'MISSÃO EM CURSO' : 'MISSÃO DISPONÍVEL'
  }
  get prompt() {
    return this.target &&
      !this.active &&
      hdist(this.actors.position, this.target) <= 8
      ? 'Iniciar missão'
      : ''
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 4294967296
  }
  private setTarget() {
    const stop = missions[this.missionIndex]?.stops[this.step]
    this.marker.visible = !!stop
    if (!stop) return
    this.objective.set(stop.x, 0.06, stop.z)
    this.marker.position.copy(this.objective)
  }
  interact() {
    if (!this.prompt) return
    const mission = missions[this.missionIndex]
    this.active = true
    this.step = 1
    this.timeLeft = mission.seconds
    this.setTarget()
    this.notify(mission.title + ' · ' + this.missionText)
  }
  private advanceMission(dt: number) {
    if (!this.active || !this.target) return
    this.timeLeft = Math.max(0, this.timeLeft - dt)
    if (!this.timeLeft) {
      this.fail('Tempo esgotado.')
      return
    }
    const mission = missions[this.missionIndex],
      stop = mission.stops[this.step]
    if (
      hdist(this.actors.position, this.target) > 6.4 ||
      (stop.car && (!this.actors.inCar || Math.abs(this.actors.speed) > 13)) ||
      (stop.escape && this.wanted)
    )
      return
    this.step++
    if (this.step === mission.stops.length) {
      this.money += mission.reward
      this.notify('Missão concluída · +$ ' + mission.reward)
      this.active = false
      this.timeLeft = 0
      this.step = 0
      this.missionIndex++
    } else {
      if (this.missionIndex === 2) this.raiseWanted(2)
      this.notify(mission.stops[this.step].instruction)
    }
    this.setTarget()
  }
  private fail(message: string) {
    if (!this.active) return
    this.active = false
    this.step = 0
    this.timeLeft = 0
    this.setTarget()
    this.notify(message + ' Volte ao contato para tentar novamente.')
  }

  private spawnDriver(from: Junction, to: Junction, t: number, cop: boolean) {
    const mesh = createCar(
      cop ? 0x354555 : colors[Math.floor(this.random() * colors.length)],
      cop,
    )
    const waypoint = lane(from, to)
    mesh.position
      .copy(waypoint)
      .lerp(coordinates(from).add(waypoint.clone().sub(coordinates(to))), 1 - t)
    mesh.position.y = 0.055
    mesh.rotation.y = Math.atan2(to.x - from.x, to.z - from.z)
    this.scene.add(mesh)
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(mesh.position.x, 0, mesh.position.z)
        .setRotation(mesh.quaternion),
    )
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(0.98, 0.6, 2.18).setTranslation(0, 0.75, 0),
      body,
    )
    this.drivers.push({
      mesh,
      body,
      from,
      to,
      waypoint,
      cruise: 7 + this.random() * 4,
      speed: 5,
      cop,
      direct: false,
    })
    this.trafficPoints.push(mesh.position)
  }
  private route(d: Driver) {
    const edges = neighbors(d.to).filter(
      (n) => n.x !== d.from.x || n.z !== d.from.z,
    )
    const p = this.actors.position
    if (d.cop)
      edges.sort((a, b) => hdist(coordinates(a), p) - hdist(coordinates(b), p))
    const next = d.cop
      ? edges[0]
      : edges[Math.floor(this.random() * edges.length)]
    d.from = d.to
    d.to = next
    d.waypoint.copy(lane(d.from, d.to))
  }
  private raiseWanted(stars = 1) {
    this.calm = 0
    this.wanted = Math.min(5, this.wanted + stars)
    this.crimeCooldown = 2.8
    this.notify(
      'Alerta policial · ' +
        this.wanted +
        (this.wanted === 1 ? ' estrela' : ' estrelas'),
    )
  }
  private injure(amount: number) {
    if (this.injuryCooldown > 0) return
    this.injuryCooldown = 2
    this.health = Math.max(0, this.health - amount)
    if (!this.health) {
      this.fail('Missão interrompida.')
      this.actors.reset()
      this.previousSpeed = 0
      this.wanted = 0
      this.health = 100
      this.money = Math.max(0, this.money - 100)
      this.notify('Atendimento de emergência · −$ 100')
    }
  }
  private updateDrivers(dt: number) {
    const p = this.actors.position
    let nearestCop = Infinity
    for (const d of this.drivers) {
      const pos = d.mesh.position
      const gap = hdist(pos, p)
      if (d.cop) nearestCop = Math.min(nearestCop, gap)
      if (hdist(pos, d.waypoint) < 1.7) this.route(d)
      const sameStreet =
        (Math.abs(p.x - pos.x) < 8 &&
          Math.abs(pos.x - ROADS[nearIndex(pos.x)]) < 8) ||
        (Math.abs(p.z - pos.z) < 8 &&
          Math.abs(pos.z - ROADS[nearIndex(pos.z)]) < 8)
      const direct = d.cop && sameStreet && gap < 52
      if (d.direct && !direct) {
        // Rejoin the street graph after following the player beyond an intersection.
        d.from = { x: nearIndex(pos.x), z: nearIndex(pos.z) }
        d.to = neighbors(d.from).sort(
          (a, b) => hdist(coordinates(a), p) - hdist(coordinates(b), p),
        )[0]
        d.waypoint.copy(lane(d.from, d.to))
      }
      d.direct = direct
      const aim = direct ? p : d.waypoint
      const yaw = Math.atan2(aim.x - pos.x, aim.z - pos.z)
      const error = Math.atan2(
        Math.sin(yaw - d.mesh.rotation.y),
        Math.cos(yaw - d.mesh.rotation.y),
      )
      d.mesh.rotation.y += THREE.MathUtils.clamp(error, -dt * 3.6, dt * 3.6)
      const dx = Math.sin(d.mesh.rotation.y),
        dz = Math.cos(d.mesh.rotation.y)
      const ahead = (q: THREE.Vector3, range: number) => {
        const x = q.x - pos.x,
          z = q.z - pos.z,
          forward = dx * x + dz * z
        return (
          forward > 0 && forward < range && Math.abs(dz * x - dx * z) < 2.25
        )
      }
      const blocked =
        this.drivers.some(
          (other) => other !== d && ahead(other.mesh.position, 6.7),
        ) ||
        (!d.cop && ahead(p, 9)) ||
        (!d.cop && this.walkers.some((w) => ahead(w.mesh.position, 5)))
      const desired =
        blocked || (direct && gap < 3)
          ? 0
          : Math.abs(error) > 0.7
            ? 4
            : d.cop
              ? 12 + this.wanted * 1.8
              : d.cruise
      d.speed = THREE.MathUtils.damp(d.speed, desired, blocked ? 7 : 2.6, dt)
      pos.x += dx * d.speed * dt
      pos.z += dz * d.speed * dt
      d.body.setNextKinematicTranslation({ x: pos.x, y: 0, z: pos.z })
      d.body.setNextKinematicRotation(d.mesh.quaternion)
      d.mesh.visible = gap < 200
      if (
        gap < 5.2 &&
        this.actors.inCar &&
        Math.max(this.previousSpeed, Math.abs(this.actors.speed)) > 21 &&
        this.crimeCooldown <= 0
      ) {
        let contact = false
        this.physics.contactPair(
          this.actors.carCollider,
          d.body.collider(0),
          (manifold) => {
            if (manifold.numSolverContacts() > 0) contact = true
          },
        )
        if (contact) {
          this.raiseWanted()
          this.injure(10)
        }
      }
      if (d.cop && gap < 5 && this.wanted) this.injure(7 + this.wanted * 2)
      if (!this.actors.inCar && gap < 2.4 && d.speed > 5) this.injure(18)
    }
    if (this.wanted) {
      this.calm = nearestCop < 45 ? 0 : this.calm + dt
      if (this.calm > 12 + this.wanted * 1.5) {
        this.wanted = 0
        this.notify('Você despistou a polícia.')
      }
    }
    if (
      this.wanted &&
      this.drivers.filter((d) => d.cop).length < this.wanted &&
      this.dispatchCooldown <= 0
    ) {
      const j = { x: nearIndex(p.x), z: nearIndex(p.z) }
      const starts = neighbors(j)
      const from = starts[Math.floor(this.random() * starts.length)]
      this.spawnDriver(from, j, 0.13, true)
      this.dispatchCooldown = 2
    }
    if (!this.wanted) {
      for (let i = this.drivers.length - 1; i >= 0; i--) {
        const d = this.drivers[i]
        if (!d.cop) continue
        this.physics.removeRigidBody(d.body)
        this.scene.remove(d.mesh)
        this.drivers.splice(i, 1)
        this.trafficPoints.splice(i, 1)
      }
    }
  }
  private updateWalkers(dt: number) {
    const p = this.actors.position
    for (const w of this.walkers) {
      const pos = w.mesh.position,
        distance = hdist(pos, p)
      w.mesh.visible = distance < 94
      w.rest = Math.max(0, w.rest - dt)
      if (
        this.actors.inCar &&
        distance < 2.4 &&
        Math.abs(this.actors.speed) > 16 &&
        !w.rest
      ) {
        if (this.crimeCooldown <= 0) this.raiseWanted()
        w.rest = 2
      }
      w.mesh.rotation.z = w.rest ? 1.4 : 0
      if (w.rest) continue
      const aim = w.path[w.next]
      const gap = hdist(pos, aim)
      if (gap < 0.35) {
        w.next = (w.next + (w.reverse ? 3 : 1)) % 4
        continue
      }
      const dx = (aim.x - pos.x) / gap,
        dz = (aim.z - pos.z) / gap
      const dangerAhead =
        distance < 7 &&
        this.actors.inCar &&
        Math.abs(this.actors.speed) > 9 &&
        dx * (p.x - pos.x) + dz * (p.z - pos.z) > 0.4
      if (dangerAhead) {
        w.reverse = !w.reverse
        w.next = (w.next + (w.reverse ? 3 : 1)) % 4
        continue
      }
      const velocity =
        (this.wanted > 0 ||
          (this.actors.inCar && Math.abs(this.actors.speed) > 10)) &&
        distance < 16
          ? 4.1
          : 1.25
      const otherInWay = this.walkers.some(
        (other) =>
          other !== w &&
          hdist(pos, other.mesh.position) < 1.1 &&
          dx * (other.mesh.position.x - pos.x) +
            dz * (other.mesh.position.z - pos.z) >
            0.1,
      )
      const sidestep = otherInWay ? 1.05 : 0
      pos.x += (dx * velocity + dz * sidestep) * dt
      pos.z += (dz * velocity - dx * sidestep) * dt
      w.mesh.rotation.y = Math.atan2(dx, dz)
      w.gait += dt * velocity * 4
      w.legs.forEach((limb, i) => {
        if (limb)
          limb.rotation.x =
            Math.sin(w.gait) * (i === 0 || i === 3 ? 0.46 : -0.46)
      })
    }
  }
  update(dt: number) {
    this.elapsed += dt
    this.crimeCooldown -= dt
    this.dispatchCooldown -= dt
    this.injuryCooldown -= dt
    this.updateDrivers(dt)
    this.updateWalkers(dt)
    const speed = Math.abs(this.actors.speed)
    if (
      this.actors.inCar &&
      this.previousSpeed - speed > 15 &&
      this.previousSpeed > 36
    )
      this.injure(Math.min(34, Math.floor(this.previousSpeed / 3)))
    this.previousSpeed = this.actors.inCar ? speed : 0
    this.advanceMission(dt)
    this.marker.children[1].position.y = 3 + Math.sin(this.elapsed * 2.3) * 0.2
    this.marker.children[1].rotation.y = this.elapsed * 0.9
  }
  get area() {
    return district(this.actors.position.x, this.actors.position.z)
  }
}
