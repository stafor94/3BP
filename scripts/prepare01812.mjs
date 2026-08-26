import { readFile, writeFile } from 'node:fs/promises'

const packagePath = new URL('../package.json', import.meta.url)
const changelogPath = new URL('../CHANGELOG.md', import.meta.url)

const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
packageJson.version = '0.18.12'
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

let changelog = await readFile(changelogPath, 'utf8')
const releaseMarker = '## [0.18.11] - 2026-08-26'
const newRelease = `## [0.18.12] - 2026-08-26

### Changed
- 행성·위성 등 일반 고체 천체의 실제 접촉 연출을 0.03× 관찰 기준 약 0.8초 동안 유지해, 접촉 직후 한 프레임 만에 잔존체·파편으로 전환되는 현상을 완화했습니다.
- 일반 충돌 관찰의 impact/post-impact 구간을 각각 0.85초/1.8초로 늘리고, 이전 사용자 배속으로 돌아가는 복원 램프를 0.9초로 완만하게 조정했습니다.
- 일반 충돌 카메라와 충돌 정보 패널을 충돌 후 각각 약 3.8초/3.5초 동안 유지해 결과 천체와 파편 운동을 충분히 관찰할 수 있도록 했습니다.

### Fixed
- 충돌 관찰 replay가 정확히 접촉면에서 재개되면 비항성 충돌이 staged contact 경로를 건너뛰고 즉시 물리 결과로 해석되던 오류를 수정했습니다.
- 큰 흡수체가 연속 흡수로 여러 번 새 잔존체 ID를 받는 동안 원래 허용된 tracking continuation 계보가 유지돼도 이전 잔존체 ID를 찾지 못해 일반 추적이 풀리던 문제를 수정했습니다.
- BodyTrackingRail의 layout 검사가 App의 다음 추적 후보 갱신보다 먼저 실행돼 정상적인 잔존체 ID handoff를 추적 소실로 오판하던 레이스를 수정했습니다.
- 초기 질량의 50% 이하일 때 추적을 종료하는 기존 제한은 그대로 유지합니다.

`

if (!changelog.includes('## [0.18.12] - 2026-08-26')) {
  if (!changelog.includes(releaseMarker)) throw new Error('0.18.11 changelog marker not found')
  changelog = changelog.replace(releaseMarker, newRelease + releaseMarker)
  await writeFile(changelogPath, changelog, 'utf8')
}
