# Changelog

3BP의 사용자에게 보이는 기능 변경, 물리/렌더링 동작 변경, 버그 수정, 성능 개선을 버전별로 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/)의 원칙을 참고하고, 버전 번호는 [Semantic Versioning](https://semver.org/) 및 `VERSIONING.md` 정책을 따릅니다.

> `v0.1.0`부터의 Git 커밋 기록과 `package.json` 버전 전환을 역추적해 복원한 변경 이력입니다. 임시/no-op 커밋과 배포 트리거처럼 사용자 동작에 영향을 주지 않는 내부 작업은 제외했습니다.

## [0.24.3] - 2026-09-02

### Changed
- 모바일 실기기에서 여전히 성기게 보이던 Pass 5 starfield를 background 4,500개에서 20,000개로 확장했습니다. dense/fine layer는 각각 10,000개이며 기존 foreground 1,000개를 포함한 전체 stellar population은 21,000개입니다.
- dense background를 size 1.72, opacity 0.92, brightness 0.40~0.69로 조정하고 fine background를 size 1.42, opacity 0.85, brightness 0.32~0.55로 조정해 고해상도 모바일 화면에서 작고 희미한 별이 texture filtering과 투명도에 묻히는 비율을 줄였습니다.
- background의 full-sky baseline 분포, shared 24×24 point texture와 기존 brightness sampling exponent 2.60은 유지합니다. 밝기 분포 자체를 전역 변경하지 않고 background minimum brightness를 올려 faint tail의 실제 화면 가독성을 확보했습니다.

### Performance
- v0.24.2 대비 background star는 +15,500개 증가하며 정적 position+color Float32 attribute raw buffer는 약 +363.3 KiB 증가합니다. 20,000 background 전체 attribute는 약 468.8 KiB입니다.
- dense/fine 각각 기존 단일 `THREE.Points` batch를 그대로 사용하므로 draw call 증가는 0입니다. star point texture는 기존 shared 24×24 DataTexture를 재사용해 texture 증가는 0이며, geometry는 초기화 후 static이고 per-frame buffer allocation을 추가하지 않습니다.

### Verification
- space background regression을 background 18,000~22,000 / foreground 정확히 1,000 / total 19,000~23,000 의도 범위와 Pass 6 dense/fine size·opacity·brightness 범위를 검증하도록 갱신했습니다. foreground maxBrightness 0.72/0.86/1.00과 shared brightness exponent 2.60도 그대로 검증합니다.
- v0.24.2 main (`9768b95d32040cb97f598f98f36ff6bc707280ee`)과 Pass 6를 동일 deterministic seed의 mobile 390×844 / desktop 1280×800, 5개 viewpoint에서 native A/B로 비교합니다.

### Unchanged
- sky base RGB 5/7/13, Milky Way/haze/distant galaxy luminance와 texture, foreground 500/300/200 hierarchy, physics/solver/collision, camera, planets, orbital trails, destruction VFX, UI와 controls는 변경하지 않습니다.

## [0.24.2] - 2026-09-02

### Fixed
- Pass 4/0.24.1에서 수치상 perceived-density가 개선됐지만 실제 모바일 화면에서는 작은 background star 다수가 사실상 사라지고 넓은 검은 패치가 남아 우주가 sparse하게 보이던 문제를 수정했습니다.

### Changed
- 기존 far/mid/near foreground 1,000-star hierarchy와 최대 밝기·parallax는 유지하고, background를 2,500개의 dense visible layer와 2,000개의 fine fill layer로 재구성했습니다. 총 stellar population은 5,500개입니다.
- dense layer는 size 1.58, opacity 0.86, brightness 0.32~0.67로 모바일 screen-space에서 작은 점으로 지속적으로 읽히도록 했고, fine layer는 size 1.26, opacity 0.76, brightness 0.23~0.50으로 주력 layer 사이의 빈 공간을 채웁니다. 두 layer 모두 기존 far foreground peak 0.72보다 낮게 유지됩니다.
- background star 분포를 cluster-first rejection에서 full-sky baseline 우선 방식으로 전환하고 낮은 강도의 Milky Way/지역 편차만 남겨 카메라 방향에 따라 큰 빈 영역이 반복되는 현상을 줄였습니다.
- sky base를 RGB 5/7/13으로 올리고 Milky Way band, broad haze, mid/fine-scale variation을 강화했으며 dust suppression을 낮춰 OLED black crush에서도 은은한 공간 구조가 보이도록 조정했습니다. sky/galaxy texture 해상도는 그대로 유지됩니다.

### Performance
- v0.24.1 대비 background star는 1,850개에서 4,500개로 +2,650개 증가하며 position+color raw buffer 증가는 약 62.1 KiB입니다. 기존 2개의 background `THREE.Points` draw call을 그대로 재사용하므로 draw call 증가는 0입니다.
- shared 24×24 star point texture, 512×256 sky texture, 64×64 galaxy texture를 그대로 사용하며 per-frame allocation, procedural noise, particle animation, bloom/volumetric/raymarching 비용을 추가하지 않습니다.

### Verification
- background regression을 Pass 5의 4,500~5,500 total-star budget, 두 background layer의 screen-space size/opacity/brightness 범위, full-sky baseline 분포, foreground brightness/depth hierarchy, sky floor/dust suppression, resource disposal을 검증하도록 갱신했습니다.
- visual A/B를 main v0.24.1 (`a2246fa302364bd0c69e33a6f732149251e08523`)과 Pass 5만 직접 비교하도록 변경하고 동일 deterministic seed·5개 viewpoint에서 mobile 390×844 / desktop 1280×800 contact sheet와 luminance metrics를 남깁니다.

### Unchanged
- physics/solver/collision, body mass/radius/velocity, tracking/collision camera, destruction/fragment/ejecta physics, stellar collision VFX, celestial-body shader, overlay/UI behavior는 변경하지 않습니다.

## [0.24.1] - 2026-09-02

### Fixed
- Pass 4에서 1,400개의 deep-field star와 fine grain/haze를 추가했음에도 모바일·OLED 화면에서 대부분이 near-black에 묻혀 실제 화면이 더 휑하게 보이던 문제를 수정했습니다.

### Changed
- 기존 1,000개 far/mid/near foreground star hierarchy와 최대 밝기는 그대로 유지하면서 deep-field를 1,600개, size 1.00, opacity 0.68, brightness 0.16~0.50으로 조정해 foreground보다 낮은 우선순위 안에서 실제로 읽히는 faint background layer로 변경했습니다.
- 250개의 mid-faint full-sky fill layer를 추가해 특정 cluster를 강조하지 않고 넓은 빈 영역 사이에 드문드문 읽히는 중간 밝기 별을 보강했습니다. 전체 stellar population은 2,850개입니다.
- 512×256 space texture의 near-black RGB floor를 소폭 높이고 Milky Way stellar grain에 중간/미세 스케일 변화를 함께 사용하며 broad haze 기여도를 상향해 8-bit 모바일 화면에서도 구조가 사라지지 않도록 조정했습니다.
- dark dust lane의 최대 suppression을 낮춰 기존 dust 구조와 branch는 유지하면서 화면의 넓은 영역이 과도하게 검게 눌리는 현상을 줄였습니다.

### Performance
- Pass 4 대비 star population 증가는 450개이며 추가 position/color raw buffer는 약 10.5 KiB입니다. mid-faint layer로 `THREE.Points` draw call 1개가 추가되지만 기존 shared 24×24 point texture를 재사용합니다.
- sky/galaxy texture 해상도, galaxy 수, per-frame animation 비용은 증가하지 않으며 procedural texture 계산은 기존처럼 초기화 시에만 수행합니다.

### Verification
- background regression이 deep-field와 mid-faint layer의 faint-but-visible 범위, foreground brightness/depth hierarchy 보존, 2,500~3,000 total star budget, OLED floor, dust suppression 및 두 background layer의 dispose를 검증하도록 갱신했습니다.
- 별도 visual CI가 Pass 3(0.23.0), Pass 4(0.24.0), 현재안을 동일 deterministic layout과 5개 시점에서 mobile 390×844 / desktop 1280×800으로 캡처하고 near-black·low/mid luminance 지표와 contact sheet를 artifact로 남기도록 추가했습니다.

### Unchanged
- physics/solver/collision, mass/radius/velocity/trajectory, collision/tracking camera, celestial body shader, collision/destruction VFX, ejecta/fragment/trail physics는 변경하지 않습니다.

## [0.24.0] - 2026-09-02

### Added
- 기존 1,000개 far/mid/near star hierarchy 앞에 1,400개의 더 작고 희미한 deep-field star layer를 추가해 전체 stellar population을 2,400개로 늘리고, 4개의 느슨한 local cluster 영역으로 방향별 밀도 차이를 보강했습니다.
- distant galaxy를 3개에서 8개로 확장하고 새 5개는 더 작은 크기와 0.08~0.14 opacity를 사용하며, seed가 spiral arm/flattening/core, edge-on thickness/dust, elliptical axis profile에도 영향을 주도록 변형 폭을 넓혔습니다.

### Changed
- 기존 512×256 sky texture 해상도는 유지하면서 Milky Way 내부에 fine stellar grain과 micro-cloud fluctuation을 추가하고, full-sky rich/void 비대칭을 강화해 넓은 검은 영역의 정보 밀도를 높였습니다.
- dark dust lane에 불연속적인 continuity, 폭 변화, 두 개의 희미한 branch를 추가하고 기존 sparse nebula 위에 저채도의 cyan/magenta/neutral broad haze를 겹쳐 띠·노이즈처럼 보이지 않는 중간 스케일 구조를 보강했습니다.
- 기존 Pass 3의 bright-star 최대 밝기, neutral temperature palette, 24×24 shared PSF texture와 far/mid/near parallax hierarchy는 그대로 유지해 시뮬레이션 천체보다 배경이 앞서 보이지 않도록 했습니다.

### Performance
- deep-field는 기존 shared point texture를 재사용하는 단일 `THREE.Points` draw call로 구성하며 추가 position/color buffer는 약 32.8 KiB입니다. galaxy raw RGBA data는 48 KiB에서 128 KiB로 증가하지만 모두 renderer 초기화 시에만 생성합니다.
- space texture와 galaxy texture 해상도는 각각 512×256 / 64×64로 유지하고, per-frame procedural noise·allocation·twinkle·raymarch·volumetric effect를 추가하지 않았습니다.

### Verification
- background regression이 기존 1,000-star foreground hierarchy 보존, 2,000~3,000 total star budget, faint deep-field constraints, local cluster 수, 6~10 galaxy/type/seed variation, Milky Way grain·branched dust·faint haze 존재, texture budget 및 deep-field dispose를 검증하도록 확장했습니다.

### Unchanged
- physics/solver/collision, mass/radius/velocity/trajectory, collision/tracking camera 로직, celestial body shader, collision/destruction VFX, ejecta/fragment/trail physics는 변경하지 않습니다.

## [0.23.0] - 2026-09-02

### Added
- 24×24 정적 RGBA DataTexture로 생성하는 compact PSF형 star point texture를 추가하고 기존 3개 `THREE.Points` star layer가 하나의 texture를 공유하도록 했습니다. 작은 밝은 중심과 빠르게 감쇠하는 원형 가장자리만 사용해 bloom/flare 없이 광점 형태를 부드럽게 만듭니다.
- 기존 far/mid/near star layer의 `follow` 튜닝을 각각 0.125% / 0.225% / 0.325%의 translation-only depth response로 해석하고, 매우 큰 카메라 이동에서도 각 레이어의 시각 변위가 0.24°를 넘지 않도록 제한했습니다.
- star count, shared texture 생성 횟수, parallax 상한, depth-write 및 sky/galaxy camera-centering 계약을 검증하는 background regression을 추가했습니다.

### Changed
- star brightness 분포 지수를 2.35에서 2.60으로 소폭 높여 기존 최대 밝기와 1,000개 star 수는 유지하면서 faint star가 다수를 이루고 bright star가 드물게 보이도록 hierarchy를 정리했습니다.
- star temperature palette를 neutral white 중심으로 더 저채도화해 blue-white/warm 차이가 가까이서만 읽히도록 조정했습니다.
- 기존 `follow`가 tracking target 이동량을 star layer 위치에 누적하던 경로는 `follow: 0`으로 중립화하고, `spaceBackground`가 실제 camera position과 초기 anchor 차이만으로 매 프레임 deterministic depth offset을 계산하도록 변경했습니다. target-only 변경은 더 이상 별을 움직이지 않습니다.
- sky sphere와 distant galaxy group은 기존처럼 매 프레임 camera position에 정확히 재중심화되어 Milky Way, dust lane, nebula 및 distant galaxy의 사실상 무한원 동작을 유지합니다.

### Performance
- 추가 texture raw RGBA data는 24×24×4 = 2,304 bytes(약 2.25 KiB)이며 renderer 초기화 시 한 번만 생성합니다. 기존 star layer 3 draw call은 그대로이고 추가 draw call은 없습니다.
- frame loop 추가 비용은 star layer 3개의 재사용 Vector3 기반 camera-offset 계산과 상한 검사뿐이며 per-frame allocation, procedural noise, twinkle, raymarch, volumetric effect는 추가하지 않습니다.

### Unchanged
- physics/solver/collision, mass/radius/velocity/trajectory, collision camera 자체의 transform 로직, celestial body shader, collision/destruction VFX, ejecta/fragment/trail physics는 변경하지 않습니다.

## [0.22.0] - 2026-09-02

### Added
- pass 1의 camera-centered 우주 배경 위에 64×64 정적 RGBA DataTexture와 Sprite를 사용하는 작은 distant galaxy 3개를 추가했습니다. 형태는 subtle spiral, edge-on, diffuse elliptical로 분리하고 서로 다른 celestial direction에 배치했습니다.
- 기본 시야 전방에는 형태를 찾을 수 있는 청백색 계열 spiral galaxy를 두고, 나머지 두 은하는 더 낮은 opacity로 주변 시야에 분산했습니다.

### Changed
- 기존 1,000개 star 수와 최대 밝기는 유지하면서 초기 생성 acceptance에 약한 broad cluster와 void를 추가해 균일한 noise처럼 보이는 분포를 완화했습니다.
- Milky Way band 내부의 장주기 density variation과 dust lane의 폭·warp·연속성 편차를 소폭 늘려 일정한 띠처럼 보이는 부분을 줄였습니다.
- distant galaxy는 warm collision foreground로 오인되지 않도록 저채도 blue/neutral 계열과 낮은 alpha를 사용하고, depth test를 유지해 천체와 collision VFX가 항상 앞에서 가리도록 했습니다.

### Performance
- galaxy texture 3개는 renderer 초기화 시에만 생성되며 총 raw RGBA data는 약 48 KiB입니다. Sprite/material/object는 각 3개, 예상 추가 draw call은 약 3개입니다.
- frame loop의 추가 작업은 galaxy group의 camera position copy뿐이며 per-frame allocation, procedural noise animation, raymarch, volumetric rendering은 추가하지 않습니다.

### Unchanged
- physics/solver/collision, mass/radius/velocity/trajectory, celestial body shader, collision/destruction VFX production 동작은 변경하지 않습니다.

## [0.21.0] - 2026-09-02

### Added
- 매우 희미한 은하수 띠와 dark dust lane, 낮은 채도·밝기의 국소 성운을 512×256 정적 equirectangular sky texture로 추가했습니다.
- 카메라 translation에는 사실상 무한원처럼 따라오고 rotation에는 고정된 우주 방향을 유지하는 camera-centered sky sphere를 추가했습니다.

### Changed
- 기존 1,000개 star field 수는 유지하면서 크기·밝기·색온도 편차와 galactic-plane/대규모 density variation을 적용했습니다.
- 대부분의 별을 더 작고 어둡게 조정하고 일부 밝은 별만 남겨 천체와 collision VFX보다 낮은 시각 우선순위를 유지하도록 했습니다.
- 기존 star field의 페이지 로드별 미세한 layout variation은 유지하되 각 레이어 내부 생성은 seed 기반으로 구성했습니다.

### Performance
- 은하수/성운 procedural 계산은 renderer 초기화 시 한 번만 수행하며, frame loop에는 sky sphere의 camera position 동기화와 1 draw call만 추가합니다.
- star count를 늘리지 않고 volumetric ray marching, animated background, per-frame noise sampling, mipmap 생성을 사용하지 않습니다.

### Unchanged
- physics/solver/collision, mass/radius/velocity/trajectory, celestial body shader, collision/destruction VFX 동작은 변경하지 않습니다.

## [0.20.9] - 2026-09-01

### Fixed
- 좁은 모바일 화면에서 좌측 실행 상태·배속·경과시간 배지와 화면 중앙 버전 배지가 같은 상단 행을 차지해 서로 겹치고 시간이 가려지던 문제를 수정했습니다.
- 620px 이하에서는 버전 표시를 기존 상단 컨트롤 행 바로 위의 컴팩트 라벨로 분리해 실행 상태/시간 및 우측 언어 컨트롤과 겹치지 않도록 했습니다.

### Added
- 500px, 390px, 320px 모바일 production viewport에서 상단 실행 배지·버전·언어 컨트롤의 실제 DOM 경계가 교차하지 않고 버전이 화면 안에 유지되는지 검증하는 브라우저 시각 회귀를 추가했습니다.

### Unchanged
- simulation physics, tracking/camera 동작, collision solver/penetration/ejecta/post-impact motion/survivor response/absorption/solid handoff/Stage 5 VFX/stellar collision은 변경하지 않습니다.

## [0.20.8] - 2026-08-31

### Fixed
- 비항성 2→1 충돌의 solid handoff에서 피흡수체가 균일한 작은 구체로 축소된 뒤 마지막 프레임에 삭제되던 표현을, 접촉축 변형이 먼저 진행되고 후반에 본체 collapse와 fade가 이어지는 순차 전환으로 변경했습니다.
- 접촉면 변형을 위한 추가 중심 위치 보정을 제거해 v0.20.7의 post-impact motion/solid-handoff 이동 경로를 그대로 유지합니다.

### Added
- absorbed solid의 contact-axis erosion → body collapse → final fade 순서와 단조 수렴을 검증하는 회귀 체크를 추가했습니다.

### Unchanged
- collision solver의 mass/velocity/trajectory/outcome, 기존 physical fragment/ejecta 방향·속도, stellar collision, camera, flash 및 Stage 5 VFX는 변경하지 않습니다.

## [0.20.7] - 2026-08-31

### Fixed
- 비항성 충돌의 staged contact/impact bridge에서 작은 충돌체의 충돌 전 접선 운동이 화면상 거의 사라져 `충돌 → 정지 → 갑작스러운 제거`처럼 보이던 현상을 수정했습니다.
- 기존 0.024초 impact bridge 동안 충돌 전 상대 접선 운동을 renderer-only offset으로 보존하고 점진적으로 감속해, 물리 결과와 기존 solid handoff로 넘어가기 전까지 진행 방향의 연속성이 유지되도록 했습니다.

### Added
- Janus/Luna 규모의 비대칭 충돌에서 post-impact rendered travel, 후반 비정지, 점진적 감속을 검증하는 collision penetration/motion regression을 추가했습니다.

### Unchanged
- collision solver의 velocity/mass/radius/outcome, 기존 penetration cap, impact bridge duration, physical removal/solid-handoff lifetime, Stage 3 ejecta, Stage 4/5 VFX, flash/particle/crater/camera는 변경하지 않습니다.

## [0.20.6] - 2026-08-31

### Fixed
- 비항성 충돌의 contact flash를 실제 contact geometry와 기존 충돌 heat/severity 메타데이터에 따라 더 작고 짧게 표시해, impact 직후 additive white-hot footprint가 source·macro fragment·survivor surface response를 과도하게 가리던 현상을 줄였습니다.
- head-on은 compact burst를 유지하고 grazing/oblique는 실제 tangent 방향의 짧은 scrape-like 비대칭만 허용하도록 flash stretch를 제한해 기존 세로 pillar/laser-like artifact가 재발하지 않도록 했습니다.
- mass-bearing `Collision spark`의 물리 궤적은 그대로 두고 renderer-only glow·footprint·tail·visible lifetime을 severity에 맞춰 낮춰 실제 macro fragment/ejecta가 secondary spark보다 먼저 읽히도록 정리했습니다.

### Added
- 동일 production physics state를 사용하는 Stage 4/Stage 5 collision VFX A/B regression과 대표 grazing, near-head-on, oblique, gentle merge의 T0~T+1.0s 고밀도 캡처 및 flash footprint/luminance 진단을 추가했습니다.
- A/B harness가 Stage 4/Stage 5에서 body position·velocity·mass·radius와 physical ejecta state가 동일한지 직접 비교할 수 있도록 test-only physics snapshot telemetry를 추가했습니다.

### Unchanged
- Stage 1 material continuity, Stage 2 penetration, Stage 3 ejecta velocity/direction/momentum, Stage 4 survivor response source, collision solver/classification, stellar collision VFX, camera, post-processing, particle/effect body count는 변경하지 않습니다.

## [0.20.5] - 2026-08-31

### Fixed
- 비대칭 비항성 충돌 뒤 surviving body가 실제 충돌 반동과 접촉 geometry에 맞는 국소 압축·전단 실루엣 반응을 짧게 표시하도록 해, 충돌 직후 완전한 구체로 즉시 복귀하던 인상을 줄였습니다.
- penetration/absorption staging으로 이미 축소된 impactor 반지름을 Stage 4 충돌 강도로 오인하지 않도록 pre-staging mass/radius를 보존하고, recoil 계산에는 마지막 pre-impact velocity를 사용하도록 했습니다.
- collision source cache가 staging 중 mass transfer를 intrinsic source mass로 덮어써 1:1 merge를 비대칭 충돌처럼 오분류할 수 있던 경로를 제거하고, 최종 collision result는 다음 충돌을 위한 새 baseline으로 재베이스합니다.

### Added
- Stage 3/Stage 4 production-renderer A/B regression을 추가해 representative grazing, head-on, oblique 조건에서 실제 recoil, full-size impactor scale, contact-local compression/shear, head-on↔grazing ordering 및 850ms settle을 검증합니다.

### Unchanged
- Stage 1–3 physics solver, 질량·선형 운동량, collision classification, ejecta 방향·속력, camera/flash/lighting/particle profile은 변경하지 않습니다.

## [0.20.4] - 2026-08-30

### Fixed
- 파괴성 비항성 oblique/grazing 충돌에서 extreme absorption 후처리 뒤 fresh physical ejecta가 결과 천체 내부나 표면에 붙어 시작하던 경로를 보정해, 실제 collision interface에서 결과 천체 표시 표면 바깥으로 생성되도록 했습니다.
- 큰 ejecta가 충돌체의 접선 진행 성분을 잃고 접촉점 주변에 정체되던 경우, 기존 solver가 할당한 COM-relative 속력 예산 안에서 outward contact normal과 impactor tangent를 조합해 충돌체 물질의 방향 계보가 이어지도록 했습니다.

### Changed
- 파편 크기 순으로 큰 ejecta는 impactor tangential motion을 더 강하게 유지하고 작은 debris는 기존 결정적 분산을 더 많이 유지하는 비대칭 fan/cone 분포를 적용합니다.
- 방향 회전으로 생기는 represented momentum 차이는 surviving solids 전체 질량에 분산 보정하며, 질량·속력 예산·seed 기반 deterministic behavior는 그대로 유지합니다.

### Added
- Stage 2 executable baseline과 representative grazing / near-head-on / oblique 정량 regression 및 동일 production renderer A/B capture를 추가해 spawn clearance, macro tangent alignment, outward motion, mass/momentum conservation, deterministic replay를 검증합니다.

### Unchanged
- Stage 1 material/macro-fragment continuity, Stage 2 penetration limiter, strongly head-on two-sided ejecta/flash 계약, gentle merge handoff, survivor recoil/spin 및 flash/lighting/VFX polish는 유지합니다.

## [0.20.3] - 2026-08-30

### Fixed
- 비항성 충돌의 접촉 후 absorption staging에서 축소 중인 충돌체가 상대 천체 중심 방향으로 과도하게 침강하던 상태를 제한해, 완전한 구체에 가까운 충돌체가 상대 천체 내부 깊숙이 삼켜지거나 관통하는 것처럼 보이던 penetration을 줄였습니다.
- post-solver solid handoff의 absorbed source가 remnant 중심까지 이동하지 않고 접촉면 근처의 제한된 inward travel 안에서 연속적으로 축소·소멸하도록 해, penetration 감소 과정에서 bounce나 순간적인 outward teleport 없이 기존 fragment/remnant 전환으로 이어지도록 했습니다.

### Added
- 1단계 상태를 동일 fixture의 baseline으로 직접 실행하는 low/current/high-speed normalized penetration regression과 Chromium A/B capture를 추가해 peak penetration, mass/momentum conservation, result continuity를 함께 검증합니다.

### Unchanged
- swept first-contact core solver와 collision classification, ejecta 방향·속도·확산, 질량·운동량 보존 계약, 1단계 macro-fragment continuity, survivor recoil/spin, flash/VFX profile 및 particle count는 유지합니다.

## [0.20.2] - 2026-08-30

### Fixed
- 작은 high-head-on 비항성 2→1 충돌에서 mass-bearing `Collision spark` ejecta가 effect 전용 렌더 경로에만 남아 원본 충돌체가 통째로 흡수된 것처럼 보이던 시각적 단절을 수정했습니다.
- persistent physical fragment가 없는 경우 실제 ejecta의 반지름·위치·속도를 그대로 상속한 최대 2개의 massless renderer-only irregular macro fragment를 표시해 source → debris → remnant 계보를 연결했습니다.

### Added
- macro fragment proxy가 물리 상태를 변경하거나 질량을 중복하지 않고 실제 ejecta pose를 상속하며, persistent fragment/hit-and-run 경로를 침범하지 않는 regression을 추가했습니다.

### Unchanged
- collision solver/classification, 질량·운동량, ejecta 물리 방향·속도·확산, penetration, recoil/rotation, flash/VFX profile, particle count는 변경하지 않았습니다.

## [0.20.1] - 2026-08-30

### Fixed
- 비항성 충돌의 실제 mass-bearing ejecta가 surviving solid 표면에 붙거나 뭉쳐 보이지 않도록 실제 생성 위치와 방출 방향을 collision geometry 기준으로 조정했습니다.
- ejecta momentum 변화량을 survivor/remnant의 실제 velocity에 보정해 represented linear momentum conservation을 유지했습니다.
- post-solver solid handoff timing을 첫 실제 renderer frame 기준으로 시작해 source → remnant/absorbed 전환의 첫 visible-frame jump를 줄였습니다.
- 작은 high-head-on 충돌에서 physical spark가 과도한 표시 크기로 뭉치거나 세로 기둥처럼 보이지 않도록 fragment-scale presentation을 적용했습니다.

### Changed
- non-stellar destruction browser regression을 synthetic fragment fixture 대신 실제 `fragmentAwareEngine.stepBodies()` 기반 production solver fixture로 전환했습니다.

### Added
- 동일 초기 상태에서 physical collision ejecta state의 deterministic replay와 minimum spawn clearance를 검증하는 regression을 추가했습니다.

## [0.20.0] - 2026-08-29

### Added
- 충돌 관찰 패널에 엔진이 실제로 확정한 충돌 결과를 표시합니다. 항성 충돌은 병합/충돌 후 이탈/부분 파쇄를 구분하고, 비항성 충돌은 파쇄/충돌 후 이탈 및 엔진 사후 상태에서 구분할 수 없는 병합·흡수를 하나의 `병합 / 흡수` 결과로 표시합니다. 결과 확정 전에는 판정 중 상태를 유지합니다.
- 충돌 전후 represented total mass와 x/y/z 선형 운동량 보존을 검증하는 conservation regression/diagnostic을 추가하고, mass-carrying fragment/effect ejecta와 production fragment-aware absorption 경로까지 검증합니다.

### Changed
- transient collision fragment는 실제 position/velocity/mass/momentum을 변경하지 않고 renderer-only clone에 collision normal 기반 양방향 outward burst, 결정론적 angular/size/distance variation을 적용해 충돌점에 붙어 보이는 현상을 완화했습니다. 기존 fragment lifetime/fade는 유지합니다.

### Fixed
- core physics에 swept solid-contact first-contact detection을 적용해 high-speed tunneling과 timestep 말단의 과도한 body penetration을 줄이고, 이미 접촉/overlap 상태인 pair도 안정적으로 resolve합니다.
- collision staging/transition이 timestep 중간에 끝날 때 남은 timestep을 보존해 충돌 전환 때문에 simulation time이 소실되지 않도록 수정했습니다.

### Verification
- swept first-contact physics가 적용된 상태에서 similar-mass, extreme mass ratio, stationary/opposing, low/high-speed collision의 represented mass 및 x/y/z momentum conservation을 검증합니다.
- collision result UI, presentation-only debris motion, swept contact/tangent/near-miss, large-step overshoot 및 기존 collision classification regression을 함께 실행합니다.

## [0.19.23] - 2026-08-29

### Fixed
- non-stellar absorption staging에서 작은 피흡수체가 침강·축소를 시작한 뒤에도 renderer 전용 contact bridge가 최초 접촉 위치를 다시 적용해 화면상 피흡수체가 고정되던 문제를 수정했습니다. 흡수 전환이 시작되면 contact bridge가 위치 소유권을 넘기고 같은 pair를 다시 획득하지 않도록 했습니다.
- headless WebGL 환경에서 정상적인 solid handoff 첫 프레임의 픽셀 실루엣 면적이 실행마다 흔들려 CI가 간헐적으로 실패하던 회귀 게이트 하한을 실제 관측 범위에 맞게 조정했습니다. absorbed silhouette 유지, 반지름·opacity·거리 수렴, centroid, blue component 및 frame-to-frame 연속성 검증은 그대로 유지합니다.

### Added
- absorption source의 radius가 축소되기 시작한 뒤 contact bridge가 해제되고 sink 위치가 계속 진행되는지 검증하는 collision presentation regression을 추가했습니다.

## [0.19.22] - 2026-08-29

### Fixed
- non-stellar collision의 solid handoff 대상을 merge/absorbed outcome이 아닌 실제 2→1 lineage topology로 판정해, production에서 `disrupted`로 분류되는 작은 moon 정면 충돌도 두 source silhouette에서 remnant로 연속 전환합니다.
- physics 위치와 분리된 renderer 전용 contact bridge를 추가해 최소 표시 반지름이 먼저 맞닿은 뒤 solver contact까지 접근하는 동안 깊은 화면상 관통을 제한하고, 그 마지막 presentation 위치를 post-solver handoff 시작점으로 전달합니다.
- 작은 high-head-on collision의 실제 mass-bearing tiny ejecta에는 source scale metadata를 전달하고 directional spark 표현을 compact contact burst에 넘겨 ±tangent 세로 spike를 제거했습니다. ejecta의 질량·속도·방향은 변경하지 않았습니다.

### Changed
- small head-on browser fixture를 직접 result/flash/fragment를 만드는 synthetic 장면에서 실제 `fragmentAwareEngine.stepBodies()`가 classify, staging, disrupt resolve, ejecta 생성을 수행하는 production 조건으로 교체했습니다.

### Added
- 실제 영상과 같은 `0.00199 + 0.001` moon, `0.0187 + 0.0175` physical radius, `0.4717` relative speed 조건에서 disrupt 2→1 topology, presentation contact envelope, source ghost의 physics 격리, spark ownership, mass/momentum 보존을 검증하는 regression을 추가했습니다.

## [0.19.21] - 2026-08-29

### Fixed
- 작은 non-stellar collision의 impact staging이 마지막 presentation contact보다 바깥쪽으로 되감기며 `겹침 → 다시 벌어짐 → 재접촉`으로 보이던 outward rewind를 제거했습니다.
- non-stellar 2→1 merge의 physical result는 즉시 확정하면서도 마지막 source solid geometry를 보존해 survivor는 실제 remnant 위치·크기로 연속 수렴하고 absorbed source는 remnant 안쪽으로 침강·축소되도록 solid silhouette handoff를 추가해 한 프레임 topology 교체를 제거했습니다.
- 작은 high-head-on non-stellar collision에서 contact flash가 밝은 세로 spike/기둥처럼 보이고 synthetic disruption chunk가 큰 검정·갈색 debris column을 만들던 presentation artifact를 제거했습니다.

### Added
- 실제 `fragmentAwareEngine.stepBodies()` → physical 2→1 result → production renderer 경로를 사용하는 browser regression을 추가해 source 유지, remnant pop-in 방지, screen-space centroid/면적 연속성, absorbed source의 monotonic sink/collapse, handoff 종료 후 ghost 제거를 검증합니다.
- 기존 small head-on artifact browser regression과 physics regression에 A의 no-rewind staging 및 C의 flash/chunk suppression을 함께 유지하는 통합 검증을 포함했습니다.

### Unchanged
- physical collision resolution과 merge/absorb/disrupt 판정, mass, physical radius, velocity, momentum, collision threshold, fragment/ejecta 물리, stellar collision 전용 동작, tracking 50% eligibility 규칙은 변경하지 않았습니다.

## [0.19.20] - 2026-08-28

### Fixed
- 작은 non-stellar collision의 실제 `fragment` debris가 일반 천체용 `MIN_BODY_RENDER_RADIUS = 0.025`를 적용받아 물리 반지름보다 큰 검은/갈색 구체 기둥처럼 보이던 문제를 수정했습니다.
- 매우 높은 head-on geometry의 mass-bearing `Collision spark`가 실제 ±tangent ejecta 방향을 따라 두 개의 밝은 directional spike로 남던 문제를 presentation 계층에서 제거했습니다.

### Changed
- 일반 moon/planet의 `0.025` 최소 표시 반지름은 유지하고, `bodyType === 'fragment'`에만 `0.006` fragment 전용 visibility floor를 적용해 persistent fragment는 실제 physical radius에 비례하는 작은 크기로 렌더링하도록 분리했습니다.
- high-headOn collision spark는 기존 `headOn` metadata로 directional presentation을 연속적으로 억제하고 매우 정면에서는 stretch/width를 isotropic으로 수렴시킨 뒤 tail과 visible alpha를 0으로 만들어 contactFlash가 impact 순간을 담당하도록 했습니다. grazing spark는 기존 directional envelope를 유지합니다.

### Added
- 실제 high-energy small moon-moon collision의 persistent fragment를 사용해 physical radius 불변/fragment presentation radius/normal moon·planet floor를 검증하고, head-on spark physical direction·velocity·lifetime 불변과 directional suppression, grazing/stellar control을 함께 검증하는 non-stellar collision VFX regression을 보강했습니다.

### Unchanged
- collision classification/threshold/contact distance, absorb/merge/disrupt/hitRun 판정, mass/ejecta fraction/momentum, physical fragment/remnant radius, ejecta velocity/direction/spawn/trajectory, `getEjectaDirection()`, fragment physical lifetime, PR #88 ownership/lineage, PR #89 rendered contact staging, tracking/camera, 일반 `MIN_BODY_RENDER_RADIUS`, stellar collision VFX는 변경하지 않았습니다.

## [0.19.19] - 2026-08-28

### Fixed
- 작은 non-stellar collision의 `contactFlash`가 effect BodyState의 `0.055` radius floor와 profile의 `0.038` visual-radius floor에 연속으로 지배되어, 최소 표시 반지름이 적용된 source silhouette보다 절대 크기가 과장되던 문제를 수정했습니다.
- head-on non-stellar collision의 mass-bearing `Collision spark`가 실제 ±tangent ejecta 운동 위에 긴 directional tail·stretch·additive glow를 겹쳐 두 갈래 직선 spike/기둥처럼 보이던 문제를 완화했습니다.

### Changed
- physics는 non-stellar flash에 가장 큰 source physical radius와 spark에 head-on/grazing geometry를 presentation metadata로만 전달하고, renderer가 `getBodyPresentationRadius()`를 사용해 source-relative flash footprint와 head-on compact splash shape/visible decay를 계산하도록 분리했습니다.
- head-on spark의 mesh stretch·tail reach·glow·visible opacity decay를 줄이고 width를 넓혔으며, grazing spark의 기존 directional envelope는 유지했습니다.

### Added
- 실제 `fragmentAwareEngine.stepBodies()`의 small moon-moon merge와 small+normal, normal+normal, stellar control을 사용해 body-relative flash footprint, mass-bearing spark의 physical direction/lifetime 불변, geometry-aware visual decay를 검증하는 non-stellar collision VFX regression을 추가했습니다.

### Unchanged
- collision classification/threshold/contact distance, absorb/merge/disrupt/hitRun 판정, mass/ejecta fraction/momentum, physical body/remnant radius, `getEjectaDirection()`과 ejecta spawn/velocity/trajectory, tracking/camera/trail/lifecycle/minRenderRadius, PR #88 ownership, PR #89 physical/display contact 분리 및 stellar collision VFX는 변경하지 않았습니다.

## [0.19.18] - 2026-08-28

### Fixed
- 작은 non-stellar 천체의 collision impact staging이 physical radius만 기준으로 접촉 위치를 잡아 renderer의 최소 표시 반지름보다 훨씬 깊게 겹쳐 보이던 문제를 수정했습니다.
- display-only impact contact는 renderer와 동일한 최소 표시 반지름 정책을 반영하되, 실제 solver handoff는 기존 physical `radiusA + radiusB`와 microscopic overlap을 그대로 사용하도록 분리했습니다.

### Added
- small+small, small+normal, normal+normal, solver isolation, moving collision에서 rendered contact 거리, center-of-mass 연속성, physical outcome 불변을 검증하는 collision presentation radius 회귀 체크를 추가했습니다.

### Unchanged
- collision classification/ownership, merge/disruption 판정, mass/physical radius/velocity/momentum, flash/ejecta VFX, camera, trail, stellar collision VFX 및 최소 표시 반지름 값은 변경하지 않았습니다.

## [0.19.17] - 2026-08-28

### Fixed
- non-stellar 2→1 merge/absorb가 physics에서 primary의 기존 ID를 보존하는 경우에도 `collisionLineageIds`를 기준으로 실제 surviving result를 찾아, 보존된 source를 `merged-survivor`, 사라진 source를 `absorbed`로 연결하도록 collision visual ownership 판정을 수정했습니다.
- preserved-ID merge에서 secondary lineage를 가진 mass-bearing ejecta가 존재해도 surviving result association을 먼저 적용해 secondary가 `disrupted`로 잘못 분류되고 disruption solid chunk handoff가 생성되던 문제를 제거했습니다.

### Added
- preserved-ID normal merge, mass-bearing ejecta 동반 merge, pure fragmentation, ordinary unchanged body, 기존 new-ID merge를 직접 검증하고 preserved merge에서 disruption chunk가 생성되지 않는지 확인하는 collision visual ownership regression을 추가했습니다.

### Unchanged
- collision physics/판정식/질량/반지름/속도, `getCollisionContactDistance`, `minRenderRadius`, camera/trail, stellar collision VFX, contact flash, ejecta 방향, remnant deformation 및 collision lifecycle timing은 변경하지 않았습니다.

## [0.19.16] - 2026-08-28

### Fixed
- non-stellar collision의 실제 `contactFlash` shader footprint와 최종 plane transform을 함께 제한해, 충돌 방향이 세로일 때 밝은 막대/기둥 실루엣이 화면을 지배하던 문제를 수정했습니다. stellar collision의 기존 과장 경로는 유지합니다.
- disruption result가 생성된 뒤 첫 520ms 동안 완전히 투명하던 ownership gap을 제거했습니다. 새 full-body ghost를 만들지 않고 기존 solid chunk handoff와 실제 result body를 짧게 겹쳐 source → remnant 질량감이 끊기지 않도록 했습니다.
- remnant deformation의 contact-axis 압축을 equivalent-volume 보존 방식으로 보정하고, 의미 있게 보이기 전 초기 morph를 마치도록 해 작은 찌그러진 core → 큰 구형 remnant 재성장 인상을 제거했습니다.

### Added
- actual disruption fixture에 production non-stellar contact flash를 재현하는 vertical stress case와 8단계 연속 캡처를 추가했습니다.
- source 마지막 반경 → remnant 첫 visible 반경, 16ms adjacent-frame 반경 변화, 최종 impact silhouette aspect ratio, visible 이후 stable까지 성장률을 실제 draw telemetry와 브라우저 캡처 기준으로 검증하는 regression을 추가했습니다.

### Unchanged
- collision lifecycle/physics, contact-local solid chunks, detached chunks/fine debris, source→result ownership 구조, deterministic/anisotropic deformation 개념, REMNANT_SETTLE→STABLE lifecycle, camera/trail handoff, stellar collision 전용 VFX는 변경하지 않았습니다.

## [0.19.15] - 2026-08-28

### Fixed
- 비항성 collision의 contact/compression sheet 종횡비를 제한해 충돌 직후 밝은 세로 기둥처럼 보이던 극단적인 스트레칭을 줄였습니다.
- disruption remnant가 최종 physical radius의 84~90% 범위에서 형성을 시작하고 FORMING 98%에서 REMNANT_SETTLE을 거쳐 100%로 수렴하도록 조정해, source가 사라진 뒤 본체가 극소 크기로 줄었다가 다시 팽창해 보이던 전환을 제거했습니다.

### Changed
- irregular remnant core, deterministic low-frequency deformation, contact-axis anisotropic compression 구조는 유지하되 초기 deformation/compression 강도를 낮춰 첫 visible remnant frame에서도 본체 질량감과 실루엣이 유지되도록 조정했습니다.

### Added
- source 마지막 반지름 대비 초기 remnant visual radius, contact/perpendicular axis 종횡비, phase boundary와 인접 frame 실루엣 변화, REMNANT_SETTLE 잔여 성장폭, non-stellar compression sheet 종횡비를 검증하는 회귀 체크를 추가했습니다.

### Unchanged
- contact-local solid chunk breakup, detached chunks/fine debris, source→result ownership handoff, irregular remnant core, deterministic deformation, anisotropic collision deformation 자체, REMNANT_SETTLE→STABLE lifecycle, collision physics/판정/질량/반지름/카메라/트레일은 변경하지 않았습니다.

## [0.19.14] - 2026-08-28

### Changed
- disruption 결과 remnant가 최종 형상의 작은 완성형 구체에서 uniform scale로 커지는 대신, 기존 physical remnant mesh 자체가 contact axis 기준 압축·비대칭과 deterministic low-frequency deformation을 가진 불규칙 core에서 형성되도록 변경했습니다.
- FORMING 후반에는 기존 solid chunks/fine debris와 remnant가 함께 보이는 ownership overlap을 유지하고, REMNANT_SETTLE에서 shape irregularity·anisotropic compression·국소 thermal unrest가 점진적으로 0으로 수렴하도록 했습니다.

### Added
- remnant formation의 초기 불규칙성, phase boundary 연속성, late-TRANSFER chunk overlap, settle 감쇠, stable physical-body exact match를 검증하는 전용 회귀 체크를 추가했습니다.

### Fixed
- disruption remnant가 약 20% 크기의 작은 완성형 행성처럼 갑자기 나타난 뒤 풍선처럼 확대되어 보이던 전환을 제거하고, debris cluster가 응집·안정화되어 최종 천체가 형성되는 흐름으로 연결했습니다.
- remnant formation shader를 disruption result에만 명시적으로 활성화해 absorption/merged-survivor의 기존 contact-local impact presentation에 영향을 주지 않도록 격리했습니다.

### Unchanged
- source full-body ghost 제거, contact-local solid chunk breakup/fine debris/moving anchor, absorption/merged-survivor/stellar 경로, collision physics, merge/disruption 판정, mass/radius/velocity, physical fragment/ejecta, tracking, camera, trail 및 일반 UI는 변경하지 않았습니다.

## [0.19.13] - 2026-08-28

### Changed
- 실제 disruption source의 contact-facing cap에만 결정적으로 배치되는 중·대형 low-poly solid chunk 계층을 추가해 `solid contact cluster → detached chunks → fine debris` 순서가 보이도록 했습니다.
- solid chunk는 기존 `IMPACT → FRACTURE → TRANSFER → REMNANT_SETTLE` lifecycle과 result/physical-fragment anchor delta를 그대로 사용하며, FRACTURE에서 순차 분리·저속 회전한 뒤 TRANSFER/SETTLE에서 synthetic ownership을 빠르게 넘기도록 했습니다.

### Added
- disrupted source 전용 chunk가 `InstancedMesh`로 존재하는지, contact cap과 같은 hemisphere에서 시작하는지, FRACTURE→TRANSFER에서 separation이 증가하는지, moving result anchor를 따라가는지, absorption에는 생성되지 않고 lifecycle 종료 시 정리되는지 검증하는 회귀 체크를 추가했습니다.
- non-stellar destruction browser artifact를 IMPACT, early/mid FRACTURE, TRANSFER, REMNANT_SETTLE 시점으로 세분화해 solid breakup과 기존 source-sized ghost 방지 조건을 함께 검사하도록 했습니다.

### Unchanged
- collision physics, merge/disruption 판정, collision prediction, mass/ejecta 및 실제 physical fragment 결과, 50% initial-mass tracking rule, tracking lineage semantics, collision/tracking camera, trail 정책, stellar collision VFX, absorption/merge visual 의미 및 일반 UI는 변경하지 않았습니다.

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

## [0.19.11] - 2026-08-28

### Fixed
- disruption collision에서 제거된 원본 천체의 `collisionHandoffSnapshot` full-body mesh가 충돌 당시 world position에 고정된 채 실제 result/remnant와 독립적으로 2.6초 동안 남아, 충돌 지점에 원본 천체 복제본이 남아 있는 것처럼 보이던 문제를 수정했습니다.
- retained result가 있는 disruption은 collision 시점 source↔result 상대 위치를 보존하면서 result의 최신 world translation delta를 source snapshot과 handoff ejecta anchor에 동일하게 적용하도록 변경했습니다. product reveal 직전 live result mesh가 아직 resolve되지 않는 frame은 현재 result `BodyState` 위치를 사용하고 live mesh가 나타난 뒤에도 위치가 튀지 않도록 동일 anchor 계열을 유지합니다.
- `resultId === null`인 pure fragmentation은 실제 fragment descendants의 mass-weighted centroid motion을 handoff anchor로 사용해 surviving remnant가 없어도 원본 full sphere가 충돌 지점에 정지하지 않도록 수정했습니다.

### Added
- retained-result disruption의 result association, delayed live-mesh resolve 연속성, source/result 상대 offset 보존, gross translation 일치, pure-fragment centroid 추적, stationary ghost-body 방지, 2.6초 lifecycle 종료 후 snapshot scene removal을 world-space로 검증하는 collision handoff anchor regression을 추가했습니다.
- moving disruption production-browser fixture를 별도로 추가하고 impact, +260ms, +520ms, +700ms, +1050ms, +1500ms, +1880ms, +2200ms, +2600ms capture에서 source motion, 원래 collision-site full-disc 잔존, cross-fade foreground energy와 lifecycle completion을 검증하도록 했습니다.

### Changed
- 기존 non-stellar destruction visual regression의 `early_shift_px <= 38` 정적 위치 성공 조건을 제거했습니다. source-surface 이동량은 deformation mask registration 진단값으로만 사용하고, 실제 handoff 이동 정합성은 body-radius/world-space 기준의 전용 moving-anchor regression에서 검증합니다.

### Unchanged
- collision physics, merge/disruption 판정 threshold, collision prediction/watch, 50% initial-mass tracking rule, tracking lineage semantics, collision/tracking camera, trail 정책, stellar collision VFX, absorption/merge visual 의미 및 일반 UI는 변경하지 않았습니다.

## [0.19.10] - 2026-08-27

### Changed
- 일반 비항성 충돌의 시각 handoff를 1.5초에서 2.6초로 늘리고 `impact hold → fracture → breakup → result reveal` 단계 간격을 확장해 두 천체가 접촉한 뒤 구조가 무너지고 결과물이 드러나는 흐름을 더 천천히 읽을 수 있도록 했습니다.
- 흡수 충돌의 작은 천체는 0.7초 만에 접촉점에서 축소·페이드하지 않고 1.7초 동안 접촉면을 유지한 뒤 움직이는 remnant 중심으로 연속적으로 침강·축소되도록 변경했습니다.
- `merged-survivor`는 충돌 직후 완성된 최종 반지름으로 즉시 바뀌지 않고 지배적 source의 기존 실루엣에서 최종 물리 반지름까지 1.7초 동안 성장하도록 연결했습니다.
- 일반 solid-body collision watch의 impact/post-impact 관찰 및 복원 시간을 늘려 확장된 충돌 연출이 너무 일찍 정상 재생으로 복귀하지 않도록 했습니다.

### Fixed
- 흡수 충돌에서 피흡수체가 접촉면 근처에서 빠르게 작아지며 사라지고 생존 remnant가 같은 순간 최종 크기로 튀어, 실제로 질량이 넘어가기보다 한 천체가 교체되는 것처럼 보이던 전환을 자연스럽게 연결했습니다.

### Unchanged
- collision physics, merge/disruption 판정, collision prediction, 질량 보존/fragment 생성, 50% initial mass tracking rule, tracking lineage semantics, remnant 물리, trail 생성/수명 및 camera transform/tracking 로직은 변경하지 않았습니다.

## [0.19.9] - 2026-08-27

### Fixed
- `Collision flash`, shock/plasma, spark 같은 transient `effect` BodyState가 전용 collision VFX layer와 동시에 일반 천체 renderer의 `SphereGeometry` 및 inner/outer glow로도 렌더링되어 충돌 지점에 검정·주황색 구형 천체가 새로 생긴 것처럼 보이던 중복 렌더 경로를 제거했습니다.
- collision effect는 이제 일반 천체 mesh 경로에 들어가지 않고 전용 flash/shockwave/ejecta renderer에서만 표현되어, 중앙 불투명 구체 대신 충돌점에 붙은 섬광·팽창파·방향성 방출물이 그대로 읽히도록 수정했습니다.

### Added
- 모든 collision effect kind가 일반 천체 renderer에서 제외되면서 실제 remnant와 물리 fragment는 그대로 유지되고 원본 simulation state를 변경하지 않는지 검증하는 render-routing 회귀 체크를 추가했습니다.

### Unchanged
- collision physics, merge/disruption 조건, collision prediction, 50% initial mass tracking rule, tracking lineage semantics, remnant presentation, trail 정책, camera/tracking/collision camera 로직은 변경하지 않았습니다.

## [0.19.8] - 2026-08-27

### Fixed
- collision 정보 UI가 사라진 뒤 실제 camera hold가 끝나는 release frame에서, 3x로 계속 이동 중인 tracked remnant가 한 프레임에 크게 튀거나 화면 밖으로 이탈하던 문제를 수정했습니다.
- v0.19.7의 tracking transition이 마지막 collision transform을 고정 world-space 시작값으로 저장한 뒤 progress 0에서 그대로 다시 써, 새로 publish된 remnant는 이동했지만 camera/target은 이동하지 않던 원인을 제거했습니다. handoff는 이제 현재 resolved tracked-body position과 부드럽게 변하는 camera/target 상대 offset으로 구성되며, 마지막 offset은 동일 시점의 normal tracking 수식과 정확히 같습니다.

### Added
- 실제 App physics scheduler, collision prediction/watch, slowdown, impact/merge, wall-clock camera hold, speed restore, moving remnant, handoff, 이후 1초 normal tracking을 통과하는 production-path Chromium regression과 frame별 writer/transform/identity/OrbitControls/NDC telemetry를 추가했습니다.
- moving target의 정지/등속/가속, 1x/3x, 빠른 remnant를 검증하고 CI/Pages에서 mobile 3x 및 desktop 1x artifact를 생성하도록 회귀 범위를 확장했습니다.

### Unchanged
- collision physics, merge/disruption 조건, collision prediction, tracking source identity와 50% initial-mass rule, VFX, trail 생성·수명·보존 정책은 변경하지 않았습니다.

## [0.19.7] - 2026-08-27

### Fixed
- collision camera가 종료되고 일반 tracking camera가 제어권을 되찾는 첫 프레임에 collision camera가 실제로 렌더한 camera position/target/distance 대신 일반 tracking framing을 즉시 적용해 화면 transform과 zoom이 점프하던 문제를 수정했습니다.
- collision camera의 마지막 transform을 tracking transition의 시작값으로 보존하고 첫 release frame의 progress를 0으로 시작한 뒤 기존 18-frame settle 구간 안에서 정상 tracking composition으로 연속적으로 수렴하도록 변경했습니다. 기존 tracking identity, 50% initial-mass rule, 충돌 물리/VFX, trail lifetime 정책은 변경하지 않았습니다.

### Added
- camera writer, 최종 writer, desired target/position/distance, transition start/destination/progress, `controls.update()` overwrite 여부를 기록하는 renderer camera telemetry를 추가했습니다.
- 실제 physics equal-mass merge → collision camera → merged remnant 관찰 → release → tracking handoff 경로를 통과하면서 release 직전/첫 프레임의 P/T/D 연속성, NDC 중심 유지, zoom 수렴, writer 경로를 수치 검증하고 단계별 Chromium 캡처와 telemetry JSON을 artifact로 남기는 회귀 테스트를 강화했습니다.

## [0.19.6] - 2026-08-27

### Fixed
- 동일 질량 또는 일반 merge 충돌에서 두 원본 천체 모두 remnant의 명시적 tracking continuation으로 연결해, 기존 50% initial-mass rule을 통과하는 추적이 collision camera 종료 뒤에도 유지되도록 수정했습니다.
- collision camera가 merge 이후 이미 해제된 tracking 상태를 잠시 가리고 있다가 종료 순간 천체가 화면 밖으로 이동하던 실제 원인을 수정했습니다.
- merge로 원본 body id가 사라질 때 renderer가 해당 body의 과거 궤적까지 즉시 폐기하던 문제를 수정하고, 기존 trail duration이 끝날 때까지 충돌 전 궤적을 trail-only 상태로 유지하도록 했습니다.

### Added
- 실제 equal-mass planet merge를 통과시켜 양쪽 source tracking continuation과 50% mass gate를 검증하는 회귀 테스트를 추가했습니다.
- collision-camera handoff 브라우저 regression에 source body가 remnant로 교체된 뒤에도 충돌 전 source trail이 retained 상태로 남는 renderer telemetry 검증을 추가했습니다.

## [0.19.5] - 2026-08-27

### Fixed
- 충돌 관찰 카메라가 종료될 때 `trackedBodyId`가 동일해 일반 tracking의 selection change가 발생하지 않고, collision camera의 마지막 거리/방향이 남은 채 focus settle이 재시작되지 않던 문제를 수정했습니다.
- collision camera의 `focused → released` 전이를 별도 camera-mode handoff로 감지해 기존 tracking selection·baseline·50% mass rule을 건드리지 않고 같은 tracking focus 초기화 경로에서 view direction과 auto-distance settle을 다시 시작하도록 했습니다.
- collision camera 종료 프레임에 default composition을 거치거나 카메라를 순간이동하지 않고, 현재 카메라 위치에서 기존 tracking transition으로 유효 continuation을 계속 화면 중앙에 유지하도록 했습니다.

### Added
- 동일 tracked source의 collision-camera release, 50% mass 경계, release 직후 1 frame 및 +100/+300/+600ms의 viewport 중심·camera distance 수렴을 검증하는 tracking/camera handoff 회귀와 브라우저 renderer telemetry 검증을 추가했습니다.

## [0.19.4] - 2026-08-27

### Changed
- 극단적 질량비의 저에너지 비항성 흡수 충돌은 작은 피흡수체를 접촉 마지막 프레임까지 원래 크기로 유지하지 않고, 충돌 후반부에 흡수체 내부로 침강시키면서 반지름을 연속적으로 축소하도록 변경했습니다.
- 같은 흡수 충돌에서 소량의 방출 질량은 멀리 떨어진 고체 파편으로 즉시 생성하지 않고 실제 접촉 패치에서 시작하는 짧고 컴팩트한 충돌 입자로 표현하도록 변경했습니다.

### Fixed
- 작은 천체가 큰 천체와 충돌한 직후 한 프레임에서 갑자기 사라지는 현상을 수정했습니다.
- 저에너지 흡수 직후 파편이 천체 위아래의 떨어진 위치에 완성된 상태로 갑자기 나타나는 현상을 제거했습니다.
- 흡수 충돌에서 생성된 파편이 재충돌하며 뒤늦게 길쭉한 `Collision spark` 특수효과를 만들었다가 사라지는 현상을 제거하고, 해당 방출물을 0.55초 이내에 사라지는 접촉면 국소 효과로 제한했습니다.

## [0.19.3] - 2026-08-26

### Changed
- 비항성 충돌의 시각 outcome을 `survivor`, `absorbed`, `disrupted`, `merged-survivor`로 분리하고, ID lineage는 충돌 결과 연결에만 사용하며 파괴 판정 근거로 사용하지 않도록 변경했습니다.
- 실제 `disrupted` 천체의 1.5초 handoff는 실제 접촉 법선에서 균열이 시작해 주변으로 전파된 뒤 구조 붕괴와 파편 reveal로 이어지도록 변경했습니다.
- 흡수 충돌의 작은 피흡수체는 전체 구면 dissolve 대신 접촉면 쪽으로 압축·소멸되는 짧은 전환을 사용하도록 분리했습니다.

### Fixed
- 큰 천체가 작은 천체를 흡수해 대부분의 질량과 실루엣을 유지하는 경우에도 큰 천체 전체에 fracture/dissolve snapshot이 생성되던 문제를 수정했습니다.
- 생존 천체에는 destruction snapshot·전역 crack·global discard·opacity fade를 생성하지 않고, 실제 접촉점 주변 약 10% 구면 범위에만 700ms 이내의 국소 impact 흔적을 적용하도록 수정했습니다.
- 충돌 후 살아남은 큰 천체 위에 동일 크기의 검은 shell/ghost sphere가 겹치던 문제를 제거했습니다.
- survivor의 표면 정체성 seed와 렌더 body lookup seed를 분리해 흡수 후 비항성 천체가 self-luminous/glow 상태로 고착될 수 있던 경로를 제거했습니다.
- world-space contact normal을 body mesh local-space로 변환해 회전된 천체에서도 국소 충돌 흔적이 실제 접촉면에 고정되도록 수정했습니다.
- bodyLighting이 최종 셰이더를 교체한 뒤 survivor impact 코드를 주입하도록 순서를 고쳐 국소 heat/crack가 실제 렌더 셰이더에서 누락되던 문제를 수정했습니다.

### Added
- survivor absorption과 actual disruption을 분리 검증하는 브라우저 시각 회귀를 추가하고 contact/150/350/700/1100/1600ms 단계 캡처 및 survivor 반대 hemisphere 변화 검사를 추가했습니다.

## [0.19.2] - 2026-08-26

### Changed
- 일반 고체 천체의 파괴 handoff를 1.5초로 확장하고 `impact hold → fracture propagation → structural breakup → result reveal` 순서로 분리해 원본 표면이 먼저 유지된 뒤 균열·붕괴·결과물이 단계적으로 이어지도록 재구성했습니다.
- 비항성 잔존체·파편은 약 240ms의 기본 reveal 지연과 결정적 stagger를 거쳐 작은 초기 scale·0 opacity에서 ease-out 방식으로 최종 크기와 불투명도에 수렴하도록 변경했습니다.
- 충돌 관찰 카메라는 source→remnant 반지름 handoff 시 기존 거리를 기준으로 1.5초 동안 목표 거리를 제한적으로 보간하고, 프레임당 목표 거리 변화량을 최대 3%로 제한하도록 보강했습니다.

### Fixed
- 충돌 후 일반 추적이 작은 잔존체·파편 계보로 승계된 뒤 해당 반지름 기준으로 카메라가 재프레이밍되어 주변 큰 천체가 비정상적으로 확대되던 문제를 수정했습니다.
- 최초 선택 당시 질량의 50% 미만이면 descendant/fragment 승계를 적용하기 전에 일반 추적을 즉시 종료하고, 정확히 50%인 경계값은 계속 추적 가능하도록 수정했습니다.
- 일반 추적의 기준 ID와 최초 질량을 선택 당시 source에 고정해 bodyScale 변경이나 collision descendant가 추적 기준을 다시 설정하지 못하도록 했습니다.
- 파괴(disrupt) 결과에서는 가장 큰 fragment나 일반 collision lineage를 일반 사용자 추적으로 자동 승계하지 않으며, 충돌 관찰의 source-lineage tracking은 기존 별도 경로를 유지합니다.
- 질량 제한·재터치·대상 소멸·파괴로 일반 추적이 해제될 때 마지막 카메라 위치·시선 target·거리·yaw/pitch·사용자 zoom을 유지하고 기본 composition이나 다른 천체 기준 auto-fit으로 복귀하지 않도록 했습니다.
- 새 잔존체·파편이 첫 프레임부터 full-size/full-opacity로 보이거나 파편 입자가 원본 표면 밖에서 동시에 폭발하듯 시작하던 연출을 제거했습니다.

## [0.19.1] - 2026-08-26

### Changed
- 일반 고체 천체의 파괴 handoff를 약 820ms 동안 원본 표면이 온전히 보이는 상태에서 균열 경계가 진행되고 뒤이어 잔해가 방출되는 순서로 재조정했습니다.
- 충돌 직후 생성되는 비항성 잔존체·파편은 짧은 지연 뒤 크기와 불투명도가 점진적으로 나타나도록 교차 전환해 한 프레임에 완성된 파편이 튀어나오는 느낌을 줄였습니다.
- 왼쪽 추적 레일에서 현재 활성화된 천체를 다시 누르면 일반 추적을 해제하며, 카메라는 해제 직전의 마지막 위치와 시선 타깃을 그대로 유지합니다.

### Fixed
- v0.19.0에서 추적 레일이 매 프레임 현재 후보 질량으로 기준점을 다시 잡아 최초 질량의 50% 제한이 사실상 무력화되던 문제를 수정하고 기존 절반 질량 기준을 복원했습니다.
- 파괴 handoff 셰이더의 dissolve 임계값 방향이 반대로 적용되어 원본 천체 표면이 첫 프레임부터 대부분 잘려 보이던 문제를 수정했습니다.
- 충돌 결과 파편과 잔존체가 원본 천체 소멸과 동시에 완전한 크기·불투명도로 표시되어 파괴 전환이 갑자기 끊겨 보이던 문제를 수정했습니다.

## [0.19.0] - 2026-08-26

### Added
- 진행시간 배지 오른쪽에 현재 추적 중인 천체의 이름·종류·질량·부피·반지름을 실시간으로 표시하는 컴팩트 HUD를 추가했습니다.
- 일반 천체가 합체·흡수·파괴 결과로 교체될 때 기존 천체 표면이 약 620ms 동안 균열·용해되며 입자로 이어지는 실시간 collision handoff 렌더 레이어와 회귀 검증을 추가했습니다.

### Changed
- 일반 추적을 초기 질량 보존율이 아니라 사용자가 선택한 천체의 충돌 계보 기준으로 유지하며, 원본이 사라지면 물리 잔존체를 우선하고 잔존체가 없으면 가장 큰 생존 파편으로 결정적으로 이어가도록 변경했습니다.
- 모바일 추적 HUD는 좁은 화면에서도 이름·종류·질량·부피를 우선 유지하고 공간이 부족할 때 반지름부터 축약하도록 구성했습니다.

### Fixed
- 추적 대상의 질량이 최초 선택 시점 대비 50% 이하로 감소하면 App과 추적 레일의 중복 제한 때문에 충돌 도중 추적이 임의로 해제되던 문제를 수정했습니다.
- 합체·파괴 해석 프레임에서 원본 천체 메시가 즉시 사라지고 잔존체·파편으로 한 프레임 만에 교체돼 장면이 갑자기 끊기거나 박살나는 것처럼 보이던 전환을 완화했습니다.

## [0.18.12] - 2026-08-26

### Changed
- 행성·위성 등 일반 고체 천체의 실제 접촉 연출을 0.03× 관찰 기준 약 0.8초 동안 유지해, 접촉 직후 한 프레임 만에 잔존체·파편으로 전환되는 현상을 완화했습니다.
- 일반 충돌 관찰의 impact/post-impact 구간을 각각 0.85초/1.8초로 늘리고, 이전 사용자 배속으로 돌아가는 복원 램프를 0.9초로 완만하게 조정했습니다.
- 일반 충돌 카메라와 충돌 정보 패널을 충돌 후 각각 약 3.8초/3.5초 동안 유지해 결과 천체와 파편 운동을 충분히 관찰할 수 있도록 했습니다.

### Fixed
- 충돌 관찰 replay가 정확히 접촉면에서 재개되면 비항성 충돌이 staged contact 경로를 건너뛰고 즉시 물리 결과로 해석되던 오류를 수정했습니다.
- 큰 흡수체가 연속 흡수로 여러 번 새 잔존체 ID를 받는 동안 원래 허용된 tracking continuation 계보가 유지돼도 이전 잔존체 ID를 찾지 못해 일반 추적이 풀리던 문제를 수정했습니다.
- BodyTrackingRail의 layout 검사가 App의 다음 추적 후보 갱신보다 먼저 실행돼 정상적인 잔존체 ID handoff를 추적 소실로 오판하던 레이스를 수정했습니다.
- 초기 질량의 50% 이하일 때 추적을 종료하는 기존 제한은 그대로 유지합니다.

## [0.18.11] - 2026-08-26

### Added
- `package.json`의 현재 버전과 `CHANGELOG.md` 최상단 릴리스 버전이 다르면 빌드와 PR CI가 실패하도록 버전 정합성 회귀 검사를 추가했습니다.

### Changed
- 질량비가 2% 미만이고 상대속도가 상호 탈출속도의 1.05배 이하인 행성-위성 접촉은 극단적 질량차의 저에너지 흡수로 보정하고, 방출 질량을 전체 계 질량이 아니라 작은 충돌체 질량의 12~35% 범위로 제한했습니다.
- 비항성 충돌의 접촉 섬광과 스파크를 더 작고 두껍고 짧게 조정해 충돌 지점을 가로지르는 긴 흰색 빔 대신 국소적인 충격·파편 연출로 보이도록 개선했습니다.
- 상단 충돌 정보 패널을 기존 위치에서 5px 아래로 이동해 상단 상태 UI와의 간격을 확보했습니다.

### Fixed
- Janus 0.3500 / Luna 0.0019 수준의 극단적 질량차 충돌에서 작은 충돌체보다 훨씬 많은 질량이 주 천체에서 사라질 수 있던 전체 질량 기반 방출량 오류를 수정했습니다.
- 저에너지 흡수에서 엄격히 질량이 더 큰 흡수체의 추적 승계 정보를 잔존체에 전달해 ID가 바뀌어도 기존 50% 추적 제한을 변경하지 않은 채 정상 추적을 이어가도록 했습니다.
- 현재 항성 렌더링이 거의 백색인 경우에도 충돌 관찰 카메라 시각 회귀가 주 천체를 색상에 의존하지 않고 밝은 photosphere 기준으로 검출하도록 수정했습니다.

## [0.18.10] - 2026-08-26

### Changed
- 충돌 관찰 카메라를 일반 추적과 분리해 주 천체 반지름이 화면 너비의 약 1/9을 차지하도록 프레이밍하고, 반지름 변화 뒤에도 목표 거리의 1% 오차 이내까지 계속 수렴하도록 했습니다.
- 항성 방출물의 생성 위치를 공통 접촉점이 아니라 결정적인 source-body 접촉 패치로 분산하고, 정면/스침 충돌의 방향성과 큰·작은 플라즈마 운동 차이를 강화했습니다.

### Fixed
- 엄격히 질량이 더 큰 흡수체를 추적 중일 때 흡수로 원본 ID가 잔존체 ID로 바뀌어도 물리 엔진이 명시한 `trackingContinuationIds`에 한해서 일반 추적을 잔존체로 이어가도록 복구했습니다.
- 작은 피흡수체, 일반 merge/disrupt 결과, 파편·이펙트·무관 천체에는 일반 추적이 승계되지 않도록 기존 제한을 유지했습니다.

## [0.18.9] - 2026-08-26

### Changed
- 항성의 물리 광도를 화면 밝기에 로그 압축해 적용하고 photosphere·inner glow·outer halo를 분리해, 고광도 항성도 고유 색을 유지하면서 밝기 차이가 읽히도록 렌더링을 조정했습니다.
- 항성 충돌 VFX를 긴 lens-flare/spike 중심 표현에서 충돌 기하·속도·질량비·outcome을 반영하는 비대칭 plasma ejecta와 팽창 shock shell 중심 표현으로 재설계했습니다.
- 충돌 후 합체·부분 파괴·hit-and-run 잔여 항성이 즉시 완전한 구형으로 보이지 않고 충돌 방향의 비대칭 변형에서 일정 시간 자연스럽게 안정화되도록 remnant relaxation을 추가했습니다.

### Fixed
- 항성 본체와 2중 additive corona가 과도하게 합성되어 서로 다른 표면온도·진화 단계의 항성이 대부분 흰색으로 뭉개지던 문제를 수정했습니다.
- 충돌 topology 전환 직후 완전히 안정된 새 항성이 갑자기 나타나는 것처럼 보이던 현상을 완화하고, 기존 충돌 VFX와 remnant 전환의 생명주기를 자연스럽게 연결했습니다.

## [0.18.8] - 2026-08-26

### Changed
- 궤적 유지 시간을 1~20초로 제한하고 신규 기본값을 10초로 변경했습니다.
- 전체 천체의 질량·반지름 배율을 0.25×, 0.5×, 0.75×, 0.9×, 1×, 1.1×, 1.25×, 1.5×, 2×, 3×, 5×의 고정 선택값으로 제한했습니다.
- 2D/3D 공간 모드, 천체 수, 초기 조건 프리셋, 궤적 표시 여부와 유지 시간을 로컬 스토리지에 저장하고 새로고침 시 마지막 설정을 복원하도록 했습니다.
- 손상되거나 서로 모순되는 저장값은 현재 유효한 초기 조건으로 자동 정규화하도록 했습니다.

### Fixed
- v0.18.7 상태로 배포된 초기 조건 설정 변경의 버전 증가와 변경 이력 기록이 누락된 문제를 바로잡았습니다.

## [0.18.7] - 2026-08-26

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

## [0.18.1] - 2026-08-26

### Changed
- 항성 hit-and-run은 충돌 궤적의 impact parameter와 실제 침투/압축 깊이를 함께 사용해 판정하며, 상호 탈출속도보다 느린 접촉이나 깊게 겹친 충돌은 더 이상 탄성충돌처럼 분리시키지 않습니다.
- 실제 hit-and-run에서도 접선 상대속도의 일부를 전단/충격 에너지로 소산해 두 항성이 당구공처럼 원래 진행방향을 거의 그대로 유지하지 않도록 했습니다.
- white-hot 충격 온도는 접촉면·플라즈마 VFX에 집중시키고 항성 본체 전체에는 제한된 비율만 반영해, 적색/주황색 항성이 grazing 충돌 직후 통째로 백색으로 변하는 현상을 제거했습니다.

### Fixed
- 깊게 겹친 항성 충돌이 `grazing > 0.82` 조건만으로 hit-and-run 판정을 받아 다음 프레임에 두 본체가 강제로 떨어지는 오류를 수정했습니다.
- sub-escape grazing 접촉과 deep-overlap 접촉이 hit-and-run으로 빠지지 않는지 검증하는 회귀 테스트를 추가했습니다.

## [0.18.0] - 2026-08-26

### Added
- 항성↔항성 충돌 결과를 `merge`, `hitAndRun`, `partialDisruption`으로 분리하고, 비합체 충돌에서도 질량 이동·질량 손실·반지름 갱신·충격 가열 상태가 남도록 했습니다.
- 항성 질량에서 광도·주계열 반지름·유효온도를 근사하고 온도를 연속 RGB로 변환해, 충돌 후 질량이 바뀐 항성의 평형색이 함께 갱신되도록 했습니다.
- grazing hit-and-run, 정면 merge, partial disruption, display-only overlap 색 보존을 검증하는 항성 충돌 회귀 체크를 추가했습니다.

### Changed
- 항성 합체는 가장 강한 섬광·충격면·afterglow, hit-and-run은 양 survivor 방향의 긴 플라즈마 stream, partial disruption은 작은 별 쪽으로 편향된 stripping VFX를 사용하도록 outcome별 profile을 분리했습니다.
- 충돌 직후 항성 본체/광원/글로우/궤적은 평형색 위에 실시간으로 감쇠하는 shock-temperature bias를 적용하며, 궤적도 짧은 구간만 약하게 밝아지도록 했습니다.

### Fixed
- display-only 충돌 overlap이 `body.color`를 직접 백색 혼합해 항성 본체가 노랗거나 탈색된 것처럼 보이던 경로를 제거했습니다.
- synthetic overlap contact sheet의 중심 additive 기여도와 opacity/brightness를 제한해 항성 원판 전체의 base hue를 덮지 않도록 했습니다.
- 항성 partial disruption이 내부 `disrupt` 판정 후에도 단일 merge 잔여체로 처리되던 topology 오류를 수정했습니다.

## [0.17.24] - 2026-08-26

### Added
- 충돌 관찰 속도를 `approach → impact → postImpact → restoring` 실시간 phase 상태 머신으로 분리하고, 충돌 종류별 hold/ramp 값을 순수 계산 모듈과 회귀 체크로 분리했습니다.
- 항성↔항성 실제 충돌에 강한 white-hot 비등방 섬광, 난류 압축 충격면, 방향성 플라즈마 강화, 속이 비고 가장자리가 끊기는 팽창 afterglow/halo를 추가했습니다.

### Changed
- 충돌 후 3초 동안 0.03x를 고정하던 정책을 제거하고, 항성 충돌은 약 0.85초 impact 0.03x → 약 1.65초 post-impact 0.08x → 약 0.7초 smooth restore로 변경했습니다. 소형체와 비항성 충돌은 더 짧은 프로파일을 사용합니다.
- 카메라 유지 시간, 충돌 정보 UI 수명, 속도 제어 수명을 서로 독립시켰으며 restoring 도중 새 충돌이 감지되면 새 collision phase가 우선하도록 했습니다. 사용자가 관찰 중 속도를 직접 바꾸면 이후 자동 속도 복원보다 사용자 입력을 우선합니다.
- 항성 합체의 display-only 중첩 구간을 짧게 줄여 0.03x에서 수 초간 topology 해석을 지연시키던 흐름을 제거했습니다.
- physical collision VFX의 시각 age를 real-time으로 계산해 저속 관찰 중 flash/plasma 수명이 과도하게 늘어나지 않도록 했습니다.
- synthetic stellar overlap retire 260ms와 physical shear/plasma fade-in 140ms의 cross-fade를 유지하며 contact flash는 즉시 표시합니다.
- 대형 항성 VFX는 opacity/brightness와 world-space 최대 직경을 clamp하고, 기존 동적 천체 상한 28개 안에서 flash/shock/afterglow 슬롯을 먼저 예약하도록 제한했습니다.
- collision camera framing은 기존 physical body/remnant 기준을 유지하며 VFX radius는 auto framing에 포함하지 않습니다.

### Fixed
- 충돌 정보 UI 종료가 곧바로 극저속 해제와 카메라 종료까지 발생하던 결합을 제거했습니다.
- 연속 충돌에서 이전 restore ramp가 다음 충돌의 0.03x/0.08x phase를 덮어쓸 수 있는 경로를 차단했습니다.
- v0.17.23의 일반 tracking/충돌 camera continuity 규칙은 그대로 유지해 merge frame 줌 점프와 합체 후손 자동 일반 추적이 재발하지 않도록 했습니다.

## [0.17.23] - 2026-08-26

### Changed
- 일반 천체 추적과 충돌 관찰 카메라의 수명주기를 분리해 충돌 관찰이 일반 추적 ID를 강제로 선택하거나 승계하지 않도록 변경했습니다.
- 충돌 직후 관찰 유지 시간을 3초로 늘리고 해당 구간을 0.03x로 유지한 뒤 기존 사용자 속도를 복원하도록 변경했습니다.
- 충돌 카메라의 일반 반지름 재프레이밍 보간을 완만하게 조정했습니다.
- 충돌 직전 합성 플라즈마 프리뷰와 충돌 후 물리 이펙트 사이에 짧은 크로스페이드를 추가해 합체 해석 프레임의 1프레임 이펙트 팝을 제거했습니다.

### Fixed
- 충돌 순간 0.03x에서 0.1x로 즉시 가속되며 합체 잔여체 재프레이밍까지 동시에 발생해 화면이 컷 전환처럼 튀던 문제를 수정했습니다.
- 충돌 대상 두 계보가 하나의 잔여체로 합쳐지는 해석 프레임에서는 카메라 거리와 시선 오프셋을 그대로 유지해 합체 직후 줌 점프가 발생하지 않도록 했습니다.
- 추적 중인 천체가 흡수·합체·파괴되면 큰 흡수체 여부와 관계없이 일반 추적을 해제하며, 다른 천체나 합체 후손으로 자동 전환하지 않도록 했습니다. 충돌 관찰의 source-lineage 추적은 별도 경로로 계속 유지됩니다.

## [0.17.22] - 2026-08-25

### Changed
- 일반 추적 또는 충돌 관찰 중 추적 대상이 사라져 추적이 해제되면 카메라 위치와 시선 타깃을 해제 직전 구도 그대로 유지하도록 변경했습니다.
- 추적이 없는 상태에서 화면 크기나 모바일/데스크톱 구성이 바뀌어도 기존 카메라 구도를 임의로 기본 중심에 재배치하지 않도록 했습니다.

### Fixed
- 충돌 직후 추적 대상이 흡수·파괴되어 `trackedBodyId`가 해제될 때 `moveCameraTargetTo(compositionOffset)`가 실행되며 화면이 기본 중심으로 갑자기 전환되던 문제를 수정했습니다.

## [0.17.21] - 2026-08-25

### Added
- 흡수 충돌에서 일반 추적을 이어받을 수 있는 선행 천체 ID를 물리 결과에 명시적으로 기록하고, 큰 흡수체와 작은 피흡수체의 추적 동작을 실제 충돌로 검증하는 회귀 체크를 추가했습니다.

### Changed
- `absorb` 충돌에서 추적 중인 천체가 엄격히 질량이 더 큰 흡수 주체였으면 합체 잔여체로 일반 추적을 이어가도록 변경했습니다.
- 작은 쪽이 흡수된 경우, 파괴된 경우, 일반 `merge`/`disrupt` 결과는 기존처럼 일반 추적을 해제하고 아무 천체도 자동 선택하지 않습니다.
- 왼쪽 추적 레일과 제어 패널 모두 임의 계보 검색 대신 물리 결과가 허용한 흡수 승계 정보만 사용하도록 통일했습니다.
- 동질량 충돌은 더 큰 흡수 주체가 명확하지 않으므로 일반 추적을 승계하지 않습니다.

### Fixed
- 큰 천체를 추적한 상태에서 작은 천체를 정상적으로 흡수해도 v0.17.20의 직접-ID 규칙 때문에 추적이 불필요하게 끊기던 문제를 수정했습니다.

## [0.17.20] - 2026-08-25

### Added
- 일반 추적이 원본 ID 생존 여부만 확인하는지, 흡수·파괴 후 합체 후손·파편·무관한 천체로 자동 승계되지 않는지 검증하는 추적 회귀 체크를 추가했습니다.

### Changed
- 일반 천체 추적은 선택 당시 천체의 정확한 ID가 계속 생존하는 동안에만 유지하도록 변경했습니다.
- 흡수·합체 또는 파괴로 원본 천체가 사라지면 왼쪽 추적 레일의 해당 초기 천체는 제거하지 않고 흑백/비활성 상태로 남기며 현재 추적 선택은 해제합니다.
- 충돌 관찰의 source-lineage 카메라 추적은 별도 경로로 유지해, 실제 임박 충돌 관찰 중에는 합체 후손을 계속 따라갈 수 있도록 했습니다.

### Fixed
- 추적 중인 천체가 흡수·합체되어 `Alpha+Beta` 같은 후손 ID로 바뀌었을 때 일반 추적이 해당 합체 천체로 자동 승계되던 문제를 수정했습니다.
- 추적 대상이 파괴되거나 사라진 뒤 다른 생존 천체 또는 파편을 일반 추적 대상으로 자동 선택할 수 있던 fallback 경로를 제거했습니다.

## [0.17.19] - 2026-08-25

### Added
- 행성·위성·고체 파편 충돌이 항성 플라즈마 경로와 섞이지 않는지, 충돌 직후 질량 보존과 동적 천체 상한을 지키는지 검증하는 비항성 충돌 회귀 체크를 추가했습니다.

### Changed
- 행성은 항성광을 반사하는 프로시저럴 지형·구름 띠와 약한 표면 림 산란 및 재질성 하이라이트를 사용하도록 변경했습니다.
- 위성은 대기 발광 없이 거친 레골리스·크레이터형 명암과 낮은 반사율을 사용하도록 변경했습니다.
- 고체 파편은 암석 표면 대비를 높이고 최소 시각 반경을 `0.04`에서 `0.022`로 낮춰 과도하게 큰 발광 덩어리처럼 보이지 않도록 조정했습니다.
- 비항성 천체의 표면색과 궤적은 항성 스펙트럼 팔레트로 강제 변환하지 않고 천체 고유 색을 유지하도록 변경했습니다.
- 렌더 시작 전에 천체 종류별 재질·궤적 색·corona 표시 여부를 동기화해 scene draw 순서와 무관하게 올바른 시각 상태가 적용되도록 했습니다.

### Fixed
- 행성·위성·고체 파편이 항성과 동일한 2중 additive corona sprite를 매 프레임 표시해 자체 발광 천체처럼 보이던 렌더 순서 회귀를 수정했습니다.
- 항성이 아닌 천체도 렌더 경로에서 `getNearestStellarColor()`에 의해 항성 스펙트럼 색으로 치환되던 문제를 수정했습니다.

## [0.17.18] - 2026-08-25

### Added
- 항성 충돌 전용 방향성 plane shader 렌더러를 추가해 접촉면 섬광, 압축/전단층, head-tail 플라즈마와 난류 필라멘트를 서로 다른 시각 단계로 표현하도록 했습니다.
- 기존 display-only 항성 겹침 구간을 감지해 물리 solver 결과가 확정되기 전부터 `Contact flash → Compression / shear → Plasma ejecta` 흐름이 보이도록 전용 프리뷰 효과를 추가했습니다.
- 충돌 효과에 진행 방향, 늘어짐, 폭, 꼬리 길이, 밝기, 난류, 펄스, 보조 항성 색과 온도 편향을 전달하는 전용 시각 메타데이터를 추가했습니다.

### Changed
- 항성 ejecta의 방향을 단순 랜덤 산란 대신 충돌 `normal`, `tangent`, `relativeVelocity`, `headOn`, `grazing`, `speedRatio`와 질량비를 조합해 결정하도록 했습니다.
- 스치는 충돌은 한쪽 접선 방향의 길고 찢어진 분출을 우세하게 하고, 정면 충돌은 충돌면을 따라 짧고 두꺼운 분출이 나오도록 분기했습니다.
- 항성 충돌마다 2~4개의 큰 플라즈마 클럼프와 더 작은 ejecta를 섞고, 충돌 속도와 기하에 따라 수명·속도·길이·꼬리·난류를 다르게 적용하도록 했습니다.
- 질량 차가 큰 항성 충돌은 작은 항성의 색과 운동 방향이 ejecta에 더 강하게 반영되도록 해 작은 쪽 물질이 뜯겨 나가는 편향을 강화했습니다.
- 플라즈마 색을 백색/청백색 고온 코어, 혼합된 항성색 중간층, 냉각되며 옅게 적색화·탈채되는 외곽층으로 분리하고 선형이 아닌 감쇠 곡선을 적용했습니다.
- 효과 수는 기존 동적 천체 상한 28개 안에서 contact flash 슬롯까지 예약하도록 제한하고, effect plane geometry를 공유해 렌더링 부하 증가를 제한했습니다.

### Fixed
- `Collision flash`와 `Stellar plasma`가 원형 radial glow sprite 두 장으로만 보여 비눗방울·발광 구슬처럼 보이던 현상을 제거했습니다.
- 항성 플라즈마가 일반 고체 파편처럼 둥근 덩어리로 보이거나 좌우 완전 대칭으로 퍼지던 시각적 문제를 수정했습니다.

## [0.17.17] - 2026-08-25

### Added
- `Alpha × Gamma` 관찰 중 `Alpha × Beta → Alpha+Beta`처럼 제3자 합체가 먼저 발생하는 계보 시나리오와 target `hit-and-run` 판정을 검증하는 충돌 관찰 회귀 테스트를 추가했습니다.
- 1080px 폭을 포함한 여러 화면비·천체 반지름에서 투영 반지름이 화면 너비의 1/20에 맞는지 검증하는 perspective camera 수학 회귀 테스트를 추가했습니다.
- PR마다 물리 회귀 테스트, TypeScript 컴파일, Vite 빌드를 각각 실행하는 CI 검증을 추가했습니다.

### Changed
- 충돌 관찰 대상은 최초 source ID를 기준으로 현재 생존 descendant를 계속 resolve하며, 원본 ID가 사라진 경우 해당 계보에서 질량이 가장 큰 생존 천체를 대표 후손으로 사용하도록 변경했습니다.
- 충돌 관찰 정보의 현재 ID·이름·종류·색상·질량·반지름을 source lineage의 현재 descendant 기준으로 갱신하도록 변경했습니다.
- 일반 추적/충돌 관찰 카메라를 synthetic anchor 간접 프레이밍에서 실제 body radius와 실제 renderer viewport/FOV 기반의 직접 perspective 거리 계산으로 변경했습니다.
- 일반 추적과 충돌 관찰 모두 실제 렌더링 반지름이 화면 너비의 약 1/20이 되도록 동일한 배율 규칙을 사용합니다.
- 자동 카메라 최대 거리를 기존 충돌 관찰 18 / OrbitControls 30 제한에서 far plane 범위 내 450으로 확대했습니다.
- 항성-항성 `merge`의 최대 display-only overlap을 작은 항성 반지름의 120%에서 160%로 확대했습니다.
- 항성 합체 연출 시간을 0.09에서 0.12 시뮬레이션초로 늘려 `0.03×` 관찰에서 약 4초 동안 접촉/흡수 과정을 보여주도록 했습니다.

### Fixed
- 충돌 관찰 중 제3의 천체가 대상 하나와 먼저 합쳐져 원본 ID가 사라지거나 한쪽에 cooldown이 생겼을 때 target collision을 완료로 오판해 `0.03×`가 조기에 해제되던 문제를 수정했습니다.
- `hit-and-run` 완료 판정을 현재 target descendant 두 천체의 실제 접촉, 양쪽 cooldown, 해당 descendant pair의 fresh collision flash를 함께 확인하도록 해 제3자 충돌과 구분했습니다.
- 충돌 관찰 중 주 천체가 제3자를 흡수해 ID/반지름이 바뀌어도 같은 source lineage를 계속 추적하고, 반지름이 의미 있게 변할 때만 카메라 거리를 부드럽게 재조정하도록 했습니다.
- 항성 합체의 160% 깊은 겹침은 렌더링 staging에만 적용하고 실제 solver 직전에는 기존 microscopic contact frame으로 복원해 물리 해석 안정성을 유지했습니다.

## [0.17.16] - 2026-08-25

### Changed
- 항성-항성 `merge` 충돌의 최대 시각적 겹침을 작은 항성 반지름의 80%에서 120%로 확대했습니다.
- 120% 겹침 증가에 맞춰 항성 합체 연출 시간을 0.06에서 0.09 시뮬레이션초로 늘려 `0.03×` 충돌 관찰에서 약 3초 동안 흡수 과정을 보여주도록 했습니다.
- 일반 추적과 충돌 관찰의 자동 카메라 배율을 동일한 규칙으로 통일해, 선택된 주 천체의 렌더링 반지름이 화면 너비의 약 1/20이 되도록 조정했습니다.
- 일반 추적에서 주변의 큰 천체나 `질량 / 거리²` 기준 궤도 참조 천체를 더 이상 찾지 않으며, 줌은 선택한 천체 자체의 반지름만 사용하도록 변경했습니다.
- 충돌 관찰에서는 상대 충돌체를 시점 방향을 잡는 데만 사용하고 카메라 확대 배율 계산에서는 완전히 제외했습니다.

### Fixed
- 항성끼리 충분히 깊게 파고들기 전에 합체 결과로 교체되어 여전히 `뿅` 하고 하나로 바뀌는 느낌이 남던 문제를 완화했습니다.
- 추적 대상 주변 천체의 거리·질량이나 충돌 상대와의 거리에 따라 자동 카메라 배율이 달라지던 경로를 제거했습니다.

## [0.17.15] - 2026-08-25

### Added
- 항성-항성 합체가 실제 물리 결과로 전환되기 전에 충분히 깊게 겹치는지 검증하는 물리 회귀 체크를 추가했습니다.

### Changed
- 항성-항성 `merge` 충돌의 접촉 연출 시간을 0.045에서 0.06 시뮬레이션초로 늘려 `0.03×` 관찰에서 약 2초 동안 흡수 과정을 보여주도록 했습니다.
- 항성-항성 합체의 최대 시각적 겹침을 작은 항성 반지름의 18%에서 80%로 확대하고, 일반 합체와 `hit-and-run` 충돌은 기존 겹침 규칙을 유지했습니다.
- 일반 추적 카메라에서 가장 큰 순간 중력 영향을 주는 천체는 카메라 시점 방향을 정하는 데만 사용하고, 줌 배율은 추적 대상 자체의 반지름을 기준으로 고정하도록 했습니다.
- 충돌 관찰 카메라는 일반 추적 구도보다 최대 약 20%까지만 더 확대하고, 상대 천체를 함께 담아야 하는 경우에는 오히려 더 축소하도록 안전 범위를 적용했습니다.

### Fixed
- 항성끼리 약간만 겹친 상태에서 원본 두 항성이 갑자기 하나의 잔여 항성으로 바뀌어 `뿅` 하고 합쳐지는 것처럼 보이던 현상을 완화했습니다.
- 같은 천체를 다시 추적할 때 현재 주변 천체의 거리와 `질량 / 거리²` 기준 상대가 달라졌다는 이유로 초기 카메라 배율이 크게 달라지거나 간헐적으로 과확대되던 문제를 수정했습니다.

## [0.17.14] - 2026-08-25

### Changed
- 충돌 관찰 카메라의 거리 계수를 일반 천체 추적 카메라의 거리 계수와 직접 연동하도록 변경했습니다.
- 충돌 관찰은 왼쪽 추적 레일에서 같은 천체를 선택했을 때의 구도보다 약 20%만 더 확대되도록 조정했습니다.

### Fixed
- 충돌 관찰 진입 시 일반 추적 대비 약 42% 가까이 카메라가 당겨져 천체가 화면을 과도하게 채우던 문제를 완화했습니다.

## [0.17.13] - 2026-08-25

### Changed
- 충돌 슬로모션의 약 1.5초 전환 시간을 충돌 전 접근 연출이 아니라 실제 표면 접촉 이후의 충돌 장면에 사용하도록 변경했습니다.
- 합체·흡수 충돌은 접촉 후 두 천체가 점진적으로 압축되고 밝아진 뒤 물리 결과로 전환되며, `hit-and-run`은 접촉 압축 후 이탈하는 흐름을 보여주도록 했습니다.

### Fixed
- 충돌 직전 접근만 길게 재생된 뒤 실제 접촉 순간 한 천체가 즉시 사라지며 잔여 천체·플라즈마·섬광으로 튀던 팝 현상을 수정했습니다.
- 접촉 직후 원본 충돌 천체가 즉시 제거되는 회귀를 잡기 위해 충돌 단계 유지 시간을 검증하는 물리 회귀 체크를 보강했습니다.

## [0.17.12] - 2026-08-25

### Added
- 충돌 접촉 거리, 극단적 질량차 충돌 섬광 위치, `hit-and-run` 생존체 분리, 슬로모션 접근 중 선행 섬광·시각적 겹침을 검증하는 물리 회귀 체크 4개를 추가했습니다.
- `npm run build`가 물리 회귀 체크를 먼저 실행하도록 해 이후 충돌 처리 회귀가 배포 전에 차단되도록 했습니다.

### Changed
- 충돌 접촉 거리 계산을 별도 배율 API 없이 항상 두 천체의 렌더링 반지름 합으로 계산하도록 단일화했습니다.
- `Collision flash`의 생성 위치를 질량중심이 아니라 두 천체의 실제 표면 접촉점으로 변경했습니다.
- 물리 회귀 체크는 프로젝트와 동일한 Vite TypeScript 변환 경로를 사용하도록 구성했습니다.

### Fixed
- 충돌 접근 연출에서 천체 반지름을 최대 6% 팽창시키던 효과 때문에 실제 접촉 전에 화면상 천체가 먼저 겹칠 수 있던 문제를 제거했습니다.
- 극단적인 질량차 충돌에서 충돌 섬광이 큰 천체 내부의 질량중심 근처에서 생성될 수 있던 문제를 수정했습니다.
- `hit-and-run` 분리 거리가 과거의 접촉 배율 API에 다시 의존할 수 있던 회귀 경로를 제거했습니다.

## [0.17.11] - 2026-08-25

### Changed
- 항성·행성·위성의 실제 충돌 경계를 렌더링되는 고체 표면과 동일한 `반지름 합`으로 통일하고, 항성의 코로나·대기층 표현은 물리 충돌 반경에서 분리했습니다.
- 충돌 슬로모션은 충돌 후 결과를 미리 계산해 재생하는 방식 대신 `접근 → 실제 표면 접촉 → 충돌 결과 생성 → 후속 운동` 순서로 처리하도록 재구성했습니다.
- 충돌 예정 여부를 확인하기 위한 물리 스텝은 탐지용으로만 사용하고, 충돌이 감지되면 이미 계산된 미래 결과를 폐기한 뒤 현재 상태에서 실제 접촉면까지 접근하도록 변경했습니다.

### Fixed
- 충돌체가 화면에서 아직 접촉 중인데 합체 결과·파편·섬광이 이미 미래 위치로 이동하던 시간축 불일치 문제를 수정했습니다.
- 항성 충돌 시 작은 천체가 렌더링된 항성 표면 안쪽까지 깊게 파고든 뒤 충돌하는 것처럼 보이던 문제를 수정했습니다.
- `hit-and-run` 충돌 뒤 생존 천체가 축소된 접촉 거리 때문에 서로 겹친 상태로 배치되던 문제를 수정했습니다.
- 충돌 슬로모션 중 `Collision flash`가 충돌 지점과 분리되어 별도의 큰 광원처럼 먼저 이동하던 현상을 제거했습니다.

## [0.17.10] - 2026-08-25

### Changed
- 충돌 접근 슬로모션의 진입 시점을 충돌 약 0.36 시뮬레이션초 전으로 늦춰, `0.1×` 접근 구간이 충돌 직전 `0.03×` 전환 시점까지 실제 약 3초 동안 재생되도록 조정했습니다.
- 충돌 후 자동 관찰 잠금과 충돌 정보 유지 시간을 3초에서 2초로 단축하고, 관찰 종료 시 충돌 관찰 이전 배속으로 복귀하는 기존 동작을 유지했습니다.

## [0.17.9] - 2026-08-25

### Changed
- 질량비가 2% 미만인 극단적 질량차 충돌은 일반적인 grazing 조건만으로 `hitRun` 생존 판정이 나지 않도록 제한했습니다.
- 충돌 슬로모션 연출을 충돌 직전 위치에서 사후 위치로 곧바로 보간하는 방식 대신 실제 접촉면까지 접근한 뒤 이탈·합체 결과로 이어지는 2단계 경로로 변경했습니다.
- 충돌 관찰이 시작될 때 기존 시뮬레이션 배속을 저장하고, 충돌 후 3초 관찰이 끝나면 저장한 배속으로 자동 복원하도록 했습니다.
- 충돌 후 관찰 중 사용자가 직접 배속을 변경한 경우에는 자동 복원이 그 수동 선택을 덮어쓰지 않도록 했습니다.

### Fixed
- 질량 차이가 매우 큰 위성·행성 충돌에서 작은 천체가 거대 천체 내부를 관통해 반대편으로 튀어나오는 것처럼 보이던 문제를 수정했습니다.
- 충돌 관찰이 끝난 뒤에도 시뮬레이션 배속이 `0.1×`에 남아 있던 문제를 수정했습니다.

## [0.17.8] - 2026-08-25

### Changed
- 흡수·합체로 여러 초기 천체가 동일한 생존 천체로 이어진 경우 왼쪽 추적 레일에는 현재 생존 천체를 하나만 표시하도록 변경했습니다.
- 파괴되어 파편이나 이펙트만 남은 천체는 더 이상 왼쪽 추적 레일에 남기지 않도록 했습니다.
- 새 추적 또는 충돌 관찰의 자동 카메라 구도는 짧은 초기 정렬 구간에서만 적용하고, 이후에는 선택 천체를 따라가면서 사용자의 수동 카메라 조작을 유지하도록 했습니다.

### Fixed
- 합체된 하나의 천체를 여러 초기 천체가 각각 자기 후손으로 인식해 왼쪽 추적 레일에 중복 표시되던 문제를 수정했습니다.
- 자동 추적 카메라가 매 프레임 초기 거리로 되돌아가 핀치/휠로 축소해도 즉시 원래 배율로 복귀하던 문제를 수정했습니다.

## [0.17.7] - 2026-08-25

### Changed
- 새로운 천체를 추적할 때마다 해당 천체에 가장 큰 순간 중력 영향을 주는 천체를 `질량 / 거리²` 기준으로 찾아 궤도 기준 천체로 사용하도록 했습니다.
- 추적 천체와 기준 천체의 상대 위치·상대 속도로 궤도면을 추정해 궤적이 잘 드러나는 카메라 각도를 선택하도록 했습니다.
- 현재 궤도 반경과 천체 크기를 충분히 담는 배율을 새 추적 시작 시 한 번 설정하고, 이후에는 그 구도와 배율을 유지하면서 선택 천체를 따라가도록 했습니다.
- 충돌 관찰 카메라가 활성화된 동안에는 충돌 전용 구도를 우선하고, 사용자가 다른 천체를 선택하면 새 천체의 일반 궤도 구도로 즉시 전환하도록 했습니다.

## [0.17.6] - 2026-08-25

### Changed
- 자동 충돌 관찰은 예측 충돌 약 3 시뮬레이션초 전에 한 번만 주 천체를 선택하고 초기 카메라 구도를 잡도록 변경했습니다.
- 충돌 관찰 카메라는 진입 시 계산한 배율과 시점을 유지한 채 질량이 큰 주 천체만 따라가며, 두 천체 사이가 가까워져도 충돌 직전까지 추가 확대하지 않도록 변경했습니다.
- 3초 전 카메라 진입과 감속 시점을 분리해 기존처럼 충돌 약 0.6 시뮬레이션초 전부터 0.1×, 마지막 0.06 시뮬레이션초는 0.03×를 적용하도록 했습니다.
- 충돌 관찰 도중 사용자가 추적 레일이나 제어 패널에서 다른 천체를 선택하면 해당 충돌에 대한 자동 카메라 우선권을 즉시 해제하고 사용자가 선택한 천체를 계속 추적하도록 했습니다.

### Fixed
- 충돌 예정 천체가 가까워질수록 충돌 카메라가 매 프레임 배율을 다시 계산해 지나치게 확대되던 문제를 수정했습니다.
- 자동 충돌 관찰이 활성화된 동안 사용자가 다른 천체를 선택해도 충돌 카메라가 계속 우선 적용되던 문제를 수정했습니다.

## [0.17.5] - 2026-08-25

### Fixed
- 항성-항성 합체 후 두 충돌 원본 ID가 하나의 잔여 항성으로 합쳐지면서 충돌 카메라가 해제되고 결과 항성이 화면 밖으로 밀려나 사라진 것처럼 보이던 문제를 수정했습니다.
- 충돌 후관찰 동안 합체된 잔여 항성을 계속 카메라 중심에 유지하도록 렌더 전용 추적 연결을 보강했습니다.

## [0.17.4] - 2026-08-25

### Changed
- 충돌 관찰 카메라의 화면 점유율을 낮춰 두 충돌 천체가 화면을 과도하게 가득 채우지 않도록 조정했습니다.
- 충돌 관찰 최소 카메라 거리를 늘리고 천체 주변 여유 공간을 확대해 충돌 직전에도 지나친 확대를 방지했습니다.

## [0.17.3] - 2026-08-25

### Fixed
- 항성 충돌 뒤 `Collision flash`·`Stellar plasma`의 숨김용 구형 메시가 불투명 렌더 큐에서 검은 원형 천체처럼 그려져 항성을 가리던 문제를 수정했습니다.
- 완전히 투명해야 하는 충돌 효과 메시의 프래그먼트를 셰이더에서 폐기해 색상과 depth buffer를 모두 남기지 않도록 했습니다.

## [0.17.2] - 2026-08-25

### Changed
- 충돌 관찰이 시작되면 충돌 예정 두 천체 중 질량이 더 큰 천체를 추적 대상으로 유지하면서, 카메라 중심을 상대 천체 방향으로 일부 보정해 두 천체가 함께 보이도록 했습니다.
- 충돌 쌍의 상대 위치와 상대 속도를 이용해 충돌 진행 방향이 화면에 잘 드러나는 측면 시점을 자동으로 선택하도록 했습니다.
- 두 천체의 거리·반지름·현재 화면 종횡비를 기준으로 충돌 관찰 전용 카메라 거리를 계산하고, 접근할수록 자연스럽게 확대되도록 했습니다.
- 충돌 관찰 중에는 일반 추적보다 더 가까운 카메라 거리를 허용하고, 관찰이 끝나면 기존 일반 추적 거리 제한으로 복귀하도록 했습니다.

### Fixed
- 충돌 관찰이 큰 천체를 선택해도 기존 카메라의 먼 배율과 각도가 그대로 유지되어 충돌 장면이 지나치게 작게 보이던 문제를 수정했습니다.

## [0.17.1] - 2026-08-25

### Changed
- 모바일 세로모드에서 하단 제어 패널이 펼쳐져 있으면 `BodyTrackingRail`을 패널 높이의 절반만큼 위로 이동해, 패널에 가리지 않는 화면 영역의 중심에 더 가깝게 표시하도록 조정했습니다.
- 하단 패널을 접으면 추적 레일이 기존 화면 왼쪽 중앙 위치로 복귀하며, 가로모드에는 위치 보정을 적용하지 않습니다.

## [0.17.0] - 2026-08-25

### Added
- 좌측 상단 실행 상태 배지를 터치 가능한 배속 드롭다운으로 확장하고 `0.1×`, `0.5×`, `1×`, `2×`, `3×`, `5×`, `10×`를 즉시 선택할 수 있도록 했습니다.
- 현재 배속을 드롭다운에서 강조하고, 바깥 영역 터치·ESC·배지 재터치로 메뉴를 닫을 수 있도록 했습니다.

### Changed
- `BodyTrackingRail`을 `ControlPanel`에서 분리해 `App`의 독립 형제 컴포넌트로 렌더링하고 모든 화면 크기에서 뷰포트 왼쪽 중앙에 고정했습니다.
- 배속 변경 시 React 상태와 물리 루프의 `speedRef`를 동시에 갱신해 선택한 배속이 즉시 적용되도록 했습니다.
- 추적 레일은 기존의 선택 초록 테두리, 추적 불가 흑백/비활성, 자동 선택 해제, collision watch 자동 선택 동기화를 유지합니다.

### Fixed
- 태블릿에서 제어 패널의 접힘 transform과 overflow 영향을 받아 추적 레일 위치가 함께 이동하던 문제를 제거했습니다.
- `control-panel`에 종속된 추적 레일 위치 규칙을 제거해 모바일·태블릿·데스크톱에서 동일한 화면 좌표를 유지하도록 했습니다.

## [0.16.0] - 2026-08-25

### Added
- 화면 왼쪽 중앙에 초기 천체의 모양과 색상만 표시하는 컴팩트 수직 추적 레일을 추가했습니다.
- 추적 레일에서 천체를 누르면 해당 천체를 카메라가 추적하고, 선택된 버튼 테두리를 초록색으로 표시하도록 했습니다.

### Changed
- 자동 충돌 관찰이 추적 대상을 선택할 때도 왼쪽 추적 레일의 선택 상태가 함께 반영되도록 변경했습니다.
- 합체 이후에는 선택한 초기 천체의 계보에서 가장 큰 생존 천체를 계속 추적 대상으로 연결하도록 변경했습니다.

### Fixed
- 초기 질량의 절반 이하로 감소했거나 더 이상 생존 계보를 찾을 수 없는 천체는 추적 레일에서 흑백/비활성 상태로 표시하고 선택할 수 없도록 했습니다.
- 선택 중인 천체가 추적 불가 상태가 되면 선택 상태와 카메라 추적을 자동으로 해제하도록 했습니다.

## [0.15.25] - 2026-08-25

### Changed
- 천체 1 프리셋에서 `정지한 단일 물체`, `고속 직선 운동`, `3차원 대각선 운동`을 제거했습니다.
- 천체 1의 활성 프리셋과 기본값을 `등속 직선 운동` 하나로 정리했습니다.

## [0.15.24] - 2026-08-25

### Fixed
- 버전 표시가 `ControlPanel` 내부 DOM에 남아 있어 모바일/태블릿 패널의 transform·backdrop-filter 기준으로 배치될 수 있던 문제를 수정했습니다.
- 버전 표시를 문서 루트에 직접 렌더링해 하단/우측 제어 패널과 완전히 분리하고, 실제 시뮬레이션 화면 상단 중앙에 고정했습니다.

### Changed
- 기존 제어 패널 제목 옆 버전 노드는 숨기고, `package.json` 버전을 읽는 화면 상단 전용 버전 표시를 사용하도록 변경했습니다.

## [0.15.23] - 2026-08-25

### Changed
- 앱 버전 표시를 제어 패널 제목 옆에서 상단 중앙으로 이동해 진행시간과 언어 설정이 보이는 상단 라인의 중앙에 고정했습니다.
- 데스크톱·태블릿·모바일에서 동일한 화면 중앙 기준을 사용하도록 위치를 정리했습니다.

## [0.15.22] - 2026-08-25

### Added
- 충돌 관찰 중 실제 접촉 장면을 약 1.5초 동안 보여주는 초슬로모션 충돌 전환을 추가했습니다.
- 접촉 중 두 충돌 천체가 즉시 사라지지 않고 실제 물리 결과 위치를 향해 겹치며 밝아지고 약하게 팽창하도록 했습니다.

### Changed
- 충돌 전환 동안 화면은 0.03x 초슬로모션을 유지하지만, 실제 충돌 이후 물리 계산은 백그라운드에서 계속 진행하도록 분리했습니다.
- 전환 종료 후 실제 합체/스침 결과를 표시하고 기존 3초 후관찰 단계로 이어지도록 했습니다.

## [0.15.21] - 2026-08-25

### Changed
- 충돌 후 자동 관찰 잠금 시간을 6초에서 3초로 단축했습니다.
- 충돌 정보 패널의 충돌 후 유지 시간도 6초에서 3초로 단축했습니다.
- 충돌 직전 0.03x 초슬로모션, 충돌 후 0.1x 속도, 섬광/플라즈마 효과는 그대로 유지했습니다.

## [0.15.20] - 2026-08-25

### Changed
- 자동 충돌 관찰이 예측 충돌 약 0.6 시뮬레이션초 전에 시작되도록 늦췄습니다.
- 충돌 직전 마지막 0.06 시뮬레이션초를 0.03x 초슬로모션으로 재생하도록 했습니다.
- 충돌 직후에는 0.1x로 전환해 결과와 이펙트를 관찰하도록 했습니다.
- 항성 충돌 섬광과 플라즈마 글로우를 더 크고 밝게 조정했습니다.

## [0.15.19] - 2026-08-25

### Fixed
- 충돌 관찰 직후 다음 예상 충돌로 즉시 카메라/추적 대상이 넘어가던 문제를 수정했습니다.
- 활성 충돌 관찰이 끝나기 전에는 다른 충돌로 자동 재타깃하지 않도록 잠금을 추가했습니다.
- 항성 충돌의 고체 파편만 제거하고 섬광/플라즈마 효과는 다시 표시하도록 수정했습니다.

### Changed
- 항성 충돌 이펙트의 일반 구형 메시를 사실상 숨기고 additive glow 중심으로 렌더링하도록 변경했습니다.

## [0.15.18] - 2026-08-25

### Fixed
- 항성에서 유래한 파편/이펙트가 큰 고체 구체처럼 보이던 문제를 막기 위해 항성 충돌 부산물을 렌더 상태에서 필터링했습니다.

## [0.15.17] - 2026-08-25

### Fixed
- 항성 충돌에서 이동하는 플라즈마/파편 `BodyState`가 큰 고체 구체처럼 보이던 문제를 수정했습니다.
- 항성에서 유래한 고체 파편이 다시 소행성형 잔해로 남지 않도록 안전 필터를 추가했습니다.

### Changed
- 코어 물리 엔진에서 이미 계산된 항성 방출 질량·운동량 손실은 유지하면서, 전용 가스 렌더러가 없는 상태에서는 이동하는 항성 방출물 구체를 화면에서 제거하고 중앙 충돌 섬광만 남기도록 했습니다.

## [0.15.16] - 2026-08-25

### Fixed
- 항성 충돌 시 방출 질량을 실제 잔해 질량에서 차감하도록 수정했습니다.
- 항성-파편 충돌은 흡수되도록 처리하고, 항성-항성 고속 충돌은 무조건 합체하지 않도록 충돌 분류를 보완했습니다.

### Changed
- 항성 충돌에서 고체 소행성형 파편 대신 플라즈마/가스 성격의 효과를 사용하도록 물리 처리 방향을 정리했습니다.

## [0.15.15] - 2026-08-25

### Fixed
- 하단 천체 제어 패널이 충돌 후 생성된 파편을 추가하지 않고 시뮬레이션 시작 시점의 천체만 유지하도록 수정했습니다.
- 합체 이후에도 초기 천체의 원래 이름을 패널에서 유지하도록 했습니다.

### Changed
- 충돌 정보와 초기 천체 이름 옆에 천체 종류를 더 명확하게 표시하도록 UI를 정리했습니다.

## [0.15.14] - 2026-08-25

### Added
- 일정 크기와 질량 이상의 충돌 파편을 소행성처럼 장기간 N-body 시뮬레이션에 남기되 개수를 제한하도록 했습니다.
- 정면 충돌과 스치는 충돌을 구분해 서로 다른 충돌 결과를 선택하도록 충돌 분류를 확장했습니다.

### Changed
- 추적 중인 천체가 초기 질량의 절반 이하로 감소하면 해당 천체의 추적을 종료하도록 했습니다.

## [0.15.13] - 2026-08-25

### Fixed
- 충돌 글로우 효과가 지나치게 커지는 것을 제한했습니다.
- 항성 충돌 플라즈마가 너무 오래 남지 않도록 지속시간을 줄였습니다.

## [0.15.12] - 2026-08-25

### Fixed
- 행성·위성 등 비항성 천체가 항성처럼 강하게 발광하던 문제를 수정했습니다.

### Changed
- 상단 충돌 관찰 패널의 높이와 여백을 줄여 더 컴팩트하게 만들었습니다.

## [0.15.11] - 2026-08-25

### Fixed
- 충돌 관찰 정보가 타임아웃 직전 불필요하게 넓게 유지되는 문제를 수정해 표시 범위를 정리했습니다.

## [0.15.10] - 2026-08-25

### Added
- 충돌 관찰 대상 두 천체의 이름·종류·수치 정보를 보여주는 정보 패널과 다국어 문구를 추가했습니다.

### Changed
- 실제 충돌 뒤에도 관찰 대상 정보를 약 3초간 유지하도록 했습니다.
- 충돌 정보 수치 포맷을 브라우저 환경에 더 안정적으로 동작하도록 정리했습니다.

## [0.15.9] - 2026-08-25

### Added
- 충돌 예측·경고에 충돌 예정 천체의 종류를 표시하도록 했습니다.

### Changed
- 충돌 관찰 시 추적 카메라를 더 가까이 당겨 충돌 천체와 장면을 크게 볼 수 있도록 조정했습니다.
- 충돌 대상 종류의 시각적 구분을 강화했습니다.
## [0.15.8] - 2026-08-25

### Added
- 태블릿에서 사이드 패널을 접은 상태에서도 시작/정지 등 핵심 기능을 사용할 수 있는 컴팩트 퀵 컨트롤을 추가했습니다.

## [0.15.7] - 2026-08-25

### Fixed
- 모바일 기기 회전 후 뷰포트가 비정상적으로 확대되는 문제를 수정했습니다.
- 화면 방향 변경 중 태블릿 오버레이 패널이 뷰포트 밖으로 넘치는 문제를 수정했습니다.

## [0.15.6] - 2026-08-25

### Fixed
- 모바일 패널 경계와 접기/펴기 핸들의 위치가 흔들리거나 어긋나는 문제를 안정화했습니다.

## [0.15.5] - 2026-08-25

### Fixed
- 모바일 패널이 접힌 상태에서 접기/펴기 핸들이 상단 경계 위에 완전히 드러나도록 위치를 조정했습니다.

## [0.15.4] - 2026-08-24

### Fixed
- 모바일 패널 토글을 패널 상단 경계에 자연스럽게 붙여 여백과 위치 문제를 수정했습니다.

## [0.15.3] - 2026-08-24

### Fixed
- 태블릿에서 시뮬레이션 뷰포트를 전체 화면으로 유지한 채 제어 패널을 오버레이하도록 레이아웃을 변경했습니다.
- 접힌 모바일 패널의 토글이 패널 밖에서도 정상적으로 보이도록 오버플로와 핸들 배치를 조정했습니다.

## [0.15.2] - 2026-08-24

### Fixed
- 태블릿에서 패널을 접고 펴도 시뮬레이션 뷰 자체를 재구성하지 않도록 해 상태가 보존되도록 수정했습니다.
- 패널을 너비 0으로 만드는 대신 화면 밖으로 이동시키는 방식으로 접기 동작을 안정화했습니다.

## [0.15.1] - 2026-08-24

### Added
- 태블릿 화면에서 우측 사이드 패널을 접고 펼칠 수 있는 전용 핸들을 추가했습니다.

### Changed
- 태블릿용 패널 제어 스타일을 별도 로드해 데스크톱·모바일 레이아웃과 분리했습니다.

## [0.15.0] - 2026-08-24

### Changed
- 항성이 포함된 충돌에서 방출물을 고체 파편 대신 플라즈마 성격의 효과로 렌더링하도록 변경했습니다.

## [0.14.2] - 2026-08-24

### Added
- 충돌 파편에 수명과 페이드아웃 생명주기를 적용했습니다.

### Changed
- 파편 궤적의 수와 유지 범위를 제한해 충돌 이후 화면 복잡도와 렌더링 부담을 낮췄습니다.
- 파편이 갑자기 사라지지 않고 자연스럽게 희미해지도록 했습니다.

## [0.14.1] - 2026-08-24

### Added
- 충돌 파편을 구형 천체가 아닌 불규칙한 파편 형상으로 생성하는 지오메트리를 추가했습니다.

### Changed
- 파편이 물리 반경 안에 유지되도록 형상을 제한하고, 파편 종류에 따라 전용 지오메트리 생명주기를 사용하도록 했습니다.

## [0.14.0] - 2026-08-24

### Changed
- 항성·행성·위성 등 천체 종류에 따라 실제 충돌 접촉 거리가 달라지도록 했습니다.
- 충돌 예측도 동일한 접촉 거리 규칙을 사용해 물리 충돌 시점과 경고 시점을 일치시켰습니다.
- 합체 후 천체 이름에 원래 천체 이름을 보존하도록 충돌 결과 이름 처리를 정리했습니다.

## [0.13.2] - 2026-08-24

### Fixed
- 충돌 관찰 컨트롤이 화면 폭에 따라 줄바꿈되지 않고 한 줄에 유지되도록 강제했습니다.

## [0.13.1] - 2026-08-24

### Fixed
- 충돌 관찰 체크박스와 주요 컨트롤의 한 줄 배치를 안정화했습니다.

## [0.13.0] - 2026-08-24

### Added
- 자동 `충돌 관찰` 체크박스를 추가했습니다.
- 임박한 충돌이 감지되면 해당 천체를 자동 추적하고 시뮬레이션을 느리게 재생하는 관찰 모드를 추가했습니다.
- 충돌 관찰 관련 한국어/영어 문구를 추가했습니다.

### Changed
- 충돌 관찰 컨트롤을 시작·정지 등 주요 조작부 근처에 배치했습니다.

## [0.12.3] - 2026-08-24

### Fixed
- 합체/충돌 후 추적 대상이 사라졌을 때 해당 계보에서 가장 큰 생존 천체를 계속 추적하도록 수정했습니다.
## [0.12.2] - 2026-08-24

### Fixed
- 모든 시간 배속 버튼이 한 줄에 유지되도록 레이아웃과 스타일 로딩을 수정했습니다.

## [0.12.1] - 2026-08-24

### Added
- 기존 배속 사이에 중간 시뮬레이션 속도를 추가했습니다.

### Fixed
- 전체 질량/반지름 배율을 조정할 때 기준값 자체가 누적 변경되는 문제를 막아 원래 값을 보존했습니다.

## [0.12.0] - 2026-08-24

### Added
- 모든 초기 천체의 질량과 반지름 배율을 한 번에 조절하는 전역 스케일 슬라이더를 추가했습니다.
- 스케일 컨트롤 UI와 한국어/영어 문구를 추가했습니다.

## [0.11.2] - 2026-08-24

### Fixed
- 숫자 입력 필드를 편집할 때 값을 완전히 지운 뒤 새 값을 입력할 수 없던 문제를 수정했습니다.

## [0.11.1] - 2026-08-24

### Fixed
- 충돌 예측을 단순 근사 대신 수치 적분 기반으로 계산하도록 개선했습니다.
- 예측 쿨다운이 중복 계산되는 문제를 수정했습니다.
- 연속 예측을 확인한 뒤 경고를 확정하고 오래된 충돌 예측을 제거하도록 해 오경보를 줄였습니다.
- 충돌 관찰 타이밍을 조정했습니다.

## [0.11.0] - 2026-08-24

### Added
- 앞으로 발생할 충돌을 예측하는 기능을 추가했습니다.
- 충돌 임박 경고 오버레이와 한국어/영어 문구를 추가했습니다.
- 충돌 직전 장면을 느린 속도로 볼 수 있는 경고/슬로모션 재생 흐름을 추가했습니다.

## [0.10.1] - 2026-08-24

### Fixed
- 천체 조명 상태를 재질 렌더 훅에서 갱신하도록 해 렌더링 동기화 문제를 수정했습니다.
- 충돌 섬광과 파편이 실제 화면에서 보이지 않거나 너무 약하게 보이던 문제를 수정하고 가시성을 강화했습니다.

## [0.10.0] - 2026-08-24

### Added
- `항성`, `행성`, `위성` 등 천체 종류 메타데이터와 프리셋 매핑을 도입했습니다.
- 초기 조건에서 천체 종류를 직접 선택할 수 있는 컨트롤과 다국어 레이블을 추가했습니다.
- 항성을 광원으로 사용해 다른 천체의 조명을 계산하는 종류 기반 렌더링을 추가했습니다.

## [0.9.0] - 2026-08-24

### Added
- 충돌 천체 종류·메타데이터를 물리 엔진에 전달하도록 했습니다.
- 천체 종류에 따라 합체, 흡수, 파괴 등 서로 다른 충돌 결과와 파편을 생성하는 충돌 시스템을 추가했습니다.

## [0.8.0] - 2026-08-24

### Added
- 2D/3D 공간 모드 타입과 전환 컨트롤을 추가했습니다.
- 2D/3D 모드별 한국어/영어 문구와 컴팩트 세그먼트 UI를 추가했습니다.

### Changed
- 평면 모드에서는 프리셋의 궤도면을 평면에 맞게 적용하도록 프리셋 오버라이드를 추가했습니다.

## [0.7.0] - 2026-08-24

### Added
- 실제 z축 성분을 사용하는 3D 궤도면과 경사 궤도 프리셋을 추가했습니다.

### Changed
- 기존 평면 전용 궤도 정의를 정리하고 3D 프리셋 이름과 레이블을 실제 시스템 구조와 관찰 특성에 맞게 조정했습니다.

## [0.6.0] - 2026-08-24

### Changed
- 4~6체 프리셋이 서로 비슷한 왕관형 배치에 치우치지 않도록 다체 시스템 구성을 다양화했습니다.
- 프리셋 명칭을 실제 시스템 구조와 관찰 특성이 드러나도록 정리했습니다.

## [0.5.0] - 2026-08-24

### Added
- 4~6체 구성에 항성-행성-위성이 계층적으로 도는 프리셋을 추가했습니다.

### Changed
- 다체 계층 시스템의 초기 속도와 배치를 안정화하고 해당 프리셋 레이블을 추가했습니다.

## [0.4.0] - 2026-08-24

### Added
- 최대 6개 천체까지 시뮬레이션할 수 있도록 천체 수 타입과 UI를 확장했습니다.
- 4체, 5체, 6체용 쇼케이스 프리셋과 선택 레이블을 추가했습니다.

## [0.3.5] - 2026-08-24

### Fixed
- 궤적 머리 부분의 밝은 강조 레이어가 천체를 따라 움직이며 보이던 문제를 제거했습니다.
- 연속 궤적 리본의 해상도 초기화를 보강했습니다.

## [0.3.4] - 2026-08-24

### Fixed
- 천체 뒤쪽에 있어야 할 궤적이 천체 위로 비쳐 보이지 않도록 궤적에 depth test를 적용했습니다.

## [0.3.3] - 2026-08-24

### Changed
- 항성 표면 자체의 방출광을 강화했습니다.
- 2단 additive 코로나의 크기와 불투명도를 크게 높여 항성이 확실히 빛나는 모습으로 보이도록 했습니다.

## [0.3.2] - 2026-08-24

### Changed
- O/B/A/F/G/K/M 계열 항성 색상을 더 명확하게 조정했습니다.
- 항성 표면을 방향광이 아닌 자체 발광 중심으로 셰이딩하고, 내부/외부 2단 additive 코로나를 적용했습니다.
- 궤적은 기존 NormalBlending 특성을 유지해 항성 글로우와 분리했습니다.

## [0.3.1] - 2026-08-24

### Changed
- 천체 이름을 읽기 전용으로 변경했습니다.
- 이름·질량 입력 필드 폭을 줄이고 항성 색상 선택 영역을 넓혀 초기 조건 패널을 더 촘촘하게 배치했습니다.

## [0.3.0] - 2026-08-24

### Added
- 항성 표면과 코로나를 자체 발광 천체처럼 보이게 하는 렌더링을 도입했습니다.
- 자유 색상 입력 대신 O/B/A/F/G/K/M 스펙트럼 계열 색상 스와치를 추가했습니다.

### Changed
- 임의의 비현실적 색상보다 실제 항성에 가까운 색상 범위만 선택하도록 제한했습니다.

## [0.2.0] - 2026-08-24

### Changed
- 천체를 단색 구체 대신 프로시저럴 표면 셰이딩과 원래 색상을 보존하는 글로우로 렌더링하도록 대폭 개편했습니다.
- 궤적을 시간 경과에 따라 단계적으로 사라지는 다층 구조로 개선했습니다.
- 시뮬레이션 상태와 Three.js 렌더러의 역할을 분리해 렌더링 구조를 정리했습니다.

## [0.1.20] - 2026-08-24

### Fixed
- 단일 천체 궤적을 샘플링된 곡선에서 다시 생성해 움직임과 함께 안정적으로 이어지도록 했습니다.

## [0.1.19] - 2026-08-24

### Fixed
- 단일 천체 궤적을 하나의 안정적인 선분 표현으로 정리해 깜빡이거나 겹치는 현상을 줄였습니다.

## [0.1.18] - 2026-08-24

### Changed
- 천체가 하나뿐인 경우 기본적으로 해당 천체를 자동 추적하도록 카메라 동작을 조정했습니다.

## [0.1.17] - 2026-08-24

### Fixed
- 단일 천체 궤적을 균일한 굵기의 선으로 렌더링하도록 수정했습니다.

## [0.1.16] - 2026-08-24

### Fixed
- 단일 천체 시뮬레이션에서 궤적의 굵기와 밝기가 구간마다 달라지는 문제를 줄였습니다.

## [0.1.15] - 2026-08-24

### Fixed
- 화면상의 궤적 밀도를 정규화해 카메라 거리나 샘플 수에 따라 과도하게 뭉치는 현상을 줄였습니다.
- 혜성처럼 연속적으로 이어지는 궤적 형태를 복원했습니다.

## [0.1.14] - 2026-08-24

### Fixed
- 여러 궤적 레이어가 중첩되어 지나치게 하얗게 과노출되던 문제를 수정했습니다.

## [0.1.13] - 2026-08-24

### Added
- 시뮬레이션 경과 시간을 표시하는 한국어/영어 레이블을 추가했습니다.

## [0.1.12] - 2026-08-24

### Fixed
- 궤적 중심부의 밝기가 포화되어 흰색으로 뭉개지는 현상을 줄였습니다.

## [0.1.11] - 2026-08-24

### Fixed
- 궤적 포인트의 천체 고유 색상이 밝기 포화로 사라지는 문제를 수정했습니다.

## [0.1.10] - 2026-08-24

### Changed
- 궤적 샘플링 기준을 렌더 프레임 시간이 아닌 시뮬레이션 시간으로 변경했습니다.
- 시뮬레이션 시간 기반 샘플 타입과 렌더링 경로를 추가해 배속이 달라도 궤적 밀도가 일관되도록 했습니다.

## [0.1.9] - 2026-08-24

### Changed
- 우주 배경의 별 개수와 크기를 늘려 배경이 더 분명하게 보이도록 조정했습니다.

## [0.1.8] - 2026-08-24

### Fixed
- 우주 배경 별이 지나치게 희미하게 보이던 문제를 수정했습니다.

## [0.1.7] - 2026-08-24

### Fixed
- 모바일 화면에서 우주 배경 별이 잘 보이지 않던 문제를 개선했습니다.

## [0.1.6] - 2026-08-24

### Changed
- 반복 타일 형태의 CSS 별 배경을 제거하고 무작위로 배치되는 다층 별 배경으로 교체했습니다.
- 별 배경이 시뮬레이션 UI 뒤에 안정적으로 유지되도록 레이어 구조를 정리했습니다.

## [0.1.5] - 2026-08-24

### Added
- 시뮬레이션 배경에 작은 별들로 이루어진 우주 배경을 추가했습니다.

## [0.1.4] - 2026-08-24

### Added
- 여러 천체 중 원하는 천체를 직접 선택해 카메라가 추적할 수 있는 천체별 추적 체크박스를 추가했습니다.

### Changed
- 선택된 천체를 기준으로 카메라가 자연스럽게 따라가도록 추적 동작을 연결했습니다.

## [0.1.3] - 2026-08-24

### Added
- 단일 천체를 선택적으로 따라가는 카메라 추적 기능과 자동 추적 컨트롤을 추가했습니다.
- 카메라 이동에 깊이감을 주는 패럴랙스 별 배경과 추적 관련 다국어 문구를 추가했습니다.

## [0.1.2] - 2026-08-24

### Changed
- 금방 충돌하거나 화면을 벗어나는 단발성 프리셋을 장시간 관찰 가능한 궤도 시스템으로 교체했습니다.
- 프리셋 이름을 장시간 관찰 목적과 시스템 구조에 맞게 변경했습니다.

## [0.1.1] - 2026-08-24

### Fixed
- 짧은 물리 검증에서 빠르게 붕괴하던 플라이바이·무작위 프리셋의 초기 위치와 속도를 재조정해 안정성을 높였습니다.

## [0.1.0] - 2026-08-23

### Added
- React, TypeScript, Vite, Three.js 기반 3 Body Problem 시뮬레이터 프로젝트를 시작했습니다.
- 벡터 연산과 중력 시뮬레이션 기반, 기본 3체 초기 조건 프리셋과 Three.js 시뮬레이션 렌더러를 추가했습니다.
- 시뮬레이션 시작/정지·초기 조건 편집을 위한 제어 패널과 반응형 UI를 추가했습니다.
- GitHub Pages 자동 배포 워크플로를 추가했습니다.
- 한국어/영어 UI 번역과 한국어 기본 언어 선택 기능을 추가했습니다.
- 모바일에서 접을 수 있는 제어 패널과 시간 기반 궤적 표시/유지시간 설정을 추가했습니다.
- 1체·2체·3체 프리셋 선택, 천체 수 필터, 다양한 초기 궤도 프리셋을 추가했습니다.
- 앱 제목 옆에 버전을 표시하고 Semantic Versioning용 스크립트와 `VERSIONING.md` 정책을 추가했습니다.