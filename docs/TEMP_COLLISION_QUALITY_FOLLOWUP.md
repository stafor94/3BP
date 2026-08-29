# Collision Quality Follow-up — Temporary Work Tracker

> 임시 작업 체크포인트. 이 브랜치의 충돌 품질 수정이 기술 검증 단계까지 끝나면 최종 PR 전에 삭제한다.

## Baseline

기준: 2026-08-29 사용자 제공 녹화 `47439.mp4`, `main` 0.20.0.

관찰된 문제:

- 충돌 접촉 전후에 두 본체가 겹쳐 보이는 구간이 남아 있다.
- transient debris가 충돌점 주변에 붙어 있거나 화면 연출만 이동하는 인상이 강하다.
- 실제 fragment 운동과 화면상의 burst가 분리되어 있어, presentation-only 개선이 근본 물리 개선처럼 보일 수 있다.
- 충돌 후 remnant의 반동/운동 변화가 장면에서 충분히 읽히지 않는다.
- 충돌 → 파쇄/병합 → remnant 전환이 하나의 연속 사건보다 상태 교체처럼 보이는 구간이 있다.

## Acceptance criteria

### A. Contact / penetration
- [ ] 충돌은 swept first-contact 결과를 유지한다.
- [ ] 대표 head-on/merge 시나리오에서 첫 contact 이후 화면상의 본체 중심/표면 전환이 기존 `main`보다 악화되지 않는다.
- [ ] 기존 collision merge handoff / frame continuity / small head-on visual regression을 모두 통과한다.

### B. Physical debris motion
- [x] debris 개선이 필요한 비항성 충돌에서 실제 mass-carrying ejecta velocity가 contact geometry를 반영해 충돌점에서 바깥 방향으로 분산되도록 production state를 수정했다.
- [x] renderer-only offset은 실제 물리 개선의 대체재로 사용하지 않고, 실제 fragment velocity 방향을 따르는 작은 de-clumping 보조 연출로 축소했다.
- [ ] fragment/ejecta를 포함한 represented mass 및 linear momentum conservation을 유지한다. (구현은 survivor correction 포함, 전체 회귀 재검증 중)
- [ ] deterministic replay 성질을 유지한다.

### C. Remnant response
- [x] ejecta momentum 변경분만큼 remnant/survivor 실제 velocity에 반대 방향 공통 보정을 적용해 renderer-only recoil 없이 state에 반영했다.
- [ ] remnant velocity가 ejecta momentum을 제외한 전체 운동량과 일치하는지 전체 conservation regression으로 재확인한다.
- [ ] 기존 conservation regression을 tolerance 완화 없이 통과한다.

### D. Runtime continuity / visual result
- [ ] impact 직후 body → fragment/remnant handoff가 기존 `main`보다 불연속적으로 악화되지 않는다.
- [ ] 대표 비항성 disruption과 merge/absorb 시나리오를 실제 브라우저 회귀 캡처로 확인한다.
- [ ] 최종 검증에서 baseline과 변경 결과를 동일 조건으로 비교하고 남은 문제를 기록한다.

## Work log

- [x] 최신 `main`에서 작업 브랜치 생성: `fix/collision-quality-followup`
- [x] `AGENTS.md`, `VERSIONING.md`, `docs/AGENT_QUALITY_VALIDATION.md` 확인
- [x] 사용자 제공 영상에서 baseline 문제 목록 고정
- [x] collision/fragment 생성 경로 조사
  - core non-stellar head-on ejecta는 실제 state에서 주로 collision-normal 수직 방향으로 생성됨
  - renderer는 별도로 collision-normal outward offset을 추가해 물리 궤적과 화면 궤적이 불일치했음
- [x] 실제 fragment/ejecta velocity 모델 1차 수정
- [x] renderer-only fragment burst를 실제 physical velocity 종속 보조 연출로 축소
- [x] regression 추가/수정
  - production small head-on fixture에서 실제 ejecta의 collision-normal 지배도/양방향 분출/physical spawn/visual direction 정합성 검사 추가
  - renderer de-clumping이 physical velocity를 따라가고 source scale의 10% 이하인지 검사
- [ ] contact/remnant handoff 추가 수정 필요 여부 판단 — visual A/B 후 결정
- [ ] package version + CHANGELOG 업데이트
- [ ] `npm run check:physics`
  - 1차 CI: 기존 head-on spark spawn-origin 계약과 충돌하여 실패
  - 원인: 새 physical spawn은 contact point 기준인데 기존 회귀는 COM 기준으로 방향을 계산
  - 조치: 기준을 삭제하지 않고 새 physical contact-origin 계약으로 회귀를 갱신, 재검증 중
- [ ] `npm run build`
- [ ] browser visual regression / A-B 결과 확인
- [ ] 임시 tracker 삭제
- [ ] Draft PR #105 기술 검증 완료 후 ready 전환
