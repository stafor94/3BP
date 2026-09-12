# Stellar Collision Refinement Plan

## 현재 상태

- 시작 main SHA: `7d7262536ceb5040b5f4f03deaac3b57f9ba88aa` (`v0.27.0`)
- 작업 브랜치: `fix/stellar-collision-refinement`
- PR: `#159` — https://github.com/stafor94/3BP/pull/159
- 현재 base: `main`
- 릴리스 준비 버전: `0.28.0`
- 최종 코드 검증 SHA: `e81de832f59bab35988934d92f4ed2a03e3cdf85`
- 상태: **1~7단계 구현 및 통합 검증 완료, 병합 준비 완료**

> 1~6단계 개발 당시에는 빠르게 구현을 누적하기 위해 각 단계에서 테스트·빌드·CI·브라우저 캡처를 의도적으로 미뤘다. 아래 구현 이력의 “중간 단계 미검증” 기록은 당시의 개발 이력으로 보존한다. 현재 검증 상태는 7단계 최종 통합 검증 결과가 우선한다.

## 1~6단계 구현 이력

### 1단계 — 항성 중앙의 독립 백색 하이라이트 제거

- 광구 셰이더의 좁은 `centerHighlightMask`와 백색 가산광 경로를 제거했다.
- 광구 emission은 항성 온도색을 유지하는 경로를 사용하도록 정리했다.
- `centerHighlightStrength` 계열 설정/uniform을 제거했다.
- **개발 당시 상태:** 구현 반영, 단계별 실행 검증은 7단계로 이월.

### 2단계 — 충돌 외피의 흰 점·고리 및 중복 렌더 정리

- 외피 seam/극점의 중복 정점·법선 문제를 정리하고 광구/코로나가 일관된 normal을 사용하게 했다.
- corona를 실제 단면 반지름에 기반한 single-shell 표현으로 정리하고 중복 가산을 억제했다.
- production 광구 억제/복구를 `body.id` 기반 scene resolver로 연결해 합체·삭제 뒤 퇴역 mesh가 잘못 복원되지 않게 했다.
- **개발 당시 상태:** 구현 반영, 실제 카메라/영상 판정은 7단계로 이월.

### 3단계 — 충돌 시간·진행률·이벤트 식별 통일

- 공통 simulation-time 기반 stellar collision timeline과 `eventId`를 추가했다.
- contact → solver handoff → settle 동안 event age를 연속 유지하고 overshoot를 한 번만 반영한다.
- 두 survivor가 같은 이벤트 시간을 공유해도 시간이 중복 증가하지 않도록 갱신 주체를 단일화했다.
- 실제 solver 결과로 outcome/target/body role을 다시 확정하고 동일 쌍 재충돌은 새 event ID를 사용한다.
- **개발 당시 상태:** 구현 반영, 회귀·runtime 검증은 7단계로 이월.

### 4단계 — 충돌 외피의 연속적인 형상 변화

- merge는 contact/transfer/settle에 걸쳐 압축, neck, donor 감소, receiver 성장, remnant 안정화를 하나의 연속 형상으로 연결했다.
- hit-and-run/partial-disruption은 실제 survivor별 외피를 유지하고 settle 시작에 원형으로 순간 복귀하지 않도록 terminal deformation을 이어받는다.
- 외피 중심은 실제 result/survivor 위치를 따라가며 최종 광구 복귀에서 위치·크기·색이 튀지 않도록 했다.
- **개발 당시 상태:** 구현 반영, 극단 조건 포함 runtime 검증은 7단계로 이월.

### 5단계 — 가스 이력의 확산·감쇠와 밀도 표현 개선

- stellar plasma는 실제 `body.position`의 simulation-time 이력을 기록하는 전용 ribbon trail을 사용한다.
- 오래된 sample은 넓어지고 밀도가 감소하며, 밝은 탄환 머리·고정 백색 중심선을 만들지 않도록 했다.
- 시간/거리 기반 sample 관리, 최대 40 sample 예산, pause/reset/event 변경 시 안정적인 이력 정리를 적용했다.
- **개발 당시 상태:** 구현 반영, 실제 영상의 가스 밀도·fan 판정은 7단계로 이월.

