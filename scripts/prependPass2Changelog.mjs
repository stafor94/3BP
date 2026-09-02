import { readFile, writeFile } from 'node:fs/promises'

const path = new URL('../CHANGELOG.md', import.meta.url)
const changelog = await readFile(path, 'utf8')
const heading = '## [0.24.7] - 2026-09-03'

if (!changelog.includes(heading)) {
  const anchor = '## [0.24.6] - 2026-09-02'
  if (!changelog.includes(anchor)) throw new Error('0.24.6 changelog anchor not found')

  const release = `${heading}\n\n### Changed\n- 항성 전용 photosphere의 기존 smooth multi-scale value-noise 표면을 3D cellular granulation으로 교체해 밝은 granule cell과 더 어두운 intergranular network가 구조적으로 구분되도록 했습니다.\n- nearest/second-nearest cellular distance 차이로 얇고 불규칙한 lane을 만들고, cell별 deterministic jitter/thermal bias로 규칙적인 벌집 형태와 모든 항성의 동일 패턴을 피합니다.\n- 낮은 대비의 large convection modulation과 미세한 fine breakup을 primary cellular topology에 종속시켜 cloudy gas/rock texture처럼 읽히지 않도록 했습니다.\n- granulation frequency 상수를 stellar shader 내부에 집중시켜 Pass 3의 screen-space LOD/fwidth 작업에서 generic body shader를 수정하지 않고 확장할 수 있게 했습니다.\n\n### Performance\n- 기존 star sphere 1 draw call을 유지하며 새 texture, CanvasTexture, geometry, sprite 또는 per-frame CPU surface 생성은 추가하지 않습니다.\n- cellular field는 고정 3x3x3 neighborhood만 검색하고 large/fine value-noise octave를 각각 1회만 사용합니다.\n\n### Verification\n- stellar rendering regression에서 dedicated stellar path, cellular field, primary granule, intergranular lane, large convection, deterministic seed, temperature-color 경로와 generic body shader 격리를 검증합니다.\n- mobile 390×844의 Pass 1 main 대비 A/B에서 local contrast뿐 아니라 high-frequency structure, lane-like local minima, mean brightness, bright footprint와 hue stability를 함께 검증합니다.\n\n### Unchanged\n- \\`starColors.ts\\`와 temperature mapping, stellar preset/evolution physics, mass/radius/orbit/velocity/timestep, collision classification/outcome, planet/moon/fragment/trail/collision VFX/background 및 기존 limb/glow/corona 구조는 변경하지 않습니다.\n- screen-space granulation LOD, \\`fwidth\\`, zoom-adaptive detail, chromosphere, emissive fringe, sunspot 및 HDR/corona 재설계는 이번 Pass 범위에 포함하지 않습니다.\n\n`

  await writeFile(path, changelog.replace(anchor, release + anchor), 'utf8')
}
