import { readFile, writeFile } from 'node:fs/promises'

const path = new URL('../CHANGELOG.md', import.meta.url)
let changelog = await readFile(path, 'utf8')

if (changelog.includes('## [0.18.7] - 2026-08-26')) {
  console.log('historical 0.18.2-0.18.7 entries already restored')
  process.exit(0)
}

const marker = '## [0.18.1] - 2026-08-26'
if (!changelog.includes(marker)) {
  throw new Error('expected 0.18.1 changelog marker not found')
}

const restored = `## [0.18.7] - 2026-08-26

### Fixed
- 실제 충돌 렌더 경로에 white-hot impact core, 넓은 halo, 양방향 plasma burst를 추가해 항성 합체 직전 두 원판이 그대로 노출되거나 잔존체가 너무 일찍 드러나던 문제를 보완했습니다.
- 브라우저 픽셀 게이트를 강화해 충돌 topology 전환이 시각 효과로 충분히 가려지지 않으면 배포 전에 실패하도록 했습니다.

## [0.18.6] - 2026-08-26

### Fixed
- 얇은 topology mask를 충돌 normal 축을 따라 배치되는 screen-space occlusion veil로 교체하고, shock plane과 양방향 plasma를 함께 유지해 잔존체 reveal 동안 두 항성의 topology 전환을 안정적으로 가리도록 했습니다.
- mask 방향, 두 항성 전체 span 커버리지, alpha occlusion blending, retire timing을 회귀 검증하도록 보강했습니다.

## [0.18.5] - 2026-08-26

### Added
- 항성-항성 topology handoff 위에 넓은 white-hot contact ridge, compression plane, 양방향 plasma를 직접 렌더링하는 전용 topology mask를 추가했습니다.

### Changed
- 잔존체가 처음 드러나는 구간까지 impact peak mask를 유지하고 render-layer geometry/opacity 회귀 검증을 추가했습니다.

## [0.18.4] - 2026-08-26

### Changed
- 항성 합체의 pre-merge compression 단계부터 collision-watch impact를 시작하고 presentation bridge를 연장·plateau 처리해 실제 topology 전환까지 충돌 연출이 끊기지 않도록 했습니다.
- synthetic pre-impact VFX에서 physical VFX로 넘어가는 topology masking을 강화하고 짧은 프레임 수 허용 대신 순서·타이밍 회귀 검증을 사용하도록 변경했습니다.

## [0.18.3] - 2026-08-26

### Changed
- synthetic stellar flash·shear·plasma가 compression 진행도에 맞춰 점진적으로 형성되고 staged overlap 구간 안에서 plasma가 활성화되도록 연결했습니다.
- glow 튜닝 값을 shader에 실제 반영하고 synthetic 연출에서 physical impact VFX로 넘어가는 handoff를 강화했습니다.

## [0.18.2] - 2026-08-26

### Changed
- 항성-항성 접촉을 topology 결과가 드러나기 전에 반드시 보이는 impact envelope를 거치도록 하고 collision outcome별 VFX를 강화했습니다.

### Fixed
- exact-contact 상태에서도 topology masking이 유지되는지 회귀 검증을 추가하면서 비항성 충돌 동작은 기존 경로를 유지했습니다.

`

changelog = changelog.replace(marker, restored + marker)
await writeFile(path, changelog, 'utf8')
console.log('restored changelog releases 0.18.2 through 0.18.7')