### 6단계 — 충돌 조건별 항성 분출 방향 분포 개선

- star-star ejecta의 실제 초기 속도 방향을 충돌 local frame과 outcome에 따라 결정하도록 변경했다.
- head-on은 넓은 splash, grazing은 stripping stream으로 연속 전환하며 merge/hit-and-run/partial-disruption별 방향 특성을 분리했다.
- seed를 방향 전용 채널로 분리해 기존 질량·개수·속도 크기·lifetime 난수 계약을 유지하고, remnant/survivor 운동량 보정 경로를 보존했다.
- **개발 당시 상태:** 구현 반영, finite/2D/재현성/선운동량 및 실제 fan 판정은 7단계로 이월.

## 7단계 — 통합·회귀·시각 검증

### 통합 및 회귀 검사 정리

7단계에서 다음을 완료했다.

- PR base를 `main`으로 정리하고 누적 변경을 최종 통합했다.
- `package.json`/CHANGELOG를 `0.28.0`으로 갱신했다.
- 오래된 `centerHighlightStrength`, white-core, `core_white` 강제 회귀를 새 온도색/밝기 연속성 계약으로 갱신했다.
- `scripts/stellarCollisionRefinementRegression.ts`와 physics regression 연결을 추가해 timeline 경계/overshoot, event 재사용 방지, ejecta finite·2D·재현성·방향 분포, 질량·선운동량 계약을 검사했다.
- head-on의 우연한 좁은 fan과 partial-disruption 방향 손실을 막는 결정적 spread 보강을 반영했다.
- 재충돌/혼합 충돌에서 이전 완료 stellar event metadata가 재사용되지 않는 계약을 회귀로 고정했다.

최종 코드 후보 `e81de832f59bab35988934d92f4ed2a03e3cdf85`에서 아래 Actions가 모두 `completed / success`다.

- CI: https://github.com/stafor94/3BP/actions/runs/34693149696
- Stellar Photosphere Quality: https://github.com/stafor94/3BP/actions/runs/34693149683
- Collision VFX Stage 5: https://github.com/stafor94/3BP/actions/runs/34693149682
- Space Background Quality: https://github.com/stafor94/3BP/actions/runs/34693149712

### 최종 접촉 효과 분기 수정

최종 코드 커밋 `e81de832f59bab35988934d92f4ed2a03e3cdf85`는 `src/rendering/collisionEffectRenderer.ts`에서 다음 조건을 추가했다.

- 이전: 실제 stellar contact도 `uStellar > 0.5 && uKind < 1.5` 중앙 cloud 분기에 진입할 수 있었다.
- 수정: 해당 cloud 분기를 `uSynthetic > 0.5`인 synthetic topology 표현에만 제한했다.
- 결과: 실제 물리 stellar contact는 기존 `contactFlash`의 압축된 impact sheet 경로를 사용하며, 필요한 접촉 효과 자체를 제거하지 않는다.

이 수정은 전역 밝기 축소, 검사 임계값 완화, 효과 전체 제거가 아니며 실제 문제 분기만 제한한 최소 수정이다.

## 최종 시각 판정

모든 artifact를 다시 훑지 않고 최종 판정에 필요한 최신 production 산출물과 연속 프레임만 확인했다. artifact metadata의 workflow head SHA는 모두 `e81de832f59bab35988934d92f4ed2a03e3cdf85`와 일치한다. 이전 후보 `dc868252f73296b416135579912ee7b777df5ed9` 산출물은 최신 수정의 효과를 같은 조건에서 비교하기 위한 용도로만 사용했고 최신 검증 근거를 대신하지 않았다.

### 1. 일반 항성 및 충돌 중 중앙 흰 점

근거: run `34693149683` → `stellar-photographic-production-ab`

- `cool-normal-scene.png`, `solar-normal-scene.png`, `hot-normal-scene.png`에서 온도색 광구가 유지됐다.
- 일반 항성 중앙에 주변 광구와 분리된 좁은 독립 백색 점이 보이지 않았다.
- 넓은 백색 원반이나 별도 중심 hotspot으로 회귀하지 않았다.

