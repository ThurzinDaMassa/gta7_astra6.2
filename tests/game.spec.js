import { test, expect } from '@playwright/test'

test('Cidade, física, controles e painéis pelo navegador', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/?test')
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 })
  await expect(page.locator('#district')).toHaveText('Costa Dourada')
  await page.keyboard.press('m')
  await expect(page.locator('#fullmap')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Missões', exact: true }).click()
  await expect(page.locator('.mission-item')).toHaveCount(3)
  await page.getByRole('button', { name: 'Fechar', exact: true }).click()
  await page.getByRole('button', { name: 'Configurações', exact: true }).click()
  await page.locator('#quality').selectOption('Econômica')
  await page.locator('#toggle-sound').click()
  await expect(page.locator('#toggle-sound')).toHaveText('Ativado')
  await page.keyboard.press('Escape')
  await page.keyboard.press('h')
  await expect(page.locator('#panel-title')).toHaveText('Controles')
  await page.keyboard.press('Escape')

  const walk = await page.evaluate(() => {
    const { actors, step, keys } = window.gameTest
    actors.reset()
    for (let i = 0; i < 40; i++) step()
    const base = actors.position.clone()
    keys.add('Space')
    step()
    keys.clear()
    let apex = base.y
    for (let i = 0; i < 90; i++) {
      step()
      apex = Math.max(apex, actors.position.y)
    }
    keys.add('KeyW')
    keys.add('ShiftLeft')
    for (let i = 0; i < 30; i++) step()
    keys.clear()
    return { jump: apex - base.y, walk: base.distanceTo(actors.position) }
  })
  expect(walk.jump).toBeGreaterThan(0.7)
  expect(walk.walk).toBeGreaterThan(2)
  await page.keyboard.press('f')
  const car = await page.evaluate(() => {
    const { actors, step, keys } = window.gameTest
    const start = actors.position.clone()
    keys.add('KeyW')
    keys.add('KeyD')
    for (let i = 0; i < 50; i++) step()
    keys.delete('KeyD')
    const speed = actors.speed,
      dist = start.distanceTo(actors.position)
    keys.clear()
    keys.add('Space')
    for (let i = 0; i < 155; i++) step()
    keys.clear()
    return { inCar: actors.inCar, speed, dist, stopped: actors.speed }
  })
  expect(car.inCar).toBe(true)
  expect(car.speed).toBeGreaterThan(18)
  expect(car.dist).toBeGreaterThan(2)
  expect(car.stopped).toBeLessThan(2)
  await expect(page.locator('#speed')).toBeVisible()
  await page.keyboard.press('f')
  await expect(page.locator('#speed')).toBeHidden()
  expect(errors).toEqual([])
})

test('Campanha, falha por tempo, colisões, resposta policial e fuga', async ({
  page,
}) => {
  await page.goto('/?test')
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 })
  const results = await page.evaluate(async () => {
    const { systems, actors, step } = window.gameTest
    // Drive the mission state machine with controlled positions and simulated elapsed time.
    const player = actors.position,
      moveToGoal = () => player.copy(systems.target)
    moveToGoal()
    systems.interact()
    for (let i = 0; i < 8160; i++) systems.update(1 / 60)
    const expired = systems.missionIndex === 0 && systems.timeLeft === 0
    actors.reset()
    actors.toggleCar()
    const initial = systems.money
    for (let i = 0; i < 3; i++) {
      moveToGoal()
      systems.interact()
      for (let n = 0; n < 4 && systems.missionIndex === i; n++) {
        moveToGoal()
        systems.update(1 / 60)
        if (systems.wanted) {
          player.set(270, 1, -260)
          for (let j = 0; j < 1250; j++) systems.update(1 / 60)
        }
      }
    }
    const missionIndex = systems.missionIndex,
      earned = systems.money - initial
    // Repeated high-speed contact with actual traffic uses the same detection as a driven collision.
    Object.defineProperty(actors, 'speed', {
      configurable: true,
      get: () => 48,
    })
    const baseCount = systems.trafficPoints.length
    for (let j = 0; j < 5; j++) {
      const near = systems.trafficPoints[0]
      const body = actors.carCollider.parent()
      body.setTranslation({ x: near.x, y: 0.78, z: near.z }, true)
      for (let i = 0; i < 4; i++) step()
      player.set(285, 1, -285)
      for (let n = 0; n < 170; n++) systems.update(1 / 60)
    }
    const wanted = systems.wanted,
      patrols = systems.trafficPoints.length - baseCount
    for (let n = 0; n < 1450; n++) systems.update(1 / 60)
    return {
      expired,
      missionIndex,
      earned,
      wanted,
      patrols,
      escaped: systems.wanted === 0,
    }
  })
  expect(results).toEqual({
    expired: true,
    missionIndex: 3,
    earned: 2700,
    wanted: 5,
    patrols: 5,
    escaped: true,
  })
})
