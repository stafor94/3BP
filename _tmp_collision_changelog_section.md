## [0.19.12] - 2026-08-28

### Changed
- 비항성 collision visual handoff를 `IMPACT → FRACTURE → TRANSFER → REMNANT_SETTLE` 명시적 lifecycle로 분리하고 source 전환과 remnant 형성 lifecycle을 독립적으로 관리하도록 구조를 정리했습니다.
- disruption/absorption source handoff는 제거된 천체의 full-body mesh/material clone을 scene에 유지하지 않고 contact/anchor 기반 particle transfer 데이터만 유지하도록 변경했습니다.
- 새 disruption remnant는 즉시 완성형 구체로 표시하지 않고 `FORMING → SETTLING → STABLE` 상태에서 작은 core scale과 0 opacity부터 최종 scale로 수렴하도록 최소 formation baseline을 적용했습니다.

### Fixed
- source full-body snapshot이 opacity fade로 남은 상태에서 별도 remnant가 드러나 원본 천체와 결과 천체가 동시에 존재하는 것처럼 보이던 구조적 순간 합체 원인을 제거했습니다.
- absorption 경로에도 남아 있던 독립 full-body source clone을 제거해 같은 ghost-sphere handoff 패턴이 재발하지 않도록 했습니다.

### Added
- handoff layer가 full-body `THREE.Mesh`를 생성하지 않는지, retained result/fragment centroid anchor를 particle transfer가 따라가는지, explicit phase와 remnant formation/settle lifecycle을 검증하는 회귀 체크를 갱신했습니다.

### Unchanged
- collision physics, merge/disruption 판정 threshold, remnant 질량/반지름/위치 계산, prediction, lineage/tracking semantics, trail, camera 및 일반 UI는 변경하지 않았습니다.
