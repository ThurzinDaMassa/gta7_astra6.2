import './style.css'
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import {
  Gamepad2,
  Map as MapIcon,
  Flag,
  VolumeX,
  Volume2,
  Settings2,
  Sun,
  Wallet,
  Heart,
  MapPin,
  Keyboard,
  Expand,
  Star,
  createElement,
} from 'lucide'
import { buildWorld, district } from './world'
import { Actors } from './actors'
import { Systems } from './systems'
import { drawMap } from './map'
import { Sound } from './sound'

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T
const iconSet = {
  game: Gamepad2,
  map: MapIcon,
  flag: Flag,
  mute: VolumeX,
  settings: Settings2,
  sun: Sun,
  wallet: Wallet,
  heart: Heart,
  pin: MapPin,
  keyboard: Keyboard,
  expand: Expand,
}
for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  el.className = 'icon'
  el.append(createElement(iconSet[el.dataset.icon as keyof typeof iconSet]))
}
const stars = Array.from({ length: 5 }, () => {
  const star = createElement(Star)
  document.querySelector('.wanted')!.append(star)
  return star
})
const sound = new Sound()
let messageTimer = 0
function notify(message: string) {
  $('notice').textContent = message
  $('notice').classList.add('show')
  sound.chime()
  clearTimeout(messageTimer)
  messageTimer = window.setTimeout(
    () => $('notice').classList.remove('show'),
    3800,
  )
}
async function start() {
  await RAPIER.init()
  const canvas = $<HTMLCanvasElement>('game'),
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(57, 1, 0.12, 1600)
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  physics.timestep = 1 / 60
  const sun = buildWorld(scene, physics)
  const actors = new Actors(scene, physics)
  const systems = new Systems(scene, physics, actors, notify)
  const keys = new Set<string>(),
    panel = $<HTMLDialogElement>('panel'),
    radar = $<HTMLCanvasElement>('radar')
  let view = 'game',
    quality = 'Alta',
    simTime = 0
  const resize = () => {
    const w = canvas.clientWidth,
      h = Math.max(1, canvas.clientHeight)
    renderer.setPixelRatio(
      quality === 'Alta' ? Math.min(devicePixelRatio, 1.5) : 0.8,
    )
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(resize).observe(canvas)
  resize()
  const rows = (items: string[][]) =>
    items
      .map(
        ([key, value]) =>
          '<div class="panel-row"><kbd>' +
          key +
          '</kbd><span>' +
          value +
          '</span></div>',
      )
      .join('')
  const open = (next: string) => {
    if (next === 'game') {
      if (panel.open) panel.close()
      return
    }
    view = next
    keys.clear()
    const content = $('panel-body')
    $('panel-title').textContent = (
      {
        map: 'Mapa da cidade',
        missions: 'Missões',
        controls: 'Controles',
        settings: 'Configurações',
      } as Record<string, string>
    )[next]
    if (next === 'map') {
      content.innerHTML =
        '<canvas id="fullmap" aria-label="Mapa completo"></canvas><div class="legend"><b>▲ Sua posição</b><em>◆ Objetivo</em><span>• Trânsito</span></div>'
    } else if (next === 'missions') {
      const names = ['Primeiro turno', 'Expresso da orla', 'Última saída']
      const descriptions = [
        'Busque e entregue a primeira encomenda do turno.',
        'Recolha uma encomenda no litoral e passe pelo posto de conferência.',
        'Retire a carga e despiste a polícia antes de chegar ao refúgio.',
      ]
      content.innerHTML = names
        .map(
          (name, i) =>
            '<article class="mission-item"><small>' +
            (i < systems.missionIndex
              ? 'CONCLUÍDA'
              : i === systems.missionIndex
                ? systems.missionTag
                : 'BLOQUEADA') +
            ' · $ ' +
            [450, 850, 1400][i].toLocaleString('pt-BR') +
            '</small><h3>' +
            name +
            '</h3><p>' +
            (i === systems.missionIndex
              ? systems.missionText
              : descriptions[i]) +
            '</p></article>',
        )
        .join('')
    } else if (next === 'controls') {
      content.innerHTML = rows([
        ['W A S D / ↑ ← ↓ →', 'Mover ou dirigir'],
        ['Shift', 'Correr'],
        ['Espaço', 'Pular / freio de mão'],
        ['F', 'Entrar ou sair do cupê coral'],
        ['E', 'Iniciar missão no marcador'],
        ['Arrastar o mouse', 'Girar câmera'],
        ['M / Esc', 'Mapa / fechar painel'],
        ['H', 'Consultar controles'],
      ])
    } else {
      content.innerHTML =
        '<label class="panel-row">Qualidade gráfica<select id="quality"><option>Alta</option><option>Econômica</option></select></label><div class="panel-row"><span>Som do jogo</span><button id="toggle-sound"></button></div>'
      const select = $<HTMLSelectElement>('quality')
      select.value = quality
      select.onchange = () => {
        quality = select.value
        renderer.shadowMap.enabled = quality === 'Alta'
        resize()
      }
      $('toggle-sound').textContent = sound.enabled ? 'Ativado' : 'Desativado'
      $('toggle-sound').onclick = () => void audio()
    }
    if (!panel.open) panel.showModal()
    if (next === 'map')
      drawMap($<HTMLCanvasElement>('fullmap'), actors, systems, true)
    document
      .querySelectorAll('nav button')
      .forEach((b) =>
        b.classList.toggle(
          'selected',
          (b as HTMLElement).dataset.view === next,
        ),
      )
  }
  const audio = async () => {
    const enabled = await sound.toggle(),
      label = enabled ? 'Silenciar áudio' : 'Ativar áudio',
      b = $('audio')
    b.title = label
    b.setAttribute('aria-label', label)
    b.firstElementChild!.replaceChildren(
      createElement(enabled ? Volume2 : VolumeX),
    )
    if ($('toggle-sound'))
      $('toggle-sound').textContent = enabled ? 'Ativado' : 'Desativado'
  }
  $('audio').onclick = () => void audio()
  $('settings').onclick = () => open('settings')
  $('controls').onclick = () => open('controls')
  $('close').onclick = () => panel.close()
  panel.onclose = () => {
    view = 'game'
    keys.clear()
    document
      .querySelectorAll<HTMLElement>('nav button')
      .forEach((b) => b.classList.toggle('selected', b.dataset.view === 'game'))
  }
  panel.onclick = (e) => {
    if (e.target === panel) {
      const r = panel.getBoundingClientRect()
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        panel.close()
    }
  }
  document
    .querySelectorAll<HTMLElement>('[data-view]')
    .forEach((b) => (b.onclick = () => open(b.dataset.view!)))
  const press = (code: string) => {
    if (panel.open) {
      if (
        (code === 'KeyM' && view === 'map') ||
        (code === 'KeyH' && view === 'controls')
      )
        panel.close()
      return
    }
    if (code === 'KeyF') {
      actors.toggleCar()
    } else if (code === 'KeyE') {
      systems.interact()
    } else if (code === 'KeyM') {
      open('map')
    } else if (code === 'KeyH') {
      open('controls')
    } else if (code === 'Escape') {
      open('settings')
    } else keys.add(code)
  }
  window.addEventListener('keydown', (e) => {
    if (
      [
        'Escape',
        'Space',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ].includes(e.code) &&
      !panel.open
    )
      e.preventDefault()
    if (!e.repeat) press(e.code)
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => keys.clear())
  for (const b of document.querySelectorAll<HTMLElement>('[data-key]')) {
    b.onpointerdown = (e) => {
      b.setPointerCapture(e.pointerId)
      press(b.dataset.key!)
    }
    b.onlostpointercapture = () => keys.delete(b.dataset.key!)
  }
  canvas.onpointerdown = (e) => canvas.setPointerCapture(e.pointerId)
  canvas.onpointermove = (e) => {
    if (canvas.hasPointerCapture(e.pointerId))
      actors.orbit(e.movementX, e.movementY)
  }
  const action = $('action'),
    footerKeys = document.querySelector('.keys')!
  let oldDriving: boolean | undefined
  function hud() {
    const p = actors.position,
      area = district(p.x, p.z)
    $('district').textContent = area
    $('street').textContent =
      area === 'Costa Dourada' ? 'Boulevard do Sol' : area
    const min = (1000 + Math.floor(simTime / 10)) % 1440
    $('clock').textContent =
      Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0')
    $('money').textContent = '$ ' + systems.money.toLocaleString('pt-BR')
    $('life').style.width = systems.health + '%'
    $('hp').textContent = String(Math.ceil(systems.health))
    stars.forEach((s, i) => s.classList.toggle('on', i < systems.wanted))
    $('mission-tag').textContent =
      systems.missionTag +
      (systems.timeLeft ? ' · ' + Math.ceil(systems.timeLeft) + ' s' : '')
    $('mission-title').textContent = systems.missionTitle
    $('mission-text').textContent = systems.missionText
    const prompt = systems.prompt
      ? '<kbd>E</kbd> Iniciar missão'
      : actors.nearCar && !actors.inCar
        ? '<kbd>F</kbd> Entrar no veículo'
        : ''
    action.innerHTML = prompt
    action.hidden = !prompt
    $('speed').hidden = !actors.inCar
    $('speed').textContent = actors.speed + ' km/h'
    if (oldDriving !== actors.inCar) {
      oldDriving = actors.inCar
      footerKeys.innerHTML = actors.inCar
        ? '<span><kbd>W / S</kbd> Acelerar / frear</span><span><kbd>A / D</kbd> Virar</span><span><kbd>ESPAÇO</kbd> Freio de mão</span><span><kbd>F</kbd> Sair</span>'
        : '<span><kbd>WASD</kbd> Mover</span><span><kbd>SHIFT</kbd> Correr</span><span><kbd>F</kbd> Veículo</span><span><kbd>M</kbd> Mapa</span>'
    }
    $('mode').textContent = systems.wanted
      ? 'EM PERSEGUIÇÃO'
      : systems.timeLeft
        ? 'EM MISSÃO'
        : 'EXPLORAÇÃO LIVRE'
    drawMap(radar, actors, systems)
    sound.update(actors.speed, actors.inCar)
  }
  let last = performance.now(),
    acc = 0,
    nextHud = 0
  const step = () => {
    actors.update(1 / 60, keys)
    systems.update(1 / 60)
    physics.step()
    actors.sync(1 / 60, camera)
    simTime += 1 / 60
  }
  for (let i = 0; i < 5; i++) step()
  hud()
  renderer.render(scene, camera)
  $('loading').hidden = true
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('test')) {
    Object.assign(window, {
      gameTest: { actors, systems, step, keys, camera, scene },
    })
  }
  const manualTest =
    import.meta.env.DEV &&
    new URLSearchParams(location.search).get('test') === 'manual'
  function frame(now: number) {
    const delta = Math.min((now - last) / 1000, 0.15)
    last = now
    if (!manualTest && !panel.open && !document.hidden) {
      acc += delta
      while (acc >= 1 / 60) {
        step()
        acc -= 1 / 60
      }
      if (now >= nextHud) {
        hud()
        nextHud = now + 100
      }
      const x = Math.round(actors.position.x / 8) * 8,
        z = Math.round(actors.position.z / 8) * 8
      sun.position.set(x - 100, 115, z + 72)
      sun.target.position.set(x, 0, z)
      renderer.render(scene, camera)
    } else {
      sound.update(0, false)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
start().catch((error) => {
  console.error(error)
  $('loading').textContent =
    'Falha ao iniciar o jogo. Verifique se o navegador permite WebGL 2 e recarregue a página.'
})