판정: **통과**.

### 2. 최신 접촉 분기 수정 효과 및 flash 형태

근거: run `34693149696` → `stellar-collision-visual-regression`

- 동일 head-on/oblique 조건에서 이전 `dc868252...` 후보의 접촉 중앙에 보이던 둥근 밝은 cloud/점 형태가 최신 `e81de832...`에서는 국소적인 압축 contact sheet로 바뀌었다.
- 확인 구간: `900-head-on-0.03/0.07/0.15/0.2.png`, `900-oblique-0.03/0.07.png` 및 대응 playback.
- 접촉 flash가 화면을 덮는 과도한 원형 링/섬광으로 바뀌지 않았고, 접촉 효과가 사라지지도 않았다.

판정: **통과**.

### 3. 접촉 → 합체/분리 → 광구 복귀 연속성

근거: run `34693149696`

- `stellar-collision-visual-regression`의 `900-1.0-playback.webm`, `900-0.02-playback.webm`과 대응 state JSON을 확인했다.
- 두 항성 접촉 뒤 survivor/remnant가 유지되고, 외피 형상이 광구로 복귀하는 동안 순간적인 survivor 소실이나 명백한 위치/크기 jump가 관찰되지 않았다.
- `collision-frame-continuity-visual-regression`의 pre-impact → first-contact → maximum-impact → source-handoff → remnant-first-visible → forming → settling → stable 연속 프레임을 확인했다.
- 해당 artifact의 16 ms 연속 샘플에서도 인접 radius step이 제한되어 있고 stable 시점에 별도 effect silhouette가 남지 않았다.
- `stellar-continuity-baseline`의 대상 SHA/paired continuity 조건도 최신 후보와 일치함을 확인했다.

판정: **통과**.

### 4. 작은 head-on 접촉 효과

근거: run `34693149696` → `small-head-on-collision-artifact-visual-regression`

- `01-contact`, `02-flash-080ms`, `03-flash-160ms`, `04-fracture-900ms`, `05-transfer-1350ms` 순서를 확인했다.
- 접촉부는 과도한 원형 링이 아니라 compact sheet 형태로 남고 이후 분해/전이한다.
- 필요한 접촉 효과가 통째로 사라지거나 긴 백색 가시로 바뀌지 않았다.

판정: **통과**.

### 5. 가스/fan 개선 유지

근거: run `34693149696` → `stellar-collision-visual-regression`

- `900-partial-0.15/0.2.png`, `900-hit-run-0.15/0.2.png`, oblique 후반 프레임에서 기존 가스 확산/감쇠와 outcome별 fan 방향 개선이 유지됐다.
- 긴 바늘형 백색 탄환, 규칙적인 점선 구슬, 단일 좁은 직선 fan으로의 회귀는 선택한 최신 조건에서 관찰되지 않았다.

판정: **통과**.

## 미확인 조건과 병합 차단 여부

- 이번 잔여 마감에서는 이미 완료된 전체 검사를 처음부터 반복하지 않았고, 모든 가능한 카메라 각도·극단 질량비를 새로 수동 소진하지 않았다.
- 핵심 요청 항목은 최신 production A/B, 동일 조건 이전/최신 비교, 연속 playback/프레임으로 확인했다.
- 추가 production 캡처가 필요한 누락 구간은 없었다.
- 최신 자동검사가 모두 성공했고 위 핵심 시각 항목에서 차단 결함을 관찰하지 않았으므로, 별도 미확인 조건은 현재 **병합 차단 항목으로 판단하지 않는다**.

## 종료 상태

- 최종 검증 코드 SHA: `e81de832f59bab35988934d92f4ed2a03e3cdf85`
- 소스 추가 수정: 없음
- 버전: `0.28.0`
- 통합/회귀/production 시각 검증: 완료
- 병합 준비: 완료
- 병합·배포·태그·auto-merge: 수행하지 않음
