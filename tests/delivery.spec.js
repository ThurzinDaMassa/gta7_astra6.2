import { test, expect } from '@playwright/test'

test('Campanha percorrida com direção e frenagem reais', async ({ page }) => {
  await page.goto('/?test=manual')
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60000 })
  const report = await page.evaluate(() => {
    const { actors, systems, keys, step } = window.gameTest
    actors.toggleCar()
    const log = []
    function drive(x, z, stop) {
      for (let i = 0; i < 2400; i++) {
        const dx = x - actors.position.x,
          dz = z - actors.position.z,
          dist = Math.hypot(dx, dz)
        if (dist < (stop ? 4.5 : 5.5) && (!stop || actors.speed < 10)) {
          keys.clear()
          log.push([
            x,
            z,
            Math.round(actors.position.x),
            Math.round(actors.position.z),
            actors.speed,
            systems.wanted,
          ])
          return true
        }
        const error = Math.atan2(
          Math.sin(Math.atan2(dx, dz) - actors.heading),
          Math.cos(Math.atan2(dx, dz) - actors.heading),
        )
        const desired = stop
          ? Math.min(43, Math.max(0, dist - 2) * 2.3)
          : systems.wanted
            ? Math.min(130, 30 + dist * 1.9)
            : 40
        keys.clear()
        if (actors.speed < desired) keys.add('KeyW')
        if (actors.speed > desired + 2) keys.add('Space')
        if (Math.abs(error) > 0.04) keys.add(error > 0 ? 'KeyA' : 'KeyD')
        step()
      }
      keys.clear()
      log.push([
        'stalled',
        x,
        z,
        actors.position.toArray(),
        actors.speed,
        systems.wanted,
      ])
      return false
    }
    if (drive(2, -18, true)) {
      systems.interact()
      for (const [x, z, stop] of [
        [2, -78, false],
        [80, -78, true],
        [155, -78, false],
        [158, -4, true],
      ]) {
        if (!drive(x, z, stop)) break
      }
    }
    if (systems.missionIndex === 1) {
      for (const [x, z] of [
        [158, 79],
        [237, 79],
        [237, 2],
        [162, 2],
      ]) {
        if (!drive(x, z, false)) break
      }
    }
    if (systems.missionIndex === 1 && drive(161, -35, true)) {
      systems.interact()
      for (const [x, z, stop] of [
        [162, -77, false],
        [239, -80, true],
        [237, 77, false],
        [163, 80, true],
        [3, 82, false],
        [-1, 159, true],
      ]) {
        if (!drive(x, z, stop)) break
      }
    }
    if (systems.missionIndex === 2 && drive(-30, 161, true)) {
      systems.interact()
      for (const [x, z, stop] of [
        [-158, 162, false],
        [-160, 81, true],
        [-157, -237, false],
        [-82, -237, false],
        [-80, -158, true],
      ]) {
        if (!drive(x, z, stop)) break
      }
    }
    for (let j = 0; j < 120; j++) {
      keys.add('Space')
      step()
    }
    keys.clear()
    return {
      log,
      mission: systems.missionIndex,
      money: systems.money,
      title: systems.missionTitle,
      wanted: systems.wanted,
      hp: systems.health,
      time: systems.timeLeft,
    }
  })
  expect(report.mission, JSON.stringify(report)).toBe(3)
  expect(report.money).toBe(3950)
})
