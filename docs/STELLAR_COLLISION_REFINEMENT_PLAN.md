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
- resolver는 현재 production mesh가 활성 상태인 body만 반환한다. 합체·삭제 뒤 trail 보존 때문에 `VisualBody`가 잠시 남더라도 숨겨진 과거 mesh는 외피 표시 주체로 다시 선택하지 않는다. `removeVisual()`의 기존 Map 삭제와 renderer dispose 시 resolver 삭제를 그대로 사용한다.
- 외피 레이어가 숨기기 전의 `visible` 값과 `body.id`를 객체별로 저장한다. 억제가 끝날 때 같은 `body.id`의 현재 production 객체로 여전히 등록된 경우에만 이전 값을 복원하며, 합체·삭제·리셋으로 퇴역한 객체는 복원하지 않는다. 원래 숨겨져 있던 객체도 강제로 켜지 않는다.
- 프레임 순서는 `syncBodyPresentationBeforeRender` 뒤 `updateLiveCollisionVfxFrame`에서 외피 억제를 적용한 후 `renderer.render`가 실행되는 기존 구조를 유지한다.

검증 상태:
- 이번 단계에서는 테스트, 빌드, 타입 검사, lint, 브라우저 실행, 영상·스크린샷 캡처, CI를 실행하지 않았다.
- 영상 `52869.mp4`의 흰 점·고리가 실제로 사라졌는지는 아직 확인하지 않았다. 법선/코로나/중복 표시 중 어느 항목이 직접 원인이었는지도 런타임 검증 전에는 확정하지 않는다.

## 3단계 — 충돌 시간·진행률·이벤트 식별 통일

상태: **3단계 구현 반영, 미검증**

변경 파일:
- `src/stellarCollisionTimeline.ts` (신규)
- `src/types.ts`
- `src/physics/fragmentAwareEngineCore.ts`
- `src/rendering/stellarCollisionEnvelope.ts`
- `src/rendering/stellarPhotosphereMaterial.ts`
- `src/rendering/stellarRemnantPresentation.ts`
- `docs/STELLAR_COLLISION_REFINEMENT_PLAN.md`

### 공통 타임라인

`src/stellarCollisionTimeline.ts`는 THREE/DOM/wall clock에 의존하지 않는 순수 모듈이다. 모든 시간 단위는 **simulation seconds**다.

- `eventId`: 하나의 실제 stellar collision을 식별하는 이벤트 ID. 같은 contact→settle 동안 유지되며 같은 항성 쌍의 다음 재충돌은 새 ID를 사용한다.
- `eventAgeSeconds`: 최초 staged contact부터 누적된 simulation time.
- `contactDurationSeconds`: 기존 impact/contact bridge 길이. 기존 수치 merge `0.024`, hit-and-run `0.018`, partial disruption `0.021`초를 유지한다.
- `settleDurationSeconds`: solver 결과 확정 뒤 envelope를 유지하는 기존 `0.16`초.
- `contactProgress`: contact 구간의 0~1 진행률.
- `transferClockProgress` / `transferProgress`: 기존 `contact + settle * 0.75`, 시작 `0.14`, 폭 `0.78`의 겹치는 volume-transfer clock과 smooth curve를 그대로 이름 있는 공통 정의로 옮겼다. contact/settle을 강제 순차 3구간으로 만들지 않는다.
- `settleProgress`: 결과 확정 뒤 안정화 진행률.
- `releaseProgress`: separated outcome에 쓰던 기존 `0.045`초 release 진행률.
- `isComplete`: `contactDuration + settleDuration`을 지난 이벤트인지 여부.
- 입력은 유한한 비음수 값으로 정규화하고 모든 진행률을 0~1로 제한한다. 길이가 0인 구간은 시작 경계에서 즉시 완료된 것으로 정의한다.

`StellarCollisionPresentation`의 기존 `progress/elapsed/duration`은 호환을 위해 유지하되 공통 timeline의 파생 alias로 작성한다. production result에는 `stellarCollisionEventId`, 누적 `stellarCollisionAge`, 고정 `stellarCollisionContactDurationSeconds`를 함께 싣는다.

### 시간 갱신 주체와 contact → settle

- contact 동안 `CollisionTransition.elapsed`는 `stepBodies()`가 소비한 simulation `dt`만으로 증가한다. 렌더러와 `onBeforeRender`는 event age를 증가시키지 않는다.
- solver 결과가 나온 뒤에는 `advancePhysicalBodies()` 내부 `updateStellarCollisionTimelineState()` 한 곳만 결과 body의 누적 event age를 갱신한다. 동일 event를 공유하는 두 survivor는 각 body에 같은 누적 값을 파생해 기록할 뿐 공유 presentation 객체를 mutate하지 않으므로 시간이 두 번 증가하지 않는다.
- contact→settle 전환에서 event age를 0으로 초기화하지 않고 `contactDurationSeconds`에서 그대로 이어간다. settle 전용 나이는 `eventAgeSeconds - contactDurationSeconds`로 파생한다.
- contact 경계를 넘은 `overshoot`는 solver handoff 뒤 `advancePhysicalBodies(resolved, overshoot)` 한 번으로만 반영한다. 큰 dt가 전체 표현 수명을 넘으면 같은 호출에서 complete로 정리할 수 있다.
- `stellarCollisionPresentation`은 공통 timeline 완료 시 제거한다. body에 남는 latest-event ID/누적 age/contact duration은 완료값으로 cap하여 transient heat가 다시 wall-clock fallback으로 시작되지 않게 하고, 다음 실제 stellar collision이 결과를 인계할 때 새 event metadata로 교체한다. body 제거/시뮬레이션 reset은 기존 body 수명과 renderer reset 경로로 함께 정리된다.

