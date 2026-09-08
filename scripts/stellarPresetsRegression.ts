import assert from 'node:assert/strict'
import { applyPresetBodyTypes } from '../src/bodyTypes'
import { getPreset, getPresetBodyCount, PRESETS_BY_BODY_COUNT } from '../src/presets'
import { getOrbital2dPresetOverride } from '../src/orbital2dPresets'
import { getOrbital3dPresetOverride } from '../src/orbital3dPresets'
import { stepBodies } from '../src/physics/fragmentAwareEngine'
import { getStellarComputedProperties } from '../src/starColors'
import type { PresetId } from '../src/types'

const ids: PresetId[] = ['binarySpectrum', 'tripleSpectrum', 'quadSpectrum']
for (const [index, id] of ids.entries()) {
  const count = index + 2
  const bodyCount = getPresetBodyCount(id)
  assert.equal(bodyCount, count)
  assert(PRESETS_BY_BODY_COUNT[bodyCount].includes(id))
  for (const override of [getOrbital2dPresetOverride, getOrbital3dPresetOverride]) {
    let bodies = applyPresetBodyTypes(id, override(id) ?? getPreset(id))
    const initial = structuredClone(bodies)
    assert.equal(bodies.length, count)
    assert(bodies.every(b => b.bodyType === 'star'))
    const classes = bodies.map(b => getStellarComputedProperties(b).spectralClass)
    assert.deepEqual(classes, ['K', 'B', 'G', 'M'].slice(0, count))
    assert.equal(new Set(bodies.map(b => b.color)).size, count)
    for (const axis of ['x', 'y', 'z'] as const) {
      assert(Math.abs(bodies.reduce((s, b) => s + b.mass * b.position[axis], 0)) < 1e-10)
      assert(Math.abs(bodies.reduce((s, b) => s + b.mass * b.velocity[axis], 0)) < 1e-10)
    }
    // Exercise the actual production engine for 120 simulation seconds.
    for (let step = 0; step < 14400; step++) {
      bodies = stepBodies(bodies, 1 / 120)
      assert.equal(bodies.length, count, `${id}: unexpected collision`)
      assert(bodies.every(b => Number.isFinite(b.position.x) && Math.hypot(b.position.x, b.position.y, b.position.z) < 16), `${id}: escaped orbit`)
      if (step === 239) {
        assert(bodies.every((b, i) => Math.hypot(b.position.x - initial[i].position.x, b.position.y - initial[i].position.y) > 0.05), `${id}: stationary star`)
      }
    }
    console.log(`${id}: ${classes.join('/')} colors, all stars moving, 120s without collision or escape`)
  }
}
