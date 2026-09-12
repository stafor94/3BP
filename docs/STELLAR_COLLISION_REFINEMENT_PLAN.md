# Stellar Collision Refinement Plan

- 시작 main SHA: `7d7262536ceb5040b5f4f03deaac3b57f9ba88aa` (`v0.27.0`)
- 작업 브랜치: `fix/stellar-collision-refinement`
- 개발 기준 브랜치: `staging/stellar-collision-refinement-base`
- Draft PR: `#159` — https://github.com/stafor94/3BP/pull/159

## 1단계 — 항성 중앙의 흰 점 제거

상태: **구현 반영, 미검증**

- 광구 셰이더의 좁은 Gaussian `centerHighlightMask`와 백색 혼합 가산광을 제거했다.
- 광구 출력은 `uIdentityColor * linearIntensity`의 온도색 emission 단일 경로를 사용한다.
- `centerHighlightStrength` 렌더 프로필 필드와 `uCenterHighlightStrength` uniform 생성·갱신 경로를 제거했다.
- 기존 `drawStellarEmission(viewMu)`, edge coverage, 표면 미세 변화, tone mapping, color space 처리는 유지한다.

## 2단계 — 충돌 외피의 흰 점·고리 및 중복 렌더 정리

상태: **2단계 구현 반영, 미검증**

변경 파일:
- `src/rendering/stellarCollisionEnvelope.ts`
- `src/rendering/simulationRenderer.ts`
- `docs/STELLAR_COLLISION_REFINEMENT_PLAN.md`

구현 내용:
- 고정 AXIAL/RADIAL topology에서 이음새(`j=0/RADIAL`)와 양 극점의 중복 정점을 하나의 논리 정점으로 매핑한다. 극점의 퇴화 cap 삼각형은 인덱스에서 제거하고, 동적 위치 갱신 후 면적 가중 면 법선을 논리 정점별로 합산해 동일한 normal을 공유한다. 거의 0인 법선은 단면 방사 방향 또는 축 방향으로 대체한다. 같은 normal attribute를 광구와 코로나가 공유한다.
- 외피 코로나에서 `viewMu`로 구형 projected radius를 역산하던 경로를 제거한다. 현재 단면의 실제 반지름을 vertex attribute로 전달하고, 해당 단면 크기에 비례한 normal 방향 shell 거리와 연속 지수 감쇠를 사용한다. `viewMu`는 거리 계산이 아니라 연속적인 limb 가중치에만 사용한다.
- 코로나는 한 개의 `BackSide` shell을 유지한다. 불투명 외피는 `depthTest/depthWrite`를 유지하고, 코로나는 `depthTest=true`, `depthWrite=false`로 외피 내부의 중복 가산을 depth buffer로 차단한다. 색은 외피의 `vCollisionColor`를 그대로 따른다.
- 이 코로나는 실제 부피 밀도를 적분하는 volumetric/raymarch가 아니라, 단면 반지름과 표면 normal offset에 기반한 단일 shell 근사다.
- `simulationRenderer`가 이미 보유한 scene별 `visuals: Map<body.id, VisualBody>`를 재사용해 `body.id`로 광구·corona·secondary glow를 반환하는 scene resolver를 제공한다. 외피는 `uSeed`나 `scene.children` 인접 순서를 사용하지 않고 이 참조만 숨긴다.
- resolver는 현재 simulation body ID만 노출하므로 trail 보존용 오래된 `VisualBody`는 외피 표시 대상으로 남지 않는다. renderer dispose 시 활성 ID와 resolver를 정리한다.
- 외피 레이어가 숨기기 전의 `visible` 값을 객체별로 저장하고, 억제가 끝나거나 layer가 dispose될 때 그 값만 복원한다. 원래 숨겨져 있던 객체를 강제로 켜지 않는다.
- 프레임 순서는 `syncBodyPresentationBeforeRender` 뒤 `updateLiveCollisionVfxFrame`에서 외피 억제를 적용한 후 `renderer.render`가 실행되는 기존 구조를 유지한다.

검증 상태:
- 이번 단계에서는 테스트, 빌드, 타입 검사, lint, 브라우저 실행, 영상·스크린샷 캡처, CI를 실행하지 않았다.
- 영상 `52869.mp4`의 흰 점·고리가 실제로 사라졌는지는 아직 확인하지 않았다. 법선/코로나/중복 표시 중 어느 항목이 직접 원인이었는지도 런타임 검증 전에는 확정하지 않는다.

## 최종 통합 검증

- 정상 크기와 확대 화면에서 중앙에 독립된 흰 점이 없는지 확인
- 차가운 항성, 태양형, 뜨거운 항성의 온도색이 유지되는지 확인
- 넓은 흰 원반이나 밝은 외곽 링이 다시 생기지 않는지 확인
- 일반 광구와 충돌 외피에 같은 1단계 변경이 적용되는지 확인
- 충돌 외피의 이음새·극점에 밝은 점이나 줄이 생기지 않는지 확인
- 접촉부에 독립적인 흰 고리나 중복 광구가 남지 않는지 확인
- 일반 항성 ↔ 외피 전환에서 코로나가 중복되거나 사라지지 않는지 확인
- 카메라 회전 시 점·고리·법선 이음새가 드러나지 않는지 확인
- 리셋·합체·연속 충돌 뒤 원본 항성이 잘못 숨겨지지 않는지 확인
- 항성 온도색과 외곽 발광이 유지되는지 확인

## 마지막 검증 단계에서 갱신할 기존 검사

이번 단계에서는 아래 테스트를 실행하거나 수정하지 않는다.

- `scripts/stellarRenderingRegression.ts`: `centerHighlightStrength` 0.48~0.58 및 별도 중앙 하이라이트 가산을 강제하는 검사를 새 요구에 맞게 갱신한다.
- `scripts/stellarPhotographicVisualRegression.py`: `core_luma >= 0.84` 등 기존 중심 밝기 기준을 새 요구와 함께 재검토한다.

최종 검증에서는 예전 별도 하이라이트 구현을 다시 강제하지 않는다. 온도색, 전체 발광감, 외곽 링 방지 검사는 유지하며, 결과에 맞추기 위해 임의로 임계값을 낮추지 않는다.

## 3단계 대상

접촉·물질 이동·안정화의 시간과 이벤트 식별을 공통 정의로 정리한다. 2단계에서는 이 작업을 시작하지 않는다.
