# Stellar Collision Refinement Plan

- 시작 main SHA: `7d7262536ceb5040b5f4f03deaac3b57f9ba88aa` (`v0.27.0`)
- 작업 브랜치: `fix/stellar-collision-refinement`
- 개발 기준 브랜치: `staging/stellar-collision-refinement-base`
- Draft PR: `#159` — https://github.com/stafor94/3BP/pull/159

## 1단계 — 항성 중앙의 흰 점 제거

상태: **구현 반영, 미검증**

- 광구 셰이더의 좁은 Gaussian `centerHighlightMask`와 백색 혼합 가산광을 제거한다.
- 광구 출력은 `uIdentityColor * linearIntensity`의 온도색 emission 단일 경로를 사용한다.
- `centerHighlightStrength` 렌더 프로필 필드와 `uCenterHighlightStrength` uniform 생성·갱신 경로를 제거한다.
- 기존 `drawStellarEmission(viewMu)`, edge coverage, 표면 미세 변화, tone mapping, color space 처리는 유지한다.
- `stellarCollisionEnvelope.ts`가 `createStellarPhotosphereMaterialValues()`를 사용하고 `uIdentityColor`를 `vCollisionColor`로 치환하므로 일반 광구와 충돌 외피 모두 동일한 공통 광구 변경을 받는다.
- 외피 geometry/법선, 코로나, 충돌 상태 머신은 변경하지 않는다.

## 2단계 대상

- 외피 법선과 코로나 연결 상태 점검
- 일반 광구/충돌 외피의 중복 표시 여부 점검
- 충돌 중 아래쪽에 나타나는 별도 흰 점·고리 제거

## 최종 통합 검증

- 정상 크기와 확대 화면에서 중앙에 독립된 흰 점이 없는지 확인
- 차가운 항성, 태양형, 뜨거운 항성의 온도색이 유지되는지 확인
- 넓은 흰 원반이나 밝은 외곽 링이 다시 생기지 않는지 확인
- 일반 광구와 충돌 외피에 같은 변경이 적용되는지 확인

## 마지막 검증 단계에서 갱신할 기존 검사

이번 단계에서는 아래 테스트를 실행하거나 수정하지 않는다.

- `scripts/stellarRenderingRegression.ts`: `centerHighlightStrength` 0.48~0.58 및 별도 중앙 하이라이트 가산을 강제하는 검사를 새 요구에 맞게 갱신한다.
- `scripts/stellarPhotographicVisualRegression.py`: `core_luma >= 0.84` 등 기존 중심 밝기 기준을 새 요구와 함께 재검토한다.

최종 검증에서는 예전 별도 하이라이트 구현을 다시 강제하지 않는다. 온도색, 전체 발광감, 외곽 링 방지 검사는 유지하며, 결과에 맞추기 위해 임의로 임계값을 낮추지 않는다.
