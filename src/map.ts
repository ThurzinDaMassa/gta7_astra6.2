import { ROADS } from './world'
import type { Actors } from './actors'
import type { Systems } from './systems'

export function drawMap(
  canvas: HTMLCanvasElement,
  actors: Actors,
  systems: Systems,
  full = false,
) {
  const w = canvas.clientWidth,
    h = canvas.clientHeight
  if (!w || !h) return
  const ratio = Math.min(devicePixelRatio, 2)
  if (
    canvas.width !== Math.round(w * ratio) ||
    canvas.height !== Math.round(h * ratio)
  ) {
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
  }
  const ctx = canvas.getContext('2d')!
  const scale = full ? w / 660 : w / 208
  const px = full ? 0 : actors.position.x,
    pz = full ? 0 : actors.position.z
  const X = (x: number) => w / 2 + (x - px) * scale,
    Z = (z: number) => h / 2 + (z - pz) * scale
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.fillStyle = '#3a4b46'
  ctx.fillRect(0, 0, w, h)
  const rect = (
    x: number,
    z: number,
    dx: number,
    dz: number,
    color: string,
  ) => {
    ctx.fillStyle = color
    ctx.fillRect(X(x), Z(z), dx * scale, dz * scale)
  }
  rect(259, -440, 53, 880, '#9b9b74')
  rect(312, -440, 140, 880, '#476b70')
  for (const x of ROADS)
    for (const z of ROADS) {
      if (x === 240 || z === 240) continue
      rect(x + 8, z + 8, 64, 64, '#647568')
      for (let i = 0; i < 4; i++) {
        const a = x + 13 + (i % 2) * 31,
          b = z + 13 + Math.floor(i / 2) * 31
        rect(a, b, 22, 22, (x + z + i) % 3 === 0 ? '#87937e' : '#79867b')
        rect(a + 1, b + 1, 17, 18, '#5b6b60')
      }
    }
  for (const n of ROADS) {
    rect(n - 5, -270, 10, 540, '#a9b4a5')
    rect(-270, n - 5, 540, 10, '#a9b4a5')
  }
  if (full) {
    ctx.font = 'bold 10px Barlow'
    ctx.textAlign = 'center'
    ctx.fillStyle = '#162820'
    for (const [name, x, z] of [
      ['CENTRO', -85, -112],
      ['ORLA', 235, -136],
      ['PORTO', -120, 198],
      ['VILA DAS FLORES', -179, 118],
    ] as const)
      ctx.fillText(name, X(x), Z(z))
  }
  for (const point of systems.trafficPoints) {
    ctx.fillStyle = '#ebeadb'
    ctx.beginPath()
    ctx.arc(X(point.x), Z(point.z), 1.7, 0, Math.PI * 2)
    ctx.fill()
  }
  const goal = systems.target
  if (goal) {
    const x = Math.min(w - 7, Math.max(7, X(goal.x))),
      z = Math.min(h - 7, Math.max(7, Z(goal.z)))
    ctx.save()
    ctx.translate(x, z)
    ctx.rotate(Math.PI / 4)
    ctx.fillStyle = '#ffdb86'
    ctx.strokeStyle = '#52452b'
    ctx.lineWidth = 2
    ctx.fillRect(-4, -4, 8, 8)
    ctx.strokeRect(-4, -4, 8, 8)
    ctx.restore()
  }
  ctx.save()
  ctx.translate(X(actors.position.x), Z(actors.position.z))
  ctx.rotate(-actors.heading + Math.PI)
  ctx.beginPath()
  ctx.moveTo(0, -8)
  ctx.lineTo(6, 6)
  ctx.lineTo(0, 3)
  ctx.lineTo(-6, 6)
  ctx.closePath()
  ctx.shadowColor = '#112c25'
  ctx.shadowBlur = 4
  ctx.fillStyle = '#92ffcd'
  ctx.fill()
  ctx.strokeStyle = '#16352a'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}