### eventId 발급·전달·실제 결과 확정

- 새 카운터나 난수를 추가하지 않는다. 실제 core engine이 solver transition에서 이미 증가시키는 `collisionSerial`이 들어간 fresh `Collision flash` ID의 `flash<serial>`을 contact staging이 한 번 읽어 `stellar:<serial>` event ID로 사용한다.
- 따라서 event ID 발급이 기존 random seed, ejecta 분포, 물리 결과를 바꾸지 않는다. 같은 항성 쌍의 재충돌은 core collision serial이 달라 새 event ID가 된다.
- contact 단계의 predicted targets는 기존처럼 probe 결과를 사용한다. solver가 실제 결과를 만든 직후에는 source lineage를 기준으로 실제 stellar survivors/remnant를 다시 찾고, outcome/targets/body role을 actual result로 교체한다. merge로 body ID가 바뀌어도 event ID와 누적 age는 유지한다.
- hit-and-run/partial disruption의 두 survivor는 동일 event ID/time을 공유하되 각각 `survivorA` / `survivorB` 역할을 가진다.
- 새 stellar contact를 solver에 넘길 때 이전 stellar-event presentation metadata는 해당 stellar pair에 한해서 정리하고, 새 실제 결과가 같은 event ID/time을 이어받는다. 관련 없는 collision path의 metadata에는 적용하지 않는다.

### production 소비자

- `stellarCollisionEnvelope.ts`: merge/separate envelope의 contact, transfer, settle, release 진행률을 공통 timeline에서 소비한다. 기존 lobe/neck/volume-transfer 형상 함수와 수치 곡선은 변경하지 않았다. envelope visual key도 `eventId`를 사용해 동일 쌍 재충돌을 구분한다.
- `stellarPhotosphereMaterial.ts`: 공통 event metadata가 있는 production stellar result는 transient heat를 cumulative event age에서 파생한 settle age로 감쇠시킨다. 이전과 동일한 `0.16`초 선형 progress와 `^1.55` 감쇠 곡선을 유지하며 이 경로에서는 wall clock을 사용하지 않는다.
- `stellarRemnantPresentation.ts`: 공통 stellar event가 있는 production body는 기존 token 기반 별도 remnant transition을 시작하지 않고 token을 consumed 처리한다. 공통 metadata가 없는 예전 snapshot/fixture용 legacy 경로는 호환을 위해 유지한다.
- `liveCollisionVfxBridge.ts`: `findCollisionVisualTransitions`/remnant product lifecycle은 실제 stellar body를 제외하는 기존 non-stellar/legacy 경로이므로 이번 단계에서 wall-clock 구조를 일괄 변경하지 않았다. stellar envelope의 production update는 이미 authoritative `simulationTime`을 받는다.
- gas trail의 sampling/geometry/분포 및 effect-body age 체계는 이번 단계에서 변경하지 않았다. 이후 VFX를 event timeline에 더 연결해야 한다면 별도 단계에서 다룬다.

### 검증 상태

이번 단계에서도 테스트, 의존성 설치, 빌드, 타입 검사, lint, 회귀 검사, 브라우저 실행, 스크린샷·영상 캡처, CI 실행·재시도를 수행하지 않았다. 공통 timeline 연결이 실제 화면에서 의도대로 보이는지는 아직 확인하지 않았다.

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
- contact 경계 전후 진행률이 되감기거나 0으로 초기화되지 않는지 확인
- 동일 이벤트를 두 survivor가 공유해도 event age가 두 배로 흐르지 않는지 확인
- 동일 `simulationTime`의 반복 렌더에서 timeline/형상/열 감쇠가 변하지 않는지 확인
- 일시정지·재개·배속 변경 시 형상·열 감쇠·event lifetime이 simulation time과 일관적인지 확인
- contact overshoot가 누락되거나 두 번 반영되지 않는지, 큰 dt에서 complete 정리가 되는지 확인
- 동일 항성 쌍의 재충돌 및 다른 쌍의 연속 충돌이 서로 다른 event ID로 구분되는지 확인
- 리셋 뒤 이전 event/envelope/heat transition이 다시 재생되지 않는지 확인
- predicted outcome과 실제 solver outcome이 다를 때 실제 survivor/target만 표시되는지 확인
- 질량·반지름·위치·속도·운동량·충돌 결과가 이번 시간 정리로 바뀌지 않는지 확인

## 마지막 검증 단계에서 갱신할 기존 검사

이번 단계에서는 아래 테스트를 실행하거나 수정하지 않는다.

- `scripts/stellarRenderingRegression.ts`: `centerHighlightStrength` 0.48~0.58 및 별도 중앙 하이라이트 가산을 강제하는 검사를 새 요구에 맞게 갱신한다.
- `scripts/stellarPhotographicVisualRegression.py`: `core_luma >= 0.84` 등 기존 중심 밝기 기준을 새 요구와 함께 재검토한다.

최종 검증에서는 예전 별도 하이라이트 구현을 다시 강제하지 않는다. 온도색, 전체 발광감, 외곽 링 방지 검사는 유지하며, 결과에 맞추기 위해 임의로 임계값을 낮추지 않는다.

## 4단계 대상

공통 진행률을 사용해 접촉부 압축 → neck 성장 → 부피 이동 또는 분리 → 비대칭 잔해 → 안정화의 형상을 개선한다. 3단계에서는 이 작업을 시작하지 않는다.
