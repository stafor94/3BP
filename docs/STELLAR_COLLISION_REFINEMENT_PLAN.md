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

## 4단계 — 충돌 외피의 연속적인 형상 변화

상태: **4단계 구현 반영, 미검증**

변경 파일:
- `src/rendering/stellarCollisionEnvelope.ts`
- `docs/STELLAR_COLLISION_REFINEMENT_PLAN.md`

- merge는 공통 `contactProgress`·`transferProgress`·`settleProgress`로 접촉면 압축, neck 성장, donor lobe의 축방향 신장+부피 감소, receiver lobe의 부피 수용, 비대칭 remnant 감쇠를 하나의 단면 profile 안에서 연결한다. 별도 geometry 교체나 시간 위상 요동은 추가하지 않는다.
- 접촉축은 source 위치 차를 우선하고, 길이가 거의 0이면 source 상대속도, 마지막으로 `eventId` 기반 결정적 축을 사용한다. 접근 변형은 기존 1.18× reach 바깥 경계에서 0으로 시작하며 contact 전 neck은 만들지 않는다.
- 표시 부피 목표는 시작 시 두 source 구체의 `4/3πr³` 합, settle 종료 시 실제 result 구체의 `4/3πr³`다. 기존 36×24 비균일 x/angle 샘플에서 `0.5×Σ(r²Δangle)` 단면적과 실제 `dx` trapezoid 적분으로 표시 부피를 근사하고, 축 길이는 유지한 채 단면 반지름에 `sqrt(target/current)` 보정을 적용한다. 비유한/0 부피는 scale 1 fallback을 사용하며 샘플 배열은 envelope마다 재사용한다.
- hit-and-run/partial disruption은 각각의 실제 survivor envelope를 유지한다. contact 마지막 변형이 settle 시작에 0으로 사라지지 않도록 terminal deformation을 이어받아 `settleProgress`로 감쇠하고, partial disruption은 source→target 반지름 변화가 큰 survivor에 더 큰 변형을 준다. 분리 뒤 survivor 사이 neck은 만들지 않는다.
- settle 외피 중심은 과거 충돌 월드 좌표에 고정하지 않고 매 프레임 실제 result/survivor 위치를 기준으로 계산한다. handoff 순간의 local offset만 `settleProgress`/`releaseProgress`로 감쇠한다.
- source lobe의 온도색은 초기 contact에 유지하고 transfer/settle에 따라 혼합 범위를 넓힌다. result 색은 `getResolvedStellarPhotosphereColor()`를 사용해 일반 광구와 같은 transient-heat 상태를 소비한다. 중앙 백색 하이라이트는 복원하지 않는다.
- 보정된 동일 단면 반지름을 광구 정점과 2단계 `haloSectionRadius`에 같이 쓰므로 변형 외피와 corona profile이 함께 움직인다. 기존 render-object suppression/visibility 복구 경로는 유지한다.
- 이 구현은 고정 단면 격자의 presentation approximation이며 유체 시뮬레이션이 아니다. 극단적 질량비/시점에서 neck·tip·부피 보정이 자연스러운지는 최종 런타임 검증 대상으로 남긴다.
- 기존 contact/settle/release/transfer 시간, 물리 충돌 판정·solver 시점, 실제 질량·반지름·위치·속도, gas trail/ejecta, 카메라/UI는 변경하지 않았다.
- 3단계 종료 시 별도 미해결로 보고한 `buildContactPhysicalFrame()`의 metadata cleanup 범위는 4단계 형상 작업에서 수정하지 않았다.
- 이번 단계에서도 테스트, 의존성 설치, 빌드, 타입 검사, lint, 회귀 검사, 브라우저 실행, 스크린샷·영상 캡처, CI 실행·재시도를 수행하지 않았다.

## 5단계 — 가스 이력의 확산·감쇠와 밀도 표현 개선

상태: **5단계 구현 반영, 미검증**

변경 파일:
- `src/rendering/stellarGasTrail.ts`
- `src/rendering/collisionEffectRenderer.ts`
- `src/rendering/collisionEffectProfile.ts`
- `docs/STELLAR_COLLISION_REFINEMENT_PLAN.md`

### 실제 적용 경로

- `createCollisionEffectsLayer()`에서 `effectVisual.stellarCollision === true && effectVisual.kind === 'stellarPlasma'`인 경우에만 `createStellarGasTrail()`의 고정 리본 geometry와 전용 ShaderMaterial을 사용한다.
- 비항성 `stellarPlasma`, `contactFlash`, `compressionShear`, `stellarAfterglow`, `collisionSpark`는 기존 공용 effect material 경로를 유지한다. 전역 bloom/exposure, 항성 광구·corona, 4단계 envelope geometry는 변경하지 않았다.
- 가스 중심선은 각 render update에서 관측한 실제 `body.position`만 사용한다. 관측 구간 내부 보간도 두 관측 위치를 잇는 선형 chord로만 제한했으며 물리 궤적을 임의로 휘거나 과거 발사 경로를 역산하지 않는다.

