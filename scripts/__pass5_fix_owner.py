#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding='utf-8')
    if source.count(old) != 1:
        raise RuntimeError(f'{path}: expected one match, got {source.count(old)}')
    target.write_text(source.replace(old, new, 1), encoding='utf-8')


patch(
    'src/rendering/stellarCoronaMaterial.ts',
    """        // SpriteMaterial uses map_particle_fragment, not the mesh map_fragment
        // chunk. Override alpha immediately after its shared texture sample so the
        // legacy radial glow texture no longer determines stellar halo shape.
        .replace(
          '#include <map_particle_fragment>',
          `#include <map_particle_fragment>
""",
    """        // SpriteMaterial uses the standard map_fragment chunk. Override alpha
        // immediately after its shared texture sample so the legacy radial glow
        // texture no longer determines stellar halo shape.
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
""",
)

patch(
    'src/rendering/simulationRenderer.ts',
    """  visual.glowInner.scale.setScalar(
    renderRadius * (isFragment ? RENDER_TUNING.fragment.innerGlowScale : RENDER_TUNING.body.innerGlowScale),
  )
  visual.glowOuter.scale.setScalar(
    renderRadius * (isFragment ? RENDER_TUNING.fragment.outerGlowScale : RENDER_TUNING.body.outerGlowScale),
  )
""",
    """  // Stellar glow scale is owned by bodyLighting's Pass 5 corona path. Keeping
  // the generic 5.4x/12x write here would overwrite the compact carrier before
  // matrix evaluation and recreate the old oversized halo footprint.
  if (body.bodyType !== 'star') {
    visual.glowInner.scale.setScalar(
      renderRadius * (isFragment ? RENDER_TUNING.fragment.innerGlowScale : RENDER_TUNING.body.innerGlowScale),
    )
    visual.glowOuter.scale.setScalar(
      renderRadius * (isFragment ? RENDER_TUNING.fragment.outerGlowScale : RENDER_TUNING.body.outerGlowScale),
    )
  }
""",
)

patch(
    'src/rendering/simulationRenderer.ts',
    """  visual.glowInnerMaterial.opacity = innerGlowOpacity * (
    isFragment ? RENDER_TUNING.fragment.innerGlowOpacityScale : 1
  ) * debrisOpacity
  visual.glowOuterMaterial.opacity = outerGlowOpacity * (
    isFragment ? RENDER_TUNING.fragment.outerGlowOpacityScale : 1
  ) * debrisOpacity
""",
    """  // Stellar corona opacity is likewise owned by bodyLighting. Planet/moon/
  // fragment/effect glow behavior remains on the existing generic path.
  if (body.bodyType !== 'star') {
    visual.glowInnerMaterial.opacity = innerGlowOpacity * (
      isFragment ? RENDER_TUNING.fragment.innerGlowOpacityScale : 1
    ) * debrisOpacity
    visual.glowOuterMaterial.opacity = outerGlowOpacity * (
      isFragment ? RENDER_TUNING.fragment.outerGlowOpacityScale : 1
    ) * debrisOpacity
  }
""",
)

patch(
    'scripts/stellarRenderingRegression.ts',
    """const stellarCoronaSource = readFileSync(
  resolve(process.cwd(), 'src/rendering/stellarCoronaMaterial.ts'),
  'utf8',
)
""",
    """const stellarCoronaSource = readFileSync(
  resolve(process.cwd(), 'src/rendering/stellarCoronaMaterial.ts'),
  'utf8',
)
const simulationRendererSource = readFileSync(
  resolve(process.cwd(), 'src/rendering/simulationRenderer.ts'),
  'utf8',
)
""",
)

patch(
    'scripts/stellarRenderingRegression.ts',
    """  assert(stellarCoronaSource.includes('diffuseColor.a = opacity * clamp(coronaAlpha, 0.0, 1.0);'), 'stellar corona shader must replace the legacy radial texture alpha shape')
  assert(stellarCoronaSource.includes('uCoronaOuterWhiteMix * coronaOuterColorWeight'), 'only the faint outer corona may weakly desaturate')
""",
    """  assert(stellarCoronaSource.includes("'#include <map_fragment>'"), 'stellar corona shader must patch the SpriteMaterial map_fragment chunk')
  assert(!stellarCoronaSource.includes('map_particle_fragment'), 'stellar corona shader must not target the Points-only map_particle_fragment chunk')
  assert(stellarCoronaSource.includes('diffuseColor.a = opacity * clamp(coronaAlpha, 0.0, 1.0);'), 'stellar corona shader must replace the legacy radial texture alpha shape')
  assert(stellarCoronaSource.includes('uCoronaOuterWhiteMix * coronaOuterColorWeight'), 'only the faint outer corona may weakly desaturate')
""",
)

patch(
    'scripts/stellarRenderingRegression.ts',
    """  assert(bodyLightingSource.includes('glowOuter.visible = false\\n    glowOuter.material.opacity = 0'), 'legacy outer Sprite must be disabled for stars to remove one draw call')
  assert(!bodyLightingSource.includes('configureStellarGlowMaterial'), 'legacy dual-layer stellar glow shader path must be removed')
""",
    """  assert(bodyLightingSource.includes('glowOuter.visible = false\\n    glowOuter.material.opacity = 0'), 'legacy outer Sprite must be disabled for stars to remove one draw call')
  assert(simulationRendererSource.includes("if (body.bodyType !== 'star') {\\n    visual.glowInner.scale.setScalar("), 'generic renderer must not overwrite stellar corona scale')
  assert(simulationRendererSource.includes("if (body.bodyType !== 'star') {\\n    visual.glowInnerMaterial.opacity = innerGlowOpacity"), 'generic renderer must not overwrite stellar corona opacity')
  assert(!bodyLightingSource.includes('configureStellarGlowMaterial'), 'legacy dual-layer stellar glow shader path must be removed')
""",
)

print('Pass 5 corona ownership fix applied')
