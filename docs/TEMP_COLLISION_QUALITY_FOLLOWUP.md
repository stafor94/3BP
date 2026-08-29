# Collision Quality Follow-up — Temporary Work Tracker

> 임시 작업 체크포인트. 이 브랜치의 충돌 품질 수정이 기술 검증 단계까지 끝나면 최종 PR 전에 삭제한다.

## Baseline

기준: 2026-08-29 사용자 제공 녹화 `47439.mp4`, 최신 `main` 0.20.0.

관찰된 문제:

- 충돌 접촉 전후에 두 본체가 겹쳐 보이는 구간이 남아 있다.
- transient debris가 충돌점 주변에 붙어 있거나 화면 연출만 이동하는 인상이 강하다.
- 실제 fragment 운동과 화면상의 burst가 분리되어 있어, presentation-only 개선이 근본 물리 개선처럼 보일 수 있다.
- 충돌 후 remnant의 반동/운동 변화가 장면에서 충분히 읽히지 않는다.
- 충돌 → 파쇄/병합 → remnant 전환이 하나의 연속 사건보다 상태 교체처럼 보이는 구간이 있다.

## Acceptance criteria

### A. Contact / penetration
- [x] 기존 swept first-contact 결과와 collision classification을 유지한다.
- [x] 대표 head-on/merge 시나리오에서 contact bridge와 post-solver handoff가 source geometry에서 연속 시작하도록 유지한다.
- [x] collision merge handoff / frame continuity / small head-on browser regression을 모두 통과한다.

### B. Physical debris motion
- [x] 비항성 충돌에서 실제 mass-carrying ejecta velocity가 contact geometry를 반영해 충돌점에서 바깥 방향으로 분산되도록 production state를 수정했다.
- [x] ejecta spawn을 surviving solid의 실제/표시 반경과 ejecta radius 기준으로 계산해 생성 직후 물리 overlap과 표시 표면 부착을 방지한다.
- [x] renderer-only offset은 실제 물리 개선의 대체재로 사용하지 않고 실제 physical ejecta position/velocity를 화면에 노출한다.
- [x] fragment/ejecta를 포함한 represented mass 및 x/y/z linear momentum conservation을 현재 HEAD에서 유지한다.
- [x] 동일 초기 상태의 deterministic physical replay가 exact snapshot으로 일치한다.

### C. Remnant response
- [x] ejecta momentum 변경분만큼 remnant/survivor 실제 velocity에 반대 방향 공통 보정을 적용해 renderer-only recoil 없이 state에 반영했다.
- [x] remnant velocity가 ejecta momentum을 제외한 전체 운동량과 일치함을 conservation regression으로 재확인했다.
- [x] 기존 conservation regression을 tolerance 완화 없이 통과한다.

### D. Runtime continuity / visual result
- [x] solid handoff clock을 첫 실제 renderer 적용 프레임에서 시작해 body → remnant/absorbed silhouette 전환을 실제 보이는 프레임 기준으로 연속화했다.
- [x] 대표 비항성 disruption, small head-on, merge, absorb, frame continuity, mobile 시나리오를 실제 브라우저 회귀 캡처로 확인했다.
- [x] 최신-main baseline과 동일 capture 시점의 artifact를 A/B 확인했다.
  - small head-on: contact flash는 strict pillar gate를 완화하지 않고 compact/isotropic하게 변경했고, 900 ms 이후 밝은 점은 실제 mass-bearing ejecta ownership으로 전환된다. 1350 ms에는 실제 outgoing debris가 remnant 주변에서 분리되어 읽힌다.
  - solver-backed non-stellar destruction: resolve 시 physical debris 8개를 확인하고 transfer/settle 구간에서 실제 mass-bearing debris가 본체에서 분리·이동한다.
  - merge: renderer telemetry의 첫 적용 프레임은 `progress = 0`에서 source positions/radii를 보존하고 이후 absorbed/survivor가 단조롭게 수렴한다. headless screenshot centroid는 캡처 지연에 따라 흔들리므로 픽셀 단일 수치보다 실제 render-frame telemetry와 frame continuity gate를 기준으로 판정했다.
  - stellar/strict stellar, collision watch, camera handoff, absorption, actual disruption, frame continuity, mobile regression은 모두 green이다.