### 샘플 추가·유지·제거와 버퍼 상한

- 각 샘플은 실제 관측 위치, simulation timestamp, 생성 이후 누적 이동 거리, 단조 증가 sample id를 보유한다.
- 첫 샘플은 renderer가 처음 관측한 현재 위치 한 점만 즉시 기록한다. renderer가 늦게 생성됐더라도 과거 꼬리를 추정해 붙이지 않는다.
- 같은 `simulationTime`의 반복 render에서는 새 샘플을 추가하지 않는다. 새 샘플은 최소 `0.006 s`의 simulation-time 간격과 `sourceMaxRadius × 0.018` 이상의 실제 이동을 모두 요구하며, 일반 목표 간격 `0.014 s` 또는 충분한 이동 거리도 함께 본다. 정지한 위치에는 동일 정점을 쌓지 않는다.
- 큰 dt/이동은 마지막 실제 관측점과 새 실제 관측점 사이만 선형 보간한다. 한 update에서 내부 보간은 최대 4점이고 최신 관측점까지 합쳐 최대 5개 segment sample만 추가한다.
- 시간 이력은 최근 `0.52 s`로 제한하며 `0.36 s`부터 오래된 끝을 연속 감쇠시킨 뒤 제거한다. 메모리/정점 예산은 기존과 동일한 최대 40 sample(80 ribbon vertices)이다.
- sample 수가 40을 넘으면 가장 오래된 점을 즉시 잘라내지 않고, 양 끝을 보존하면서 시간·거리상 가장 중복된 내부 sample부터 축약한다. 시간 수명 초과 제거가 기본 tail 회수 기준이고 capacity는 예산 안전장치다.
- simulation time 되감기, body age 되감기 또는 event key 변경 시 기존 이력을 폐기한다. effect body가 제거되거나 renderer reset/dispose가 실행되면 기존 visual 제거 경로에서 geometry/material과 함께 이력이 정리된다.

### 샘플별 확산·밀도 감쇠

- 각 샘플의 `localAge = currentSimulationTime - sample.simulatedAt`으로 폭, 밀도, 냉각 좌표, 앞/뒤 끝 감쇠를 계산한다. 분출체 전체 age 하나로 모든 sample 폭을 동시에 키우지 않는다.
- 횡방향 반폭은 `sourceMaxRadius` 기준 약 `0.085R`에서 시작해 local age에 따라 완만하게 퍼지고 최대 `0.46R`로 제한한다.
- 이 geometry는 2차원 면적 확장이 아니라 **리본의 한 횡방향 폭**을 넓히므로 surface-brightness 근사는 `initialWidth / currentWidth`의 1차 역비례를 적용한다. 이는 렌더링 밀도 근사이며 실제 유체 밀도 계산이 아니다.
- 최근 끝에는 약 `0.04 s`의 local head fade를 적용해 밝은 탄환 머리가 즉시 생기지 않게 하고, 오래된 끝은 제거 전에 먼저 희미해진다. parcel 전체 lifetime은 그대로 두되 마지막 22% 구간에서만 profile terminal fade를 연결해 물리 effect 삭제 직전 전체 리본도 충분히 소멸한다.
- 전용 가스 shader는 고정된 중앙 core/ridge를 사용하지 않는다. 폭 전체에 완만한 저주파 밀도 차와 불규칙한 가장자리만 주며, sample이 많아졌다는 이유로 별도 발광을 합산하지 않는다.

### UV·노이즈 좌표 안정화

- 노이즈 종방향 좌표는 `sample.distance / sourceMaxRadius`인 누적 실제 이동거리 기준이다. 오래된 sample이 제거되거나 내부 sample이 축약돼도 남은 sample 좌표를 0~1로 다시 정규화하지 않는다.
- `aTrailCoord`는 노이즈 좌표, `aTrailEndFade`는 앞/뒤 끝 감쇠, `aTrailAge01`은 local age/cooling, `aTrailDensity`는 폭에 따른 밀도 보정으로 분리해 vertex→fragment shader로 전달한다.
- 노이즈는 body id에서 파생한 고정 seed와 안정 거리 좌표만 사용한다. 매 frame 난수, time-phase 고주파 반짝임, 단일 sine 중심선 변형을 넣지 않는다.
- 색은 기존 stellar gas의 source/secondary 온도색 경로를 그대로 받아 local age가 높은 곳을 기존 cooling edge 쪽으로만 완만하게 이동시킨다. 전용 shader는 백색 `uCoreColor`를 출력 색에 사용하지 않는다.

### 시간 원점·일시정지·카메라

