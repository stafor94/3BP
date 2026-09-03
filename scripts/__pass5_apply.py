#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, got {count}')
    return source.replace(old, new, 1)


def regex_once(source: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one regex match, got {count}')
    return result


CORONA_MODULE = r'''import * as THREE from 'three'

export const STELLAR_CORONA_RENDER_PATH = 'stellar-corona-pass5'

type StellarCoronaUniformState = {
  uCoronaTime: { value: number }
  uCoronaSeed: { value: number }
  uCoronaPhotosphereRadiusUv: { value: number }
  uCoronaOuterWhiteMix: { value: number }
}

export type StellarCoronaFrame = {
  seed: number
  timeSeconds: number
  photosphereRadiusUv: number
  outerWhiteMix: number
}

export function configureStellarCoronaMaterial(
  material: THREE.SpriteMaterial,
  frame: StellarCoronaFrame,
) {
  if (material.blending !== THREE.NormalBlending) {
    material.blending = THREE.NormalBlending
    material.needsUpdate = true
  }

  material.userData.stellarCoronaTime = frame.timeSeconds
  material.userData.stellarCoronaSeed = frame.seed
  material.userData.stellarCoronaPhotosphereRadiusUv = frame.photosphereRadiusUv
  material.userData.stellarCoronaOuterWhiteMix = frame.outerWhiteMix

  if (!material.userData.stellarCoronaShaderInstalled) {
    material.userData.stellarCoronaShaderInstalled = true
    material.onBeforeCompile = (shader) => {
      const uniforms: StellarCoronaUniformState = {
        uCoronaTime: { value: material.userData.stellarCoronaTime ?? 0 },
        uCoronaSeed: { value: material.userData.stellarCoronaSeed ?? 0 },
        uCoronaPhotosphereRadiusUv: {
          value: material.userData.stellarCoronaPhotosphereRadiusUv ?? 0.72,
        },
        uCoronaOuterWhiteMix: {
          value: material.userData.stellarCoronaOuterWhiteMix ?? 0.02,
        },
      }
      shader.uniforms.uCoronaTime = uniforms.uCoronaTime
      shader.uniforms.uCoronaSeed = uniforms.uCoronaSeed
      shader.uniforms.uCoronaPhotosphereRadiusUv = uniforms.uCoronaPhotosphereRadiusUv
      shader.uniforms.uCoronaOuterWhiteMix = uniforms.uCoronaOuterWhiteMix
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uCoronaTime;
          uniform float uCoronaSeed;
          uniform float uCoronaPhotosphereRadiusUv;
          uniform float uCoronaOuterWhiteMix;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec2 coronaDelta = vMapUv - vec2(0.5);
          float coronaRadius = length(coronaDelta) * 2.0;
          float coronaAngle = atan(coronaDelta.y, coronaDelta.x);
          float coronaPhotosphereRadius = clamp(uCoronaPhotosphereRadiusUv, 0.54, 0.82);
          float coronaSpan = max(1.0 - coronaPhotosphereRadius, 0.08);
          float coronaDistance01 = max(coronaRadius - coronaPhotosphereRadius, 0.0) / coronaSpan;
          float coronaPhase = uCoronaTime * 0.0016;
          float coronaAngularA = sin(coronaAngle * 5.0 + uCoronaSeed * 0.071 + coronaPhase);
          float coronaAngularB = sin(coronaAngle * 9.0 - uCoronaSeed * 0.113 - coronaPhase * 0.73);
          float coronaAngularWarp = coronaAngularA * 0.050 + coronaAngularB * 0.024;
          float coronaWarpWeight = smoothstep(0.05, 0.88, coronaDistance01);
          float warpedDistance01 = max(
            coronaDistance01 * (1.0 + coronaAngularWarp * coronaWarpWeight),
            0.0
          );
          float coronaOutsideMask = smoothstep(
            coronaPhotosphereRadius - 0.010,
            coronaPhotosphereRadius + 0.014,
            coronaRadius
          );
          float coronaNearLimb = exp(-pow(warpedDistance01 / 0.14, 2.0));
          float coronaOuter =
            exp(-warpedDistance01 * 5.4) *
            (1.0 - smoothstep(0.72, 1.0, warpedDistance01));
          float coronaAngularBrightness = clamp(
            1.0 + coronaAngularA * 0.040 + coronaAngularB * 0.018,
            0.92,
            1.08
          );
          float coronaSpriteEdge = 1.0 - smoothstep(0.91, 1.0, coronaRadius);
          float coronaAlpha =
            coronaOutsideMask *
            (coronaNearLimb * 0.84 + coronaOuter * 0.16) *
            coronaAngularBrightness *
            coronaSpriteEdge;
          diffuseColor.a = opacity * clamp(coronaAlpha, 0.0, 1.0);
          float coronaOuterColorWeight = smoothstep(0.14, 0.78, warpedDistance01);
          float coronaPeak = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
          diffuseColor.rgb = mix(
            diffuseColor.rgb,
            vec3(coronaPeak),
            uCoronaOuterWhiteMix * coronaOuterColorWeight
          );`,
        )
      material.userData.stellarCoronaUniforms = uniforms
    }
    material.customProgramCacheKey = () => STELLAR_CORONA_RENDER_PATH
    material.needsUpdate = true
  }

  const uniforms = material.userData.stellarCoronaUniforms as StellarCoronaUniformState | undefined
  if (uniforms) {
    uniforms.uCoronaTime.value = frame.timeSeconds
    uniforms.uCoronaSeed.value = frame.seed
    uniforms.uCoronaPhotosphereRadiusUv.value = frame.photosphereRadiusUv
    uniforms.uCoronaOuterWhiteMix.value = frame.outerWhiteMix
  }
}
'''

PROFILE_MODULE = r'''export type StellarRenderProfile = {
  photosphereIntensity: number
  whiteHotMix: number
  coronaScale: number
  coronaOpacity: number
  coronaOuterWhiteMix: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function getCompressedStellarLuminosity01(luminositySolar: number) {
  const safeLuminosity = Math.max(
    Number.isFinite(luminositySolar) ? luminositySolar : 1,
    0.0001,
  )

  // Rendered brightness deliberately spans a much smaller range than physical
  // luminosity. This keeps multi-order-of-magnitude stellar luminosities legible
  // on SDR displays without erasing the photosphere hue through clipping.
  return clamp((Math.log10(safeLuminosity) + 2.5) / 8.5, 0, 1)
}

export function getStellarRenderProfile(
  luminositySolar: number,
  surfaceTemperatureK: number,
): StellarRenderProfile {
  const luminosity01 = getCompressedStellarLuminosity01(luminositySolar)
  const temperature01 = clamp(
    ((Number.isFinite(surfaceTemperatureK) ? surfaceTemperatureK : 5778) - 2800) / 27200,
    0,
    1,
  )

  return {
    photosphereIntensity: 0.92 + luminosity01 * 0.10 + temperature01 * 0.035,
    whiteHotMix: 0.008 + temperature01 * 0.032 + luminosity01 * 0.012,
    // The corona carrier stays close to the photosphere. A sprite scale near 2.8
    // puts the photosphere boundary around 0.7 in radial sprite UV, leaving only
    // a compact band for the shader-controlled near-limb and outer corona.
    coronaScale: 2.72 + luminosity01 * 0.24,
    coronaOpacity: 0.235 + luminosity01 * 0.095,
    // Only the faint outer tail may desaturate, and even there very slightly.
    coronaOuterWhiteMix: 0.014 + luminosity01 * 0.020,
  }
}
'''

VISUAL_SCRIPT = r'''#!/usr/bin/env python3
from __future__ import annotations

import base64
import io
import json
import math
import os
import statistics
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

import stellarGranulationLodVisualRegression as lod
import stellarLimbVisualRegression as limb
import stellarPhotosphereVisualRegression as base

OUTPUT_DIR = Path('stellar-corona-artifacts')
BASELINE_REF = os.environ.get(
    'STELLAR_CORONA_BASELINE_REF',
    '93bb0d481464e633d6c15e91ecbcac51040c3555',
)
ZOOM_LEVELS = {
    'normal': 0,
    'large': -8,
}


def capture_level(driver, label: str, root_url: str, wheel_steps: int) -> Path:
    canvas = lod.prepare_scene(driver, root_url)
    lod.apply_zoom(driver, canvas, wheel_steps, settle_frames=45)
    path = OUTPUT_DIR / f'{label}-mobile.png'
    base.require(bool(canvas.screenshot(str(path))) and path.exists(), f'{label}: capture failed')
    return path


def sample_luma(image: Image.Image, x: float, y: float) -> float:
    width, height = image.size
    ix = min(width - 1, max(0, int(round(x))))
    iy = min(height - 1, max(0, int(round(y))))
    pixels = image.load()
    samples = []
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            sx = min(width - 1, max(0, ix + ox))
            sy = min(height - 1, max(0, iy + oy))
            samples.append(base.luminance(pixels[sx, sy]))
    return sum(samples) / len(samples)


def radial_profile(image: Image.Image, center: tuple[float, float], angle: float, max_radius: int) -> list[float]:
    cx, cy = center
    return [
        sample_luma(image, cx + math.cos(angle) * radius, cy + math.sin(angle) * radius)
        for radius in range(max_radius)
    ]


def chroma_at(image: Image.Image, x: float, y: float) -> float:
    width, height = image.size
    ix = min(width - 1, max(0, int(round(x))))
    iy = min(height - 1, max(0, int(round(y))))
    r, g, b = image.getpixel((ix, iy))
    peak = max(r, g, b)
    return (peak - min(r, g, b)) / max(float(peak), 1.0)


def side_corona_metrics(image: Image.Image, side: str) -> dict[str, float]:
    center = limb.find_star_center(image, side)
    outward = math.pi if side == 'left' else 0.0
    extents: list[float] = []
    halo_core_ratios: list[float] = []
    annulus_chroma: list[float] = []
    width, height = image.size
    max_radius = min(width // 2 - 3, height // 2 - 3)

    for offset in (-0.72, -0.54, -0.36, -0.18, 0.0, 0.18, 0.36, 0.54, 0.72):
        angle = outward + offset
        profile = radial_profile(image, center, angle, max_radius)
        metrics = limb.profile_metrics(profile)
        core = int(round(float(metrics['core_radius_px'])))
        halo = int(round(float(metrics['halo_radius_px'])))
        extents.append(max(0.0, float(halo - core)))
        core_start = max(2, int(core * 0.28))
        core_end = max(core_start + 1, int(core * 0.68))
        core_luma = sum(profile[core_start:core_end]) / max(core_end - core_start, 1)
        halo_start = min(len(profile) - 1, core + 2)
        halo_end = min(len(profile), max(halo_start + 2, halo + 1))
        halo_luma = sum(profile[halo_start:halo_end]) / max(halo_end - halo_start, 1)
        halo_core_ratios.append(halo_luma / max(core_luma, 1.0))
        sample_radius = core + min(3, max(1, halo - core))
        annulus_chroma.append(chroma_at(
            image,
            center[0] + math.cos(angle) * sample_radius,
            center[1] + math.sin(angle) * sample_radius,
        ))

    return {
        'corona_extent_mean_px': statistics.fmean(extents),
        'corona_extent_std_px': statistics.pstdev(extents),
        'halo_to_core_luma': statistics.fmean(halo_core_ratios),
        'corona_annulus_chroma': statistics.fmean(annulus_chroma),
    }


def analyze(path: Path) -> dict[str, float | int]:
    image = Image.open(path).convert('RGB').filter(ImageFilter.GaussianBlur(radius=1.0))
    metrics = limb.analyze(path)
    sides = [side_corona_metrics(image, side) for side in ('left', 'right')]
    for key in (
        'corona_extent_mean_px',
        'corona_extent_std_px',
        'halo_to_core_luma',
        'corona_annulus_chroma',
    ):
        metrics[key] = sum(float(side[key]) for side in sides) / len(sides)
    return metrics


def validate_level(level: str, baseline: dict[str, float | int], current: dict[str, float | int]) -> None:
    base_extent = float(baseline['corona_extent_mean_px'])
    current_extent = float(current['corona_extent_mean_px'])
    base.require(
        current_extent <= base_extent * 0.76 + 2.0,
        f'{level}: corona did not become materially more compact: baseline={base_extent:.2f}px current={current_extent:.2f}px',
    )

    base_ratio = float(baseline['halo_to_core_luma'])
    current_ratio = float(current['halo_to_core_luma'])
    base.require(
        current_ratio <= base_ratio * 0.90 + 0.02,
        f'{level}: halo still competes with photosphere: baseline={base_ratio:.4f} current={current_ratio:.4f}',
    )

    base.require(
        float(current['corona_extent_std_px']) >= 0.18,
        f'{level}: corona boundary is reading as perfectly concentric',
    )

    base.require(
        float(current['edge_inside_luma']) >= float(baseline['edge_inside_luma']) * 0.78 - 4.0,
        f'{level}: a dark/gray ring appeared at the Pass 4 stellar edge',
    )
    base.require(
        float(current['corona_annulus_chroma']) >= float(baseline['corona_annulus_chroma']) * 0.62 - 0.015,
        f'{level}: corona lost too much stellar temperature chroma',
    )

    hue_delta = sum(
        (float(current[channel]) - float(baseline[channel])) ** 2
        for channel in ('hue_r', 'hue_g', 'hue_b')
    ) ** 0.5
    base.require(hue_delta <= 0.030, f'{level}: stellar temperature hue drifted: {hue_delta:.5f}')
    base.require(
        float(current['surface_neighbor_contrast']) >= float(baseline['surface_neighbor_contrast']) * 0.70,
        f'{level}: Pass 2/3 photosphere granulation regressed',
    )
    base.require(
        float(current['hard_edge_drop']) <= float(baseline['hard_edge_drop']) * 1.12 + 1.0,
        f'{level}: Pass 4 soft stellar edge became materially harder',
    )
    base.require(
        float(current['edge_transition_width_px']) >= float(baseline['edge_transition_width_px']) * 0.80,
        f'{level}: Pass 4 edge transition became materially narrower',
    )


def make_contact_sheet(paths: dict[str, dict[str, Path]]) -> Path:
    first = Image.open(paths['baseline']['normal']).convert('RGB')
    margin = 12
    label_height = 30
    row_height = first.height + label_height
    sheet = Image.new(
        'RGB',
        (first.width * 2 + margin * 3, row_height * 2 + margin * 2),
        (12, 14, 20),
    )
    draw = ImageDraw.Draw(sheet)
    for row, level in enumerate(('normal', 'large')):
        y = margin + row * row_height
        draw.text((margin, y), f'Pass 4 main / {level}', fill=(235, 238, 245))
        draw.text((margin * 2 + first.width, y), f'Pass 5 compact corona / {level}', fill=(235, 238, 245))
        baseline = Image.open(paths['baseline'][level]).convert('RGB')
        current = Image.open(paths['current'][level]).convert('RGB')
        sheet.paste(baseline, (margin, y + label_height))
        sheet.paste(current, (margin * 2 + first.width, y + label_height))
    output = OUTPUT_DIR / 'mobile-pass4-pass5-contact-sheet.png'
    sheet.save(output)
    return output


def print_review_image(path: Path) -> None:
    image = Image.open(path).convert('RGB')
    image.thumbnail((820, 1180))
    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=82, optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    print('STELLAR_CORONA_REVIEW_JPEG_BASE64_BEGIN')
    for index in range(0, len(encoded), 120):
        print(encoded[index:index + 120])
    print('STELLAR_CORONA_REVIEW_JPEG_BASE64_END')


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    base.OUTPUT_DIR = OUTPUT_DIR
    base.wait_for_url(base.CURRENT_URL)
    driver = base.make_driver()
    paths: dict[str, dict[str, Path]] = {'baseline': {}, 'current': {}}
    try:
        with base.baseline_preview(BASELINE_REF) as baseline_url:
            for level, wheel_steps in ZOOM_LEVELS.items():
                paths['baseline'][level] = capture_level(driver, f'baseline-{level}', baseline_url, wheel_steps)
        for level, wheel_steps in ZOOM_LEVELS.items():
            paths['current'][level] = capture_level(driver, f'current-{level}', base.CURRENT_URL, wheel_steps)
    finally:
        driver.quit()

    metrics = {
        side: {level: analyze(path) for level, path in side_paths.items()}
        for side, side_paths in paths.items()
    }
    for level in ZOOM_LEVELS:
        validate_level(level, metrics['baseline'][level], metrics['current'][level])

    contact_sheet = make_contact_sheet(paths)
    payload = {
        'baseline_ref': BASELINE_REF,
        'viewport': {'width': base.VIEWPORT_WIDTH, 'height': base.VIEWPORT_HEIGHT, 'mobile': True},
        'scene': 'stellar-topology/separate',
        'zoom_levels': ZOOM_LEVELS,
        'metrics': metrics,
    }
    (OUTPUT_DIR / 'metrics.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')

    for level in ZOOM_LEVELS:
        baseline = metrics['baseline'][level]
        current = metrics['current'][level]
        print(
            f'stellar corona {level}: '
            f"extent {float(baseline['corona_extent_mean_px']):.2f}px -> {float(current['corona_extent_mean_px']):.2f}px, "
            f"halo/core {float(baseline['halo_to_core_luma']):.4f} -> {float(current['halo_to_core_luma']):.4f}, "
            f"boundary std {float(current['corona_extent_std_px']):.2f}px, "
            f"edge luma {float(baseline['edge_inside_luma']):.2f} -> {float(current['edge_inside_luma']):.2f}"
        )
    print_review_image(contact_sheet)
    print('stellar corona mobile Pass 4/Pass 5 A/B: ok')


if __name__ == '__main__':
    main()
'''


def patch_body_lighting() -> None:
    path = 'src/rendering/bodyLighting.ts'
    source = read(path)
    source = replace_once(
        source,
        "} from './stellarPhotosphereMaterial'\n",
        "} from './stellarPhotosphereMaterial'\nimport { configureStellarCoronaMaterial } from './stellarCoronaMaterial'\n",
        'bodyLighting corona import',
    )
    source = replace_once(
        source,
        "const outerHaloColorScratch = new THREE.Color()\nconst whiteColor = new THREE.Color('#ffffff')\n",
        '',
        'bodyLighting legacy color scratch',
    )
    source = regex_once(
        source,
        r"type StellarGlowLayer = 'inner' \| 'outer'\ntype StellarGlowUniformState = \{.*?\n\}\n\n",
        '',
        'bodyLighting legacy glow type block',
    )
    source = regex_once(
        source,
        r"function configureStellarGlowMaterial\(.*?\n\}\n\nfunction setBodyGlowVisibility\(",
        'function setBodyGlowVisibility(',
        'bodyLighting legacy glow shader function',
    )
    source = regex_once(
        source,
        r"function setBodyGlowVisibility\(.*?\n\}\n\nfunction updateStellarBodyPresentation\(",
        r'''function setBodyGlowVisibility(
  scene: THREE.Scene,
  objectIndex: number,
  visible: boolean,
  body?: BodyState,
  stellarFrame?: StellarPhotosphereFrame,
) {
  const glowInner = scene.children[objectIndex - 1]
  const glowOuter = scene.children[objectIndex - 2]

  if (!visible || !body || !stellarFrame) {
    if (glowInner instanceof THREE.Sprite && glowInner.material instanceof THREE.SpriteMaterial) {
      glowInner.visible = false
      glowInner.material.opacity = 0
    }
    if (glowOuter instanceof THREE.Sprite && glowOuter.material instanceof THREE.SpriteMaterial) {
      glowOuter.visible = false
      glowOuter.material.opacity = 0
    }
    return
  }

  const renderProfile = stellarFrame.renderProfile
  const renderRadius = Math.max(body.radius, STELLAR_VISUAL_MIN_RADIUS)
  const coronaSeed = getBodySeed(body.id)

  // Pass 5 reuses the existing inner glow Sprite as the only stellar corona carrier.
  // Its shader draws only the photosphere-adjacent band; the old radial texture
  // alpha no longer defines the stellar halo shape.
  if (glowInner instanceof THREE.Sprite && glowInner.material instanceof THREE.SpriteMaterial) {
    configureStellarCoronaMaterial(glowInner.material, {
      seed: coronaSeed,
      timeSeconds: stellarFrame.animationTimeSeconds,
      photosphereRadiusUv: 2 / renderProfile.coronaScale,
      outerWhiteMix: renderProfile.coronaOuterWhiteMix,
    })
    glowInner.visible = true
    glowInner.material.color.set(stellarFrame.displayColor)
    glowInner.material.opacity = renderProfile.coronaOpacity
    glowInner.scale.setScalar(renderRadius * renderProfile.coronaScale)
  }

  // Keep the shared VisualBody allocation/layout intact for planets/fragments, but
  // stellar rendering no longer submits the legacy second halo Sprite draw call.
  if (glowOuter instanceof THREE.Sprite && glowOuter.material instanceof THREE.SpriteMaterial) {
    glowOuter.visible = false
    glowOuter.material.opacity = 0
  }
}

function updateStellarBodyPresentation(''',
        'bodyLighting single corona visibility',
    )
    write(path, source)


def patch_regression() -> None:
    path = 'scripts/stellarRenderingRegression.ts'
    source = read(path)
    source = replace_once(
        source,
        "const stellarMaterialSource = readFileSync(\n  resolve(process.cwd(), 'src/rendering/stellarPhotosphereMaterial.ts'),\n  'utf8',\n)\n",
        "const stellarMaterialSource = readFileSync(\n  resolve(process.cwd(), 'src/rendering/stellarPhotosphereMaterial.ts'),\n  'utf8',\n)\nconst stellarCoronaSource = readFileSync(\n  resolve(process.cwd(), 'src/rendering/stellarCoronaMaterial.ts'),\n  'utf8',\n)\n",
        'stellar regression corona source',
    )
    source = replace_once(
        source,
        "  assert(hot.render.innerGlowOpacity > cool.render.innerGlowOpacity, 'higher luminosity must still read through stronger inner glow')\n  assert(hot.render.outerGlowScale > cool.render.outerGlowScale, 'higher luminosity must still read through a larger halo')\n",
        "  assert(hot.render.coronaOpacity > cool.render.coronaOpacity, 'higher luminosity must still read through a slightly stronger compact corona')\n  assert(hot.render.coronaScale > cool.render.coronaScale, 'higher luminosity may still read through a subtly larger compact corona')\n",
        'stellar regression luminosity corona',
    )
    source = replace_once(
        source,
        "    assert(render.innerGlowOpacity < 0.5, 'inner glow must not become an opaque white disc')\n    assert(render.outerGlowOpacity < render.innerGlowOpacity, 'outer halo must remain weaker than inner glow')\n    assert(render.outerGlowScale > render.innerGlowScale, 'outer halo must remain spatially outside inner glow')\n    assert(render.outerHaloWhiteMix <= 0.1, 'outer halo desaturation must remain subtle')\n",
        "    assert(render.coronaScale >= 2.7 && render.coronaScale <= 3.0, 'single corona carrier must remain compact around the photosphere')\n    assert(render.coronaOpacity < 0.35, 'compact corona must stay subordinate to the photosphere')\n    assert(render.coronaOuterWhiteMix <= 0.035, 'outer corona desaturation must remain very subtle')\n",
        'stellar regression core hierarchy',
    )
    source = replace_once(
        source,
        "  assert(gainedMass.render.innerGlowOpacity !== before.render.innerGlowOpacity, 'mass gain must immediately change luminosity-driven glow')\n  assert(stripped.render.innerGlowOpacity !== before.render.innerGlowOpacity, 'mass stripping must immediately change luminosity-driven glow')\n",
        "  assert(gainedMass.render.coronaOpacity !== before.render.coronaOpacity, 'mass gain must immediately change luminosity-driven corona')\n  assert(stripped.render.coronaOpacity !== before.render.coronaOpacity, 'mass stripping must immediately change luminosity-driven corona')\n",
        'stellar regression mass corona',
    )
    source = regex_once(
        source,
        r"function testCoronaUsesSubtleShaderBasedAsymmetry\(\) \{.*?\n\}\n\nfunction testNonStellarSurfacePathRemainsSeparated",
        r'''function testCoronaUsesSubtleShaderBasedAsymmetry() {
  assert(stellarCoronaSource.includes("export const STELLAR_CORONA_RENDER_PATH = 'stellar-corona-pass5'"), 'Pass 5 must use a dedicated compact corona shader customization')
  assert(stellarCoronaSource.includes('uniform float uCoronaTime;'), 'stellar corona shader must receive a slow time input')
  assert(stellarCoronaSource.includes('uniform float uCoronaSeed;'), 'stellar corona asymmetry must remain deterministic per body')
  assert(stellarCoronaSource.includes('float coronaPhase = uCoronaTime * 0.0016;'), 'corona time evolution must remain nearly imperceptible')
  assert(stellarCoronaSource.includes('coronaAngularA * 0.050 + coronaAngularB * 0.024'), 'corona radius variation must stay subtle rather than flare-like')
  assert(stellarCoronaSource.includes('float coronaNearLimb = exp(-pow(warpedDistance01 / 0.14, 2.0));'), 'corona must concentrate a thin near-limb glow immediately outside the photosphere')
  assert(stellarCoronaSource.includes('exp(-warpedDistance01 * 5.4)'), 'outer corona must decay rapidly instead of filling a large radial blur')
  assert(stellarCoronaSource.includes('diffuseColor.a = opacity * clamp(coronaAlpha, 0.0, 1.0);'), 'stellar corona shader must replace the legacy radial texture alpha shape')
  assert(stellarCoronaSource.includes('uCoronaOuterWhiteMix * coronaOuterColorWeight'), 'only the faint outer corona may weakly desaturate')
  assert(bodyLightingSource.includes('configureStellarCoronaMaterial(glowInner.material'), 'existing inner Sprite must be reused as the single corona carrier')
  assert(bodyLightingSource.includes('glowOuter.visible = false\n    glowOuter.material.opacity = 0'), 'legacy outer Sprite must be disabled for stars to remove one draw call')
  assert(!bodyLightingSource.includes('configureStellarGlowMaterial'), 'legacy dual-layer stellar glow shader path must be removed')
  assert(!stellarCoronaSource.includes('new THREE.CanvasTexture'), 'Pass 5 must not add a new texture path')
  assert(!stellarCoronaSource.includes('new THREE.Sprite'), 'Pass 5 must not allocate a new sprite')
  assert(!stellarCoronaSource.includes('new THREE.BufferGeometry'), 'Pass 5 must not add geometry')
}

function testNonStellarSurfacePathRemainsSeparated''',
        'stellar regression corona structural replacement',
    )
    write(path, source)


def patch_stellar_workflow() -> None:
    path = '.github/workflows/stellar-photosphere-quality.yml'
    source = read(path)
    source = replace_once(
        source,
        "      - 'src/rendering/stellarRenderProfile.ts'\n",
        "      - 'src/rendering/stellarRenderProfile.ts'\n      - 'src/rendering/stellarCoronaMaterial.ts'\n",
        'stellar workflow corona module path',
    )
    source = replace_once(
        source,
        "      - 'scripts/stellarLimbVisualRegression.py'\n",
        "      - 'scripts/stellarLimbVisualRegression.py'\n      - 'scripts/stellarCoronaVisualRegression.py'\n",
        'stellar workflow corona script path',
    )
    source = replace_once(
        source,
        "      - name: Build and regression checks\n        run: npm run build\n",
        "      - name: Build and regression checks\n        run: npm run build\n      - name: Stellar rendering structural regression\n        run: npx --yes tsx@4.20.5 scripts/stellarRenderingRegression.ts\n",
        'stellar workflow structural regression step',
    )
    source = replace_once(
        source,
        "      - name: Pass 4 stellar limb and edge mobile A/B regression\n        env:\n          STELLAR_LIMB_BASELINE_REF: 284d113e82523f90ae5ca92444f0eab0bbb98b26\n        run: python scripts/stellarLimbVisualRegression.py\n",
        "      - name: Pass 4 stellar limb and edge mobile A/B regression\n        env:\n          STELLAR_LIMB_BASELINE_REF: 284d113e82523f90ae5ca92444f0eab0bbb98b26\n        run: python scripts/stellarLimbVisualRegression.py\n      - name: Pass 5 compact stellar corona mobile A/B regression\n        env:\n          STELLAR_CORONA_BASELINE_REF: 93bb0d481464e633d6c15e91ecbcac51040c3555\n        run: python scripts/stellarCoronaVisualRegression.py\n",
        'stellar workflow Pass 5 visual step',
    )
    source += "\n      - name: Upload compact stellar corona A/B captures\n        if: always()\n        uses: actions/upload-artifact@v4\n        with:\n          name: stellar-corona-pass5-mobile-ab\n          path: stellar-corona-artifacts\n          if-no-files-found: warn\n          retention-days: 7\n"
    write(path, source)


def patch_version_and_changelog() -> None:
    package_path = 'package.json'
    package = read(package_path)
    package = replace_once(package, '"version": "0.24.9"', '"version": "0.24.10"', 'package version')
    write(package_path, package)

    changelog_path = 'CHANGELOG.md'
    changelog = read(changelog_path)
    entry = r'''## [0.24.10] - 2026-09-03

### Changed
- 기존 항성당 `inner glow + outer glow` Sprite 2장 구조를 단일 compact corona 경로로 교체했습니다. 기존 inner Sprite 하나만 corona carrier로 재사용하고 outer Sprite는 항성 렌더 직전에 비활성화해 두 겹의 큰 동심원 blur를 제거합니다.
- 새 stellar corona shader가 Sprite UV에서 photosphere 경계를 직접 계산해 바로 바깥에는 얇고 비교적 강한 near-limb glow를 만들고, 그 밖에는 지수적으로 빠르게 감쇠하는 희미한 corona만 남깁니다. 기존 radial glow texture의 alpha 분포는 항성 halo 형상을 더 이상 결정하지 않습니다.
- 항성 seed와 매우 느린 time phase로 corona 반경/밝기에 작은 angular variation을 주어 외곽이 완전한 동심원으로 읽히지 않게 하되 flare·ray·prominence처럼 보이는 방향성 효과는 추가하지 않습니다.
- corona 색은 기존 temperature-derived stellar color를 그대로 사용하고, photosphere에서 충분히 떨어진 희미한 outer tail에서만 최대 약 3% 수준으로 약하게 desaturate합니다.
- `stellarRenderProfile`의 기존 3.65–4.5× inner / 7.1–8.85× outer glow scale을 약 2.72–2.96×의 단일 corona carrier로 축소해 photosphere가 화면의 주 피사체로 유지되도록 했습니다.

### Performance
- 항성의 정상 렌더 draw 구조를 `photosphere sphere 1 + inner glow Sprite 1 + outer glow Sprite 1`에서 `photosphere sphere 1 + compact corona Sprite 1`로 줄여 항성당 draw call을 3개에서 2개로 감소시킵니다.
- shared `VisualBody`의 기존 Sprite 객체는 non-stellar 경로 호환을 위해 그대로 재사용하지만 stellar outer Sprite는 `visible=false`로 제출하지 않습니다. 새 texture, geometry, sprite 또는 per-frame material/object 생성은 추가하지 않습니다.

### Verification
- stellar rendering regression에 단일 corona carrier, outer Sprite 비활성화, compact scale/opacity, 빠른 radial falloff, seed/slow-time asymmetry, temperature-color 유지 및 Pass 2/3/4 shader 계약 보존을 추가했습니다.
- mobile 390×844에서 Pass 4 merge(`93bb0d4`)와 일반 거리/확대 거리를 동일 seed·동일 harness로 A/B 캡처해 halo extent, halo/core luminance, corona boundary variation, edge luminance, temperature hue, granulation contrast와 Pass 4 edge transition을 비교합니다.

### Unchanged
- Pass 2 cellular granulation, Pass 3 screen-space LOD, Pass 4 limb/silhouette shader, HDR/tone mapping, `starColors.ts`, presets/evolution physics, mass/radius/orbit/velocity/timestep/collision, planet/moon/fragment/background/collision VFX는 변경하지 않습니다.

'''
    changelog = replace_once(changelog, '## [0.24.9] - 2026-09-03\n', entry + '## [0.24.9] - 2026-09-03\n', 'changelog insert')
    write(changelog_path, changelog)


def main() -> None:
    patch_body_lighting()
    write('src/rendering/stellarRenderProfile.ts', PROFILE_MODULE)
    write('src/rendering/stellarCoronaMaterial.ts', CORONA_MODULE)
    patch_regression()
    write('scripts/stellarCoronaVisualRegression.py', VISUAL_SCRIPT)
    patch_stellar_workflow()
    patch_version_and_changelog()
    print('Pass 5 implementation patch applied')


if __name__ == '__main__':
    main()
