import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function write(path, content) {
  fs.writeFileSync(path, content)
}

function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before)
  if (first < 0) throw new Error(`Missing patch target: ${label}`)
  if (content.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch target is not unique: ${label}`)
  }
  return content.slice(0, first) + after + content.slice(first + before.length)
}

{
  const path = 'src/rendering/collisionEffectRenderer.ts'
  let content = read(path)

  content = replaceOnce(
    content,
    `const PREVIEW_FLASH_LIFETIME = 0.72\nconst PREVIEW_SHEAR_LIFETIME = 0.82\nconst PREVIEW_PLASMA_LIFETIME = 1.55`,
    `const PREVIEW_FLASH_LIFETIME = 0.72\nconst PREVIEW_SHEAR_LIFETIME = 0.82\nconst PREVIEW_PLASMA_LIFETIME = 1.55\nconst SYNTHETIC_RETIRE_MS = 260\nconst PHYSICAL_EFFECT_FADE_IN_MS = 120`,
    'effect transition timing',
  )

  content = replaceOnce(
    content,
    `  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1)\n  const visuals = new Map<string, CollisionEffectVisual>()\n  const right = new THREE.Vector3()`,
    `  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1)\n  const visuals = new Map<string, CollisionEffectVisual>()\n  const previousSyntheticBodies = new Map<string, BodyState>()\n  const retiringSyntheticBodies = new Map<string, { body: BodyState; startedAt: number }>()\n  const physicalEffectIntroducedAt = new Map<string, number>()\n  const right = new THREE.Vector3()`,
    'effect transition state',
  )

  content = replaceOnce(
    content,
    `  const updateVisual = (visual: CollisionEffectVisual, body: BodyState, camera: THREE.Camera) => {`,
    `  const updateVisual = (\n    visual: CollisionEffectVisual,\n    body: BodyState,\n    camera: THREE.Camera,\n    opacityScale = 1,\n  ) => {`,
    'updateVisual opacity scale',
  )

  content = replaceOnce(
    content,
    `    uniforms.uOpacity.value = profile.baseOpacity * profile.fadeAlpha`,
    `    uniforms.uOpacity.value = profile.baseOpacity * profile.fadeAlpha * clamp(opacityScale, 0, 1)`,
    'effect opacity scale application',
  )

  content = replaceOnce(
    content,
    `    update(bodies: BodyState[], camera: THREE.Camera) {\n      const physicalEffects = bodies.filter((body) => body.bodyType === 'effect')\n      const syntheticEffects = getSyntheticStellarEffects(bodies)\n      const effects = [...physicalEffects, ...syntheticEffects]\n      const currentIds = new Set(effects.map((body) => body.id))\n\n      Array.from(visuals.keys()).forEach((id) => {\n        if (!currentIds.has(id)) remove(id)\n      })\n      effects.forEach((body) => updateVisual(ensure(body), body, camera))\n    },`,
    `    update(bodies: BodyState[], camera: THREE.Camera) {\n      const now = performance.now()\n      const physicalEffects = bodies.filter((body) => body.bodyType === 'effect')\n      const syntheticEffects = getSyntheticStellarEffects(bodies)\n      const syntheticIds = new Set(syntheticEffects.map((body) => body.id))\n      const physicalIds = new Set(physicalEffects.map((body) => body.id))\n\n      // Synthetic overlap effects are regenerated from the two still-existing stars.\n      // When the solver replaces those stars with a remnant, retain the last preview\n      // briefly instead of deleting it on that exact topology-change frame.\n      previousSyntheticBodies.forEach((body, id) => {\n        if (!syntheticIds.has(id) && !retiringSyntheticBodies.has(id)) {\n          retiringSyntheticBodies.set(id, { body, startedAt: now })\n        }\n      })\n      previousSyntheticBodies.clear()\n      syntheticEffects.forEach((body) => {\n        previousSyntheticBodies.set(body.id, body)\n        retiringSyntheticBodies.delete(body.id)\n      })\n\n      const retiringEffects: Array<{ body: BodyState; opacity: number }> = []\n      retiringSyntheticBodies.forEach((entry, id) => {\n        const progress = clamp((now - entry.startedAt) / SYNTHETIC_RETIRE_MS, 0, 1)\n        if (progress >= 1) {\n          retiringSyntheticBodies.delete(id)\n          return\n        }\n        const smoothProgress = progress * progress * (3 - 2 * progress)\n        retiringEffects.push({ body: entry.body, opacity: 1 - smoothProgress })\n      })\n\n      physicalEffects.forEach((body) => {\n        if (!physicalEffectIntroducedAt.has(body.id)) physicalEffectIntroducedAt.set(body.id, now)\n      })\n      Array.from(physicalEffectIntroducedAt.keys()).forEach((id) => {\n        if (!physicalIds.has(id)) physicalEffectIntroducedAt.delete(id)\n      })\n\n      const currentIds = new Set([\n        ...physicalEffects.map((body) => body.id),\n        ...syntheticEffects.map((body) => body.id),\n        ...retiringEffects.map((entry) => entry.body.id),\n      ])\n\n      Array.from(visuals.keys()).forEach((id) => {\n        if (!currentIds.has(id)) remove(id)\n      })\n\n      physicalEffects.forEach((body) => {\n        const introducedAt = physicalEffectIntroducedAt.get(body.id) ?? now\n        const kind = body.effectVisual?.kind\n        const fadeProgress = clamp((now - introducedAt) / PHYSICAL_EFFECT_FADE_IN_MS, 0, 1)\n        const smoothFade = fadeProgress * fadeProgress * (3 - 2 * fadeProgress)\n        // The contact flash is the actual impulse and should remain immediate. Larger\n        // shear/plasma structures cross-fade in so they do not replace the overlap\n        // preview as a visibly different sprite on one frame.\n        const opacity = kind === 'contactFlash' ? 1 : 0.28 + smoothFade * 0.72\n        updateVisual(ensure(body), body, camera, opacity)\n      })\n      syntheticEffects.forEach((body) => updateVisual(ensure(body), body, camera))\n      retiringEffects.forEach(({ body, opacity }) => {\n        updateVisual(ensure(body), body, camera, opacity)\n      })\n    },`,
    'effect continuity update lifecycle',
  )

  content = replaceOnce(
    content,
    `    dispose() {\n      Array.from(visuals.keys()).forEach(remove)\n      scene.remove(group)`,
    `    dispose() {\n      previousSyntheticBodies.clear()\n      retiringSyntheticBodies.clear()\n      physicalEffectIntroducedAt.clear()\n      Array.from(visuals.keys()).forEach(remove)\n      scene.remove(group)`,
    'effect continuity dispose',
  )

  write(path, content)
}

{
  const path = 'CHANGELOG.md'
  let content = read(path)
  const marker = '- 충돌 카메라의 일반 반지름 재프레이밍 보간을 완만하게 조정했습니다.\n'
  content = replaceOnce(
    content,
    marker,
    `${marker}- 충돌 직전 합성 플라즈마 프리뷰와 충돌 후 물리 이펙트 사이에 짧은 크로스페이드를 추가해 합체 해석 프레임의 1프레임 이펙트 팝을 제거했습니다.\n`,
    'changelog effect continuity note',
  )
  write(path, content)
}

console.log('Applied collision effect continuity patch')