- production `createCollisionEffectsLayer.update(..., simulationTime)`의 stage-3 simulation clock을 가스 trail까지 전달한다. sample timestamp와 local age는 모두 같은 simulation-time 원점이다.
- effect body age가 event age와 다른 시작점을 가질 수 있으므로 최초 관측 때 `launchSimulationTime = simulationTime - bodyAge`를 명시적으로 기록하고 서로 다른 원점 값을 직접 빼지 않는다. 물리 lifetime/age 자체는 변경하지 않는다.
- 일시정지에서는 동일 `simulationTime`이 반복되므로 sample 생성·local age·폭·밀도·냉각·감쇠가 진행되지 않는다. 카메라만 회전하면 같은 sample 위치를 유지한 채 billboard side vector는 다시 계산된다.
- tangent와 view가 거의 평행하면 camera-right의 tangent 성분을 제거한 방향, 이후 고정 축 순으로 fallback한다. 인접 sample side가 이전 side와 반대면 부호를 뒤집어 ribbon flip을 줄인다.
- geometry/material은 parcel 생성 시 한 번 만들고 fixed buffer를 재사용한다. 각 sample마다 mesh/material을 만들지 않으며 `depthTest=true`, `depthWrite=false`를 유지한다.

### 남은 제한 사항·검증 상태

- 영상 `52869.mp4`에서 남는 여러 가스 띠의 **fan 방향 분포 자체**는 물리 분출 방향 문제이므로 6단계 인계 항목이다. 이번 단계는 `physics/engine.ts`, 실제 분출 속도·질량·위치·lifetime, 충돌 solver를 변경하지 않았다.
- renderer가 effect 생성 뒤 늦게 해당 parcel을 처음 보게 된 경우 그 이전 이력은 의도적으로 복원하지 않는다. 존재하는 실제 관측 이력만 사용한다.
- 이번 단계에서는 테스트 코드 작성·수정, 의존성 설치, 빌드, 타입 검사, lint, 회귀 검사, 브라우저 실행, 스크린샷·영상 캡처, CI 실행·재시도·결과 대기를 수행하지 않았다. 실제 영상에서 시각 개선이 달성됐다고 아직 판정하지 않는다.

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
- 접촉 전 불필요한 neck이 생기지 않는지 확인
- 두 둥근 원반이 겹친 채 작은 쪽만 사라지는 인상이 줄었는지 확인
- 물질 이동 중 갑작스러운 팽창·수축이 없는지 확인
- lobe 소멸 시 점·가시·별도 작은 구체가 남지 않는지 확인
- 결과 천체 이동과 외피가 분리되지 않는지 확인
- hit-and-run/partial-disruption survivor가 settle 시작에 순간적으로 원형으로 복귀하지 않는지 확인
- 최종 광구 복귀에서 위치·크기·색·corona가 튀지 않는지 확인
- 1배속과 충돌 관찰 배속, 일시정지·재개에서 형상 연속성이 유지되는지 확인
- 온도색과 1~3단계 변경이 유지되는지 확인
- 곧고 밝은 가스 중심선, 탄환 머리, 점선 구슬이 남지 않는지 확인
- 오래된 가스가 최근 가스보다 넓게 퍼지고 낮은 밀도로 흐려지는지 확인
- 오래된 sample 제거·capacity 축약 시 남은 무늬가 리본을 따라 미끄러지거나 꼬리가 갑자기 잘리지 않는지 확인
- 가스 중심 경로가 관측된 실제 물리 위치 이력과 일치하고 직선 물리 경로를 임의로 휘지 않는지 확인
- 프레임률·sample 수 차이로 trail 길이와 총 밝기가 크게 달라지지 않는지 확인
- 일시정지·재개·배속 변경·카메라 회전에서 sample age, 폭, 밀도, billboard 방향이 안정적인지 확인
- 항성 온도색과 광구 depth 가림이 유지되는지 확인
- 비항성 plasma/contact/shear/afterglow/spark 표현이 유지되는지 확인
- 모바일에서 최대 40 sample/80 vertex의 고정 ribbon, draw call 수, 넓어진 투명 영역 비용이 과도하지 않은지 확인

## 마지막 검증 단계에서 갱신할 기존 검사

이번 단계에서는 아래 테스트를 실행하거나 수정하지 않는다.

- `scripts/stellarRenderingRegression.ts`: `centerHighlightStrength` 0.48~0.58 및 별도 중앙 하이라이트 가산을 강제하는 검사를 새 요구에 맞게 갱신한다.
- `scripts/stellarPhotographicVisualRegression.py`: `core_luma >= 0.84` 등 기존 중심 밝기 기준을 새 요구와 함께 재검토한다.

최종 검증에서는 예전 별도 하이라이트 구현을 다시 강제하지 않는다. 온도색, 전체 발광감, 외곽 링 방지 검사는 유지하며, 결과에 맞추기 위해 임의로 임계값을 낮추지 않는다.

## 6단계 대상

항성 분출 방향의 fan 분포를 충돌 각도·질량비·결과별로 정리한다. 기존 질량·운동량 보정 계약을 유지하면서 규칙적인 빗살 배치를 완화한다. 5단계에서는 `physics/engine.ts`의 분출 방향 생성이나 실제 물리 속도·질량을 변경하지 않으며 6단계를 시작하지 않는다.
