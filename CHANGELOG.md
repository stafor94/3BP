Warning: truncated output (original token count: 37798)
Total output lines: 1779

# Changelog

## [0.24.19] - 2026-09-06

### Fixed
- Smoothed the stellar disk-to-glow transition with a Gaussian immediate-light shoulder while preserving white cores, temperature halos, and faint surface variation.
- Added production comparisons against v0.24.18 alongside the unchanged photographic-light acceptance against the original reference baseline.

## [0.24.18] - 2026-09-06

### Fixed
- Replaced surface-detail stellar rendering with a nearly white photographic HDR core, feathered luminous edge, and a broad temperature-tinted diffuse halo in the existing single corona draw.
- Removed gameplay granulation amplification; enlarged surfaces retain only minute low-frequency brightness variation.
- Replaced contradictory surface-detail/compact-halo acceptance with paired production mobile light-profile, color, noise, and continuous-zoom checks against the pre-change main.


3BP의 사용자에게 보이는 기능 변경, 물리/렌더링 동작 변경, 버그 수정, 성능 개선을 버전별로 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/)의 원칙을 참고하고, 버전 번호는 [Semantic Versioning](https://semver.org/) 및 `VERSIONING.md` 정책을 따릅니다.

> `v0.1.0`부터의 Git 커밋 기록과 `package.json` 버전 전환을 역추적해 복원한 변경 이력입니다. 임시/no-op 커밋과 배포 트리거처럼 사용자 동작에 영향을 주지 않는 내부 작업은 제외했습니다.

## [0.24.17] - 2026-09-04

### Changed
- photosphere의 primary/mid-scale value-noise 주파수와 screen-space LOD, 대류·플라즈마 진폭을 조정해 모바일 일반 확대에서도 매끈한 단색 원반 대신 은은하고 분명한 비세포성 표면 구조가 남도록 했습니다.
- 광구 limb의 emission 바닥값과 detail envelope를 높이고 edge coverage 전이를 실제 실루엣 가까이로 좁혀 검은 외곽선 없이 표면이 짧은 corona fringe로 이어지도록 했습니다.
- 최근 확대했던 corona Sprite scale/opacity와 diffuse tail을 축소해 halo가 photosphere보다 먼저 보이지 않도록 되돌렸습니다.

### Verification
- production 모바일 회귀 기준에서 normal 크기의 0 contrast 허용을 제거하고, flat smooth disk, large diffuse halo, dark outline, neon ring을 명시적인 실패 결과로 다루도록 surface/corona/radial 계약을 강화했습니다.
- Voronoi/벌집형 연결 암부, 과도한 고주파 노이즈와 local pit을 거부하는 기존 topology-free 검증은 유지합니다.

## [0.24.16] - 2026-09-04

### Fixed
- production tracking/collision-watch 렌더 경로에서 corona Sprite의 실제 scale과 opacity를 함께 확대해, 외곽 발광이 photosphere 반경의 약 0.5배 안에서 사라지던 문제를 수정했습니다.
- corona의 near-limb shoulder와 diffuse outer lobe를 넓히고 외곽 감쇠를 늦춰 주변 공간까지 이어지는 발광을 강화하되, 비대칭 warp와 Sprite 가장자리의 부드러운 소거로 균일한 거대 halo, neon ring, starburst 형태를 피했습니다.

### Verification
- 항성 렌더링 회귀 검증에 실제 Sprite scale/opacity 범위와 diffuse glow carrier가 photosphere 반경의 2배 이상까지 확보되는 화면상 반경 계약을 추가했습니다.

### Unchanged
- photosphere shader, 표면 색상, center-to-limb 응답, 그라뉼레이션, 항성 물리 상태와 카메라 framing은 변경하지 않습니다.

## [0.24.15] - 2026-09-04

### Fixed
- 항성 표면은 그대로 유지하면서 compact corona의 near-limb shoulder 에너지와 짧게 감쇠하는 diffuse outer glow 가시성을 높여, 모바일 normal/enlarged 구도에서 항성이 단순한 밝은 구가 아니라 스스로 빛나는 천체로 읽히도록 조정했습니다.
- outer glow는 Sprite 가장자리 전에 더 일찍 감쇠하도록 제한해 발광감 증가가 독립된 원형 haze, gray/neon ring 또는 giant halo로 이어지지 않게 했습니다.

### Verification
- 항성 렌더링 회귀 검증에 넓은 near-limb shoulder, 증가한 near/diffuse 발광 에너지, Sprite 가장자리 이전 감쇠 계약을 추가했습니다.
- production mobile Helios 8 M☉ tracking 경로의 normal/enlarged 동일 조건 A/B 캡처를 위한 기존 전용 회귀 경로를 유지합니다.

### Unchanged
- photosphere shader와 granulation/limb/temperature profile, 카메라·줌·충돌 물리·타임스케일·배경, planet/moon/fragment 렌더링은 변경하지 않습니다.

## [0.24.14] - 2026-09-04

### Changed
- 자동 충돌 관찰 카메라의 주 천체 목표 화면 반경을 화면 너비의 `1/9`에서 `1/18`로 낮춰, 관찰 중 천체의 화면상 크기를 기존의 약 50%로 축소했습니다.

### Verification
- collision camera framing regression에서 일반 추적의 `1/20` 목표는 유지하고, 충돌 관찰은 정확히 `1/18`을 사용해 기존 `1/9` 대비 절반 크기로 투영되는지 검증합니다.

### Unchanged
- 충돌 관찰의 대상 선택·시점 방향·카메라 handoff/수렴 허용오차, 충돌 물리·배속·렌더링·VFX·정보 패널은 변경하지 않습니다.

## [0.24.13] - 2026-09-04

### Changed
- 자동 충돌 관찰의 접근·충돌·충돌 후 관리 배속을 모두 `0.1×`로 통일해 충돌 직전과 직후에 `0.03×` 또는 `0.08×`까지 과도하게 느려지지 않도록 했습니다.

### Verification
- collision watch timing regression에서 approach/impact/post-impact 자동 관리 배속이 모두 `0.1×` 이상이며 현재 정책값이 정확히 `0.1×`로 유지되는지 검증합니다.

### Unchanged
- 충돌 관찰 phase별 hold/ramp 시간, 사용자 수동 배속 우선권, 카메라/정보 패널 유지 시간, 충돌 물리·렌더링·VFX는 변경하지 않습니다.

## [0.24.12] - 2026-09-04

### Changed
- 실제 production `App`/`SimulationView`와 모바일 UI, `BodyTrackingRail`, OrbitControls wheel zoom을 그대로 사용하는 항성 Pass 5 통합 검증 경로를 추가하고 0.35/1/8 M☉ 항성을 normal/enlarged/extreme 화면 크기에서 검증하도록 했습니다.
- topology-free photosphere 구조는 유지하면서 primary/secondary granulation의 screen-space LOD가 확대 구도에서 더 일찍 해상되도록 조정하고, 최종 detail strength를 기존 회귀 여유를 보존하는 범위로 제한했습니다.
- 8 M☉ blue-white 항성의 확대 구도에서 매끈한 밝은 구체처럼 보이던 문제를 완화하면서 center-to-limb emission, compact corona, temperature hue와 fine-detail anti-aliasing 경로는 유지합니다.

### Verification
- mobile 390×844 production renderer에서 0.35/1/8 M☉ × normal/enlarged/extreme 3×3 캡처와 8 M☉ continuous zoom sweep을 추가하고 실제 UI PNG 및 확대 캡처를 acceptance evidence로 남깁니다.
- 기존 Pass 1 topology removal, Pass 2 multi-scale surface, Pass 3 radial emission/screen-space LOD, Pass 4 limb/corona, HDR/temperature regression을 함께 실행합니다.
- Pass 4 corona 검증은 corona의 절대 밝기·extent·decay·edge/rebound·luminance response 기준을 그대로 유지하되, Pass 5에서 의도적으로 변경 가능한 photosphere LOD를 Pass 3와 동일 contrast로 강제하던 오래된 invariant만 현재 topology/detail envelope로 대체합니다.

### Unchanged
- preset, 질량/반지름/궤도/속도/timestep, collision 판정·결과/VFX, planet/moon/fragment 렌더링, `starColors.ts`, global ACES tone mapping/exposure, stellar corona shader/scale/opacity는 변경하지 않습니다.

## [0.24.11] - 2026-09-03

### Changed
- 항성 photosphere의 로컬 `toneMapStellarHuePreserving()` 압축과 tone mapping 이후 `stellarSurfaceModulation` 보정을 제거하고, 평균 emission과 cellular granulation contrast를 linear/HDR 단계에서 분리해 한 번만 결합한 뒤 기존 renderer ACES tone mapping에 맡기도록 정리했습니다.
- photosphere 평균 luminance는 기존 `stellarRenderProfile.photosphereIntensity` 계약을 유지하고, granule/lane 편차는 별도의 bounded linear surface variation으로 적용해 항성 전체 밝기를 올리지 않아도 표면 구조가 남도록 조정했습니다.
- white-hot 보정은 고정 SDR peak를 만드는 대신 현재 HDR peak를 사용하고 중심 exponent를 14에서 18로 좁혀, 높은 밝기에서도 temperature hue가 원반 전체에서 유지되고 중심의 제한된 영역만 약하게 백색화되도록 했습니다.
- Pass 2 cellular granulation, Pass 3 derivative LOD, Pass 4 limb/edge coverage와 Pass 5 compact corona 구조 및 scale/opacity는 그대로 유지합니다.

### Performance
- stellar photosphere의 기존 draw call과 uniform 수를 유지하며 새 texture, geometry, sprite, material, draw call 또는 per-frame CPU allocation을 추가하지 않습니다.
- Pass 5의 항성당 `photosphere sphere 1 + compact corona Sprite 1` 구조를 그대로 유지합니다.

### Verification
- stellar rendering regression에 local pre-tone-map compressor 제거, post-tone-map RGB modulation 제거, linear/HDR contrast 결합, 단일 Three.js tone-mapping chunk, 제한된 white-hot core 및 global ACES/exposure 1 불변 계약을 추가했습니다.
- mobile 390×844 전용 deterministic fixture에서 같은 화면 크기의 cool/orange(0.35 M☉), solar-like(1 M☉), hot/blue-white(8 M☉) 항성을 일반 거리와 확대 거리로 렌더링하고 Pass 5 main(`fe1d138`)과 luminance, local surface contrast, hue/chroma, white-blob fraction, photosphere footprint를 A/B 비교합니다.

### Unchanged
- global renderer `ACESFilmicToneMapping`/exposure 1, `starColors.ts`, Pass 2~5 topology·LOD·limb·corona, presets/evolution physics, mass/radius/orbit/velocity/timestep/collision, planet/moon/fragment/background/collision VFX는 변경하지 않습니다.

## [0.24.10] - 2026-09-03

### Changed
- 기존 항성당 `inner glow + outer glow` Sprite 2장 구조를 단일 compact corona 경로로 교체했습니다. 기존 inner Sprite 하나만 corona carrier로 재사용하고 outer Sprite는 항성 렌더 직전에 비활성화해 두 겹의 큰 동심원 blur를 제거합니다.
- 새 stellar corona shader가 Sprite UV에서 photosphere 경계를 직접 계산해 바로 바깥에는 얇고 비교적 강한 near-limb glow를 만들고, 그 밖에는 지수적으로 빠르게 감쇠하는 희미한 corona만 남깁니다. 기존 radial glow texture의 alpha 분포는 항성 halo 형상을 더 이상 결정하지 않습니다.
- 항성 seed와 매우 느린 time phase로 corona 반경/밝기에 작은 angular variation을 주어 외곽이 완전한 동심원으로 읽히지 않게 하되 flare·ray·prominence처럼 보이는 방향성 효과는 추가하지 않습니다.
- corona 색은 기존 temperature-derived stellar color를 그대로 사용하고, photosphere에서 충분히 떨어진 희미한 outer tail에서만 최대 약 3% 수준으로 약하게 desaturate합니다.
- `stellarRenderProfile`의 기존 3.65–4.5× inner / 7.1–8.85× outer glow scale을 약 2.72–2.96×의 단일 corona carrier로 축소해 photosphere가 화면의 주 피사체로 유지되도록 했습니다.

### Performance
- 항성의 정상 렌더 draw 구조를 `photosphere sphere 1 + inner glow Sprite 1 + outer glow Sprite 1`에서 `photosphere sphere 1 + compact corona Sprite 1`로 줄여 항성당 draw call을 3개에서 2개로 감소시킵니다.
- shared `VisualBody`의 기존 Sprite 객체는 non-stellar 경로 호환을 위해 그대로 재사용하지만 stellar outer Sprite는 `visible=false`로 제출하지 않습니다. 새 texture, geometry, sprite 또는 per-frame material/object 생성은 추가하지 않습니다.

### Verification
- stellar rendering regression에 단일 corona carrier, outer Sprite 비활성화, compact scale/opacity, 빠른 radial falloff, seed/slow-time asymmetry, temperature-color 유지 및 Pass 2/3/4 shader 계약 보존을 추가했습니다.
- mobile 390×844에서 Pass 4 merge(`93bb0d4`)와 일반 거리/확대 거리를 동일 seed·동일 harness로 A/B 캡처해 halo extent, halo/core luminance, corona boundary variation, edge luminance, temperature hue, granulation contrast와 Pass 4 edge transition을 비교합니다.

### Unchanged
- Pass 2 cellular granulation, Pass 3 screen-space LOD, Pass 4 limb/silhouette shader, HDR/tone mapping, `starColors.ts`, presets/evolution physics, mass/radius/orbit/velocity/timestep/collision, planet/moon/fragment/background/collision VFX는 변경하지 않습니다.

## [0.24.9] - 2026-09-03

### Changed
- 항성 photosphere의 단순 `limbDarkening * centerEmission`과 전체 Fresnel rim을 연속적인 view-angle 기반 limb 곡선으로 교체해 중앙에서 가장자리까지 밝기 전환을 완만하게 만들고, 실루엣 직전에도 충분한 발광 floor를 유지해 회색/검은 테두리가 생기지 않도록 했습니다.
- 기존 `drawStellarRim()`을 제거하고 실루엣 바로 안쪽에서만 올라왔다가 정확한 경계에서는 다시 사라지는 좁은 emissive fringe로 축소해 두꺼운 ring 없이 photosphere 가장자리를 빛에 묻히게 했습니다.
- `fwidth(viewMu)`로 화면상의 마지막 limb 폭을 계산하고 stellar material에 MSAA alpha-to-coverage를 적용해 물리 반지름과 sphere geometry를 바꾸지 않은 채 기존 draw call 내부에서 hard silhouette를 약 1–2px 수준으로 feather 처리합니다.
- Pass 2/3의 cellular granulation, intergranular lane, convection modulation, screen-space LOD와 temperature-color/hue-preserving 경로는 그대로 유지합니다.

### Performance
- 기존 stellar sphere 1 draw call과 inner/outer glow Sprite 수를 유지합니다. 새 geometry, texture, material, sprite, per-frame allocation 또는 CPU screen-radius 계산을 추가하지 않습니다.
- 추가 비용은 view-angle 기반 `pow`/`smoothstep`, 한 번의 `fwidth(viewMu)`와 MSAA alpha-to-coverage 상태뿐이며 cellular 3×3×3 neighborhood sample 횟수는 증가하지 않습니다.

### Verification
- stellar rendering regression에 밝은 limb floor, legacy full Fresnel rim 제거, thin fringe의 silhouette falloff, derivative 기반 edge coverage와 alpha-to-coverage material 계약을 추가하면서 Pass 2/3 granulation/LOD 계약을 그대로 유지합니다.
- mobile 390×844에서 Pass 3 merge(`284d113`)와 일반 거리/확대 거리를 A/B 캡처해 hard-edge gradient, edge transition, bright photosphere radius, halo extent, limb 밝기, temperature hue와 granulation contrast를 비교합니다.

### Unchanged
- 기존 inner/outer glow Sprite와 corona 구조, HDR/tone mapping, `starColors.ts`, presets/evolution physics, mass/radius/orbit/velocity/timestep/collision, planet/moon/fragment/background/collision VFX는 변경하지 않습니다.

## [0.24.8] - 2026-09-03

### Changed
- 항성 photosphere의 Pass 2 cellular topology는 유지하면서 `fwidth(objectNormal)`에서 계산한 screen-space footprint를 기준으로 fine breakup → intergranular lane → primary granule 순서가 연속적으로 약해지는 LOD를 추가했습니다. world distance나 CPU 계산 화면 반지름에 의존하지 않아 확대/축소와 viewport 변화에 직접 대응합니다.
- primary granule이 픽셀 이하로 작아지기 전에 fine breakup과 얇은 lane을 먼저 감쇠하고, broad convection에는 비제로 detail floor를 남겨 작은 항성도 완전히 매끈한 발광 구체로 돌아가지 않도록 했습니다.
- Pass 2의 `F2-F1` intergranular boundary는 그대로 사용하되 `fwidth(boundaryDistance)`로 lane edge feather 폭을 넓히고 별도의 derivative 기반 lane LOD를 적용해 작은 화면에서 검은 점·깨진 선·cracked/honeycomb shimmer로 변하는 현상을 줄였습니다.
- 기존 좌표 자체를 시간에 따라 이동시키던 convection/fine wobble을 제거하고, 고정된 topology 위에서 broad convection·granule thermal pulse·fine breakup의 진폭만 서로 다른 매우 느린 주기로 변화하도록 변경해 표면 전체가 미끄러지는 texture처럼 보이지 않게 했습니다.

### Performance
- Pass 2와 동일하게 stellar sphere 1 draw call, cellular 3×3×3 neighborhood search 1회, broad/fine value-noise 각 1회를 유지합니다. 새 texture, geometry, sprite, material 재생성, per-frame CPU allocation 및 screen-size uniform은 추가하지 않습니다.
- LOD와 lane anti-aliasing은 fragment derivative와 소수의 `smoothstep` 연산만 추가하며 cellular neighborhood search 횟수는 증가하지 않습니다.

### Verification
- stellar rendering regression에 derivative footprint, feature별 LOD 순서, lane anti-aliasing, nonzero convection floor, 단일 cellular sample, world-distance uniform 부재 및 non-sliding slow time evolution 계약을 추가했습니다.
- mobile 390×844에서 Pass 2 merge(`901b2dd`)와 큰 확대/일반 게임 거리/작은 화면 크기를 A/B 캡처하고, brightness·bright footprint·temperature hue 안정성, high-frequency/lane 감소, low-frequency 구조 유지와 연속 zoom sweep의 고주파 spike를 검증합니다.

### Unchanged
- `starColors.ts` temperature mapping, stellar preset/evolution physics, mass/radius/orbit/velocity/timestep, collision 판정·결과, planet/moon/fragment/background/collision VFX, 기존 limb/chromosphere/hard silhouette, inner/outer glow·corona 및 HDR/tone-mapping 구조는 변경하지 않습니다.

## [0.24.7] - 2026-09-03

### Changed
- 항성 전용 photosphere의 기존 smooth multi-scale value-noise 표면을 3D cellular granulation으로 교체해 밝은 granule cell과 더 어두운 intergranular network가 구조적으로 구분되도록 했습니다.
- nearest/second-nearest cellular distance 차이로 얇고 불규칙한 lane을 만들고, cell별 deterministic jitter/thermal bias로 규칙적인 벌집 형태와 모든 항성의 동일 패턴을 피합니다.
- 낮은 대비의 large convection modulation과 미세한 fine breakup을 primary cellular topology에 종속시켜 cloudy gas/rock texture처럼 읽히지 않도록 했습니다.
- granulation frequency 상수를 stellar shader 내부에 집중시켜 Pass 3의 screen-space LOD/fwidth 작업에서 generic body shader를 수정하지 않고 확장할 수 있게 했습니다.

### Performance
- 기존 star sphere 1 draw call을 유지하며 새 texture, CanvasTexture, geometry, sprite 또는 per-frame CPU surface 생성은 추가하지 않습니다.
- cellular field는 고정 3x3x3 neighborhood만 검색하고 large/fine value-noise octave를 각각 1회만 사용합니다.

### Verification
- stellar rendering regression에서 dedicated stellar path, cellular field, primary granule, intergranular lane, large convection, deterministic seed, temperature-color 경로와 generic body shader 격리를 검증합니다.
- mobile 390×844의 Pass 1 main 대비 A/B에서 local contrast뿐 아니라 high-frequency structure, lane-like local minima, mean brightness, bright footprint와 hue stability를 함께 검증합니다.

### Unchanged
- starColors.ts와 temperature mapping, stellar preset/evolution physics, mass/radius/orbit/velocity/timestep, collision classification/outcome, planet/moon/fragment/trail/collision VFX/background 및 기존 limb/glow/corona 구조는 변경하지 않습니다.
- screen-space granulation LOD, fwidth, zoom-adaptive detail, chromosphere, emissive fringe, sunspot 및 HDR/corona 재설계는 이번 Pass 범위에 포함하지 않습니다.

## [0.24.6] - 2026-09-02

### Changed
- 항성 photosphere를 generic planet/moon/fragment body shader의 `uSelfLuminous` 분기에서 분리해 `src/rendering/stellarPhotosphereMaterial.ts` 전용 shader/material 경로로 이동했습니다.
- 항성 전용 granulation, emission, limb darkening, white-hot/hue-preserving 처리와 `uTime` 등 uniform을 새 모듈에서 관리하고, `bodyLighting.ts`는 generic non-stellar shader와 공통 body/light/glow 연결을 담당하도록 정리했습니다.
- stellar color, luminosity, surface temperature, render profile, animation time, evolution phase, collision transient heat를 `StellarPhotosphereFrame` 및 `updateStellarPhotosphereMaterial()` 계약으로 모아 후속 stellar rendering Pass에서 generic shader를 건드리지 않고 photosphere를 교체할 수 있는 기반을 마련했습니다.
- 기존 inner/outer glow Sprite와 luminosity 기반 glow scale/opacity 구조는 유지합니다.

### Performance
- star/non-star는 서로 다른 shader program을 사용하지만 기존 sphere mesh 및 inner/outer glow Sprite 수를 유지하며, material은 재사용하고 resolved body type이 실제로 바뀌는 경우에만 shader program을 전환합니다.
- 새 texture, geometry, particle, sprite 또는 draw call을 추가하지 않습니다.

### Verification
- stellar rendering regression에 dedicated stellar/generic shader 경로, stellar-only uniform 격리, non-stellar `uTime` 부재와 기존 planet/moon/fragment path 보존 검증을 추가했습니다.
- main v0.24.5 (`75532efafa4aec499b902d9c6113b4bdc002d213`)와 mobile 390×844 A/B를 수행해 구조 분리 전후의 photosphere/halo 시각 출력이 사실상 동일하게 유지되는지 검증합니다.

### Unchanged
- 이번 버전은 visual overhaul이 아니며 기존 항성 temperature color, photosphere brightness/granulation/limb/white-hot/glow 외형을 의도적으로 유지합니다.
- planet/moon/fragment 외형, 질량·반지름·궤도·속도·timestep·collision 판정/결과, preset, `starColors.ts` temperature 정책, stellar evolution 물리, collision VFX/remnant, trail 및 space background는 변경하지 않습니다.

## [0.24.5] - 2026-09-02

### Changed
- 항성 photosphere를 단일한 밝은 구체처럼 보이게 하던 정적 표면 표현을 large convection cell, fine granule, micro breakup의 3단 procedural granulation으로 분리했습니다.
- 항성 전용 `uTime`을 사용해 broad convection과 작은 granule이 서로 다른 방향으로 매우 느리게 drift하도록 해 rigid texture rotation 없이 살아 있는 플라즈마 표면처럼 보이도록 했습니다.
- 항성 limb darkening을 강화하고 rim 발광을 낮춰 원형 흰 테두리보다 중심부의 자체 발광과 가장자리 감쇠가 먼저 읽히도록 조정했습니다.
- 기존 inner/outer glow sprite와 texture 수는 유지하면서 shader 단계에서 inner glow의 중심 발광을 소폭 보강하고 outer corona에 낮은 진폭의 deterministic angular asymmetry를 추가해 단순한 원형 radial blur 인상을 줄였습니다.
- 밝은 photosphere의 granulation이 최종 tone mapping에서 사라지지 않도록 tone mapping 직후 항성 RGB에만 동일 비율의 최대 ±5.5% bounded surface modulation을 적용해 기존 온도색을 보존하면서 모바일 픽셀에서도 표면 구조가 남도록 했습니다.

### Performance
- 새 texture, geometry, sprite, particle 또는 draw call을 추가하지 않습니다. photosphere는 기존 body shader의 procedural noise를 사용하고 corona는 기존 두 glow sprite material의 shader customization만 사용합니다.
- planet/moon/fragment는 기존 non-stellar surface detail 및 lighting path를 그대로 사용하며 항성 전용 time/modulation 계산을 적용하지 않습니다.

### Verification
- stellar rendering regression에 3-scale granulation, 독립 slow drift, stronger limb darkening, post-tone-map bounded modulation, shader-based inner/outer corona와 non-stellar path 격리 계약을 추가했습니다.
- main v0.24.4 (`ca5568cd7f6bac13f63680c45593e0c24913cc96`)와 동일한 두 main-sequence star 장면을 mobile 390×844에서 A/B 캡처하고 bright footprint, very-bright footprint, 평균 밝기와 local photosphere contrast를 검증합니다.

### Unchanged
- preset, `starColors.ts`의 temperature 기반 항성 색상, 질량·반지름·궤도·solver·collision 판정, collision VFX/remnant, planet/moon/fragment 시각 경로, camera/trail/UI 및 v0.24.4 dense temperature-diverse starfield background는 변경하지 않습니다.

## [0.24.4] - 2026-09-02

### Changed
- v0.24.3의 20,000개 background + 1,000개 foreground dense starfield를 그대로 유지하면서 star vertex color를 `neutral`, `blue-white`, `warm-white`, `pale-yellow`, `soft-orange`, `red-orange`의 6개 저채도 temperature class로 확장했습니다.
- 기존 brightness sampling exponent 2.60을 이용해 faint/medium/bright 구간별 color weight를 다르게 적용합니다. 전체 기대 분포는 약 neutral 58.8%, blue-white 19.5%, warm-white 13.6%, pale-yellow 5.2%, soft-orange 2.4%, red-orange 0.6%입니다.
- 작은 background star는 tint를 억제하고 밝고 큰 star일수록 온도 차이를 더 읽을 수 있게 하되, 동일 color sample이 v0.24.3에서 가졌던 display-space luminance를 보존하도록 정규화해 색상 추가 때문에 모바일 체감 밀도가 낮아지지 않도록 했습니다.
- 색상 선택은 기존 brightness 뒤 RNG draw 1회를 그대로 사용하며 picker 내부에 추가 random 호출을 만들지 않아 위치·밝기 random sequence를 변경하지 않습니다.

### Verification
- space background regression에 6개 temperature class, brightness별 weight, low-saturation palette, brightness/size tint 연계, no-extra-RNG 및 v0.24.3 per-star display luminance 보존 계약을 추가했습니다.
- mobile 390×844 / desktop 1280×800의 5개 viewpoint에서 v0.24.3과 A/B 캡처하고 near-black·low/mid·mean luminance·bright fraction 회귀 gate를 적용합니다.

### Unchanged
- dense/fine background count 10,000/10,000, foreground 1,000, 각 layer의 size/opacity/min/max brightness, shared 24×24 point texture, sky base RGB 5/7/13, Milky Way/haze/distant galaxy, foreground 천체, physics/solver/collision, camera, trails, VFX, UI/controls는 변경하지 않습니다.

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
- space texture와 galaxy texture 해상도는 각각 512×256 / 64×64로 유지하고, per-frame procedural noise·allocation·twinkle·raymarch·volumetric effect를 추가하지 않습니다.

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
- frame loop의 추가 작업은 galaxy group의 camera position copy뿐이며 per-frame allocation, procedural noise animation, raymarch, volumetric effect를 추가하지 않습니다.

### Unchanged
- physics/solver/collision, mass/radius/velocity/trajectory, celestial body shader, collision/destruction VF…17798 tokens truncated… 반지름에서 투영 반지름이 화면 너비의 1/20에 맞는지 검증하는 perspective camera 수학 회귀 테스트를 추가했습니다.
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
- 항성-항성 `merge` 충돌의 접촉 연출 시간을 0.045에서 0.06 시뮬레이션초로 늘려 `0.03×` 충돌 관찰에서 약 2초 동안 흡수 과정을 보여주도록 했습니다.
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
- 프리셋 명칭을 실제 시스템 구조와 관찰 특성에 맞게 정리했습니다.

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