## Work log

- [x] 최신 `main`에서 작업 브랜치 생성: `fix/collision-quality-followup`
- [x] `AGENTS.md`, `VERSIONING.md`, `docs/AGENT_QUALITY_VALIDATION.md` 확인
- [x] 사용자 제공 영상에서 baseline 문제 목록 고정
- [x] collision/fragment 생성 경로 조사 및 renderer-only/physical ownership 분리
- [x] 실제 ejecta velocity를 collision normal 양방향 중심으로 재정렬하고 survivor momentum 보정
- [x] 실제 ejecta spawn clearance를 physical survivor 표면 기준으로 추가
- [x] small-head production regression을 좌표 proxy가 아니라 실제 solid/ejecta separation 계약으로 변경
- [x] solver-backed non-stellar visual harness로 교체해 실제 production physics를 브라우저 artifact가 검증하도록 수정
- [x] 작은 high-head-on physical spark를 숨기지 않고 isotropic/no-tail로 표시
- [x] 작은 high-head-on spark의 과대한 표시 floor를 fragment 수준으로 축소
- [x] visible survivor surface 밖까지 실제 ejecta spawn clearance를 강화
- [x] 작은 head-on contact flash를 짧고 isotropic하게 변경해 real ejecta ownership을 가리지 않도록 수정
- [x] deterministic replay + minimum ejecta clearance regression 추가
- [x] solid handoff clock을 첫 실제 WebGL renderer frame에서 시작하도록 수정
- [x] 최종 코드 후보 `b91efed` CI run #283 전체 PASS
  - versioning, physics, build
  - stellar + strict stellar
  - collision watch + camera handoff suites
  - solver-backed non-stellar destruction
  - small head-on artifact
  - merge solid handoff
  - survivor absorption + absorption continuity
  - actual disruption + frame continuity + mobile actual disruption
- [x] `b91efed` artifact 직접 눈검사 및 최신-main A/B 확인
- [x] package version `0.20.1` + CHANGELOG `0.20.1` 반영. 기존 CHANGELOG history는 release commit diff 기준 삭제/변경 없이 보존됨.
- [x] versioned HEAD `75043b41ca8560e34bc4a68bb74d4fcdcbb82103` 전체 CI run #285 (`33281789455`) PASS.
- [x] versioned HEAD browser artifact 최종 직접 눈검사 완료.
  - small head-on: impact/transfer 전 구간에서 flash/spark가 접촉점에 compact하게 유지되고 큰 세로 debris column이 보이지 않는다.
  - solver-backed non-stellar destruction: production solver가 생성한 physical debris 8개가 survivor 표면에서 실제로 분리·이동하고, source-sized ghost나 표면에 붙은 큰 debris clump/column이 보이지 않는다. minimum spawn clearance도 regression 기준을 충족한다.
  - merge solid handoff: 첫 실제 renderer frame telemetry가 `progress = 0`, `elapsed = 0`으로 시작하고 source → remnant 전환이 첫 프레임부터 연결되며 settled frame에 ghost가 남지 않는다.
  - stellar: peak 이후 single remnant로 정상 정리되며 strict stellar gate와 시각적 기존 동작이 유지된다.
  - actual disruption: source → remnant 전환 중 실루엣 공백/큰 ghost 없이 안정화된다. 이 harness는 continuity/VFX control로만 취급하며 physical solver evidence로 과장하지 않는다.
- [x] latest-main non-stellar baseline이 synthetic fixture이고 branch가 solver-backed fixture임을 유지해 non-stellar raw screenshot을 동일 physics fixture A/B라고 주장하지 않는다.

## Closeout status

- 기술 acceptance와 versioned release HEAD 검증은 모두 완료됐다.
- 이 tracker는 최종 검증 결과 기록까지 끝났으며 삭제할 수 있는 상태다.
- tracker 삭제 commit의 HEAD CI를 별도로 green 확인한 뒤 PR #105 본문을 최종 정리하고 Draft 해제 여부를 결정한다.
