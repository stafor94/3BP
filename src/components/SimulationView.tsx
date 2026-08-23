import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { BodyState } from '../types'

type Props = {
  bodies: BodyState[]
  trailVersion: number
  trailEnabled: boolean
  trailDuration: number
}

type TrailPoint = {
  position: THREE.Vector3
  capturedAt: number
}

type VisualBody = {
  mesh: THREE.Mesh
  light: THREE.PointLight
  trailPoints: THREE.Points
  trailGeometry: THREE.BufferGeometry
  trailMaterial: THREE.ShaderMaterial
  trailPositions: Float32Array
  trailAlphas: Float32Array
  trailSizes: Float32Array
  trailGlow: Line2
  trailGlowMaterial: LineMaterial
  trailCore: Line2
  trailCoreGeometry: LineGeometry
  trailCoreMaterial: LineMaterial
  points: TrailPoint[]
}

const MAX_TRAIL_POINTS = 3600
const TRAIL_CAPTURE_INTERVAL = 16

const trailVertexShader = `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const trailFragmentShader = `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float radius = length(centered) * 2.0;
    if (radius > 1.0) discard;

    float halo = exp(-3.2 * radius * radius);
    float core = exp(-18.0 * radius * radius);
    float edge = 1.0 - smoothstep(0.72, 1.0, radius);
    float alpha = vAlpha * (0.46 * halo + 0.76 * core) * edge;

    gl_FragColor = vec4(uColor, alpha);
  }
`

export function SimulationView({ bodies, trailVersion, trailEnabled, trailDuration }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const latestBodies = useRef(bodies)
  const latestTrailVersion = useRef(trailVersion)
  const latestTrailEnabled = useRef(trailEnabled)
  const latestTrailDuration = useRef(trailDuration)

  latestBodies.current = bodies
  latestTrailVersion.current = trailVersion
  latestTrailEnabled.current = trailEnabled
  latestTrailDuration.current = trailDuration

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#03050a')
    scene.fog = new THREE.FogExp2('#03050a', 0.018)

    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 200)
    camera.position.set(0, 2.8, 5.4)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    host.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.055
    controls.minDistance = 1.2
    controls.maxDistance = 30

    scene.add(new THREE.AmbientLight('#6688aa', 0.32))

    const starsGeometry = new THREE.BufferGeometry()
    const starPositions = new Float32Array(1200 * 3)
    for (let i = 0; i < starPositions.length; i += 3) {
      const radius = 18 + Math.random() * 48
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      starPositions[i] = radius * Math.sin(phi) * Math.cos(theta)
      starPositions[i + 1] = radius * Math.sin(phi) * Math.sin(theta)
      starPositions[i + 2] = radius * Math.cos(phi)
    }
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const stars = new THREE.Points(
      starsGeometry,
      new THREE.PointsMaterial({ color: '#8da4c7', size: 0.045, transparent: true, opacity: 0.48 }),
    )
    scene.add(stars)

    const visuals = new Map<string, VisualBody>()
    let observedTrailVersion = latestTrailVersion.current
    let observedTrailEnabled = latestTrailEnabled.current

    const clearTrail = (visual: VisualBody) => {
      visual.points = []
      visual.trailGeometry.setDrawRange(0, 0)
      visual.trailPoints.visible = false
      visual.trailGlow.visible = false
      visual.trailCore.visible = false
    }

    const removeVisual = (id: string) => {
      const visual = visuals.get(id)
      if (!visual) return
      scene.remove(visual.mesh, visual.light, visual.trailPoints, visual.trailGlow, visual.trailCore)
      visual.mesh.geometry.dispose()
      ;(visual.mesh.material as THREE.Material).dispose()
      visual.trailGeometry.dispose()
      visual.trailMaterial.dispose()
      visual.trailCoreGeometry.dispose()
      visual.trailGlowMaterial.dispose()
      visual.trailCoreMaterial.dispose()
      visuals.delete(id)
    }

    const ensureVisual = (body: BodyState) => {
      if (visuals.has(body.id)) return visuals.get(body.id)!

      const geometry = new THREE.SphereGeometry(1, 32, 24)
      const material = new THREE.MeshStandardMaterial({
        color: body.color,
        emissive: body.color,
        emissiveIntensity: 2.2,
        roughness: 0.65,
      })
      const mesh = new THREE.Mesh(geometry, material)
      const light = new THREE.PointLight(body.color, 8, 8, 1.8)

      const trailPositions = new Float32Array(MAX_TRAIL_POINTS * 3)
      const trailAlphas = new Float32Array(MAX_TRAIL_POINTS)
      const trailSizes = new Float32Array(MAX_TRAIL_POINTS)
      const trailGeometry = new THREE.BufferGeometry()
      trailGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage),
      )
      trailGeometry.setAttribute(
        'aAlpha',
        new THREE.BufferAttribute(trailAlphas, 1).setUsage(THREE.DynamicDrawUsage),
      )
      trailGeometry.setAttribute(
        'aSize',
        new THREE.BufferAttribute(trailSizes, 1).setUsage(THREE.DynamicDrawUsage),
      )
      trailGeometry.setDrawRange(0, 0)

      const trailMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(body.color) },
        },
        vertexShader: trailVertexShader,
        fragmentShader: trailFragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      const trailPoints = new THREE.Points(trailGeometry, trailMaterial)
      trailPoints.visible = false
      trailPoints.frustumCulled = false
      trailPoints.renderOrder = 29

      const trailCoreGeometry = new LineGeometry()
      trailCoreGeometry.setPositions([0, 0, 0, 0, 0, 0])

      const trailGlowMaterial = new LineMaterial({
        color: new THREE.Color(body.color).getHex(),
        linewidth: 6.2,
        transparent: true,
        opacity: 0.09,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      trailGlowMaterial.resolution.set(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1))
      const trailGlow = new Line2(trailCoreGeometry, trailGlowMaterial)
      trailGlow.visible = false
      trailGlow.frustumCulled = false
      trailGlow.renderOrder = 30

      const trailCoreMaterial = new LineMaterial({
        color: new THREE.Color(body.color).getHex(),
        linewidth: 2.6,
        transparent: true,
        opacity: 0.34,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      trailCoreMaterial.resolution.set(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1))
      const trailCore = new Line2(trailCoreGeometry, trailCoreMaterial)
      trailCore.visible = false
      trailCore.frustumCulled = false
      trailCore.renderOrder = 31

      scene.add(trailPoints, trailGlow, trailCore, mesh, light)
      const created: VisualBody = {
        mesh,
        light,
        trailPoints,
        trailGeometry,
        trailMaterial,
        trailPositions,
        trailAlphas,
        trailSizes,
        trailGlow,
        trailGlowMaterial,
        trailCore,
        trailCoreGeometry,
        trailCoreMaterial,
        points: [],
      }
      visuals.set(body.id, created)
      return created
    }

    const updateTrailVisual = (visual: VisualBody, now: number, durationMs: number) => {
      const count = visual.points.length
      if (count === 0) {
        visual.trailGeometry.setDrawRange(0, 0)
        visual.trailPoints.visible = false
        visual.trailGlow.visible = false
        visual.trailCore.visible = false
        return
      }

      const positionAttribute = visual.trailGeometry.getAttribute('position') as THREE.BufferAttribute
      const alphaAttribute = visual.trailGeometry.getAttribute('aAlpha') as THREE.BufferAttribute
      const sizeAttribute = visual.trailGeometry.getAttribute('aSize') as THREE.BufferAttribute

      for (let index = 0; index < count; index += 1) {
        const point = visual.points[index]
        const offset = index * 3
        visual.trailPositions[offset] = point.position.x
        visual.trailPositions[offset + 1] = point.position.y
        visual.trailPositions[offset + 2] = point.position.z

        const ageRatio = THREE.MathUtils.clamp((now - point.capturedAt) / durationMs, 0, 1)
        const freshness = 1 - ageRatio
        const fade = Math.pow(freshness, 1.8)
        visual.trailAlphas[index] = fade * 0.82
        visual.trailSizes[index] = 4.5 + 17.5 * Math.pow(freshness, 1.7)
      }

      positionAttribute.needsUpdate = true
      alphaAttribute.needsUpdate = true
      sizeAttribute.needsUpdate = true
      visual.trailGeometry.setDrawRange(0, count)
      visual.trailPoints.visible = latestTrailEnabled.current

      const coreCutoff = now - Math.min(durationMs * 0.36, 2600)
      const recentPoints = visual.points.filter((point) => point.capturedAt >= coreCutoff)
      const curvePoints: THREE.Vector3[] = []
      recentPoints.forEach((point) => {
        const previous = curvePoints[curvePoints.length - 1]
        if (!previous || previous.distanceToSquared(point.position) > 1e-8) {
          curvePoints.push(point.position.clone())
        }
      })

      if (curvePoints.length >= 2) {
        let smoothPoints = curvePoints
        if (curvePoints.length >= 3) {
          const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'centripetal')
          const segments = Math.min(480, Math.max(curvePoints.length * 3, 24))
          smoothPoints = curve.getPoints(segments)
        }

        const positions = new Array<number>(smoothPoints.length * 3)
        smoothPoints.forEach((point, index) => {
          const offset = index * 3
          positions[offset] = point.x
          positions[offset + 1] = point.y
          positions[offset + 2] = point.z
        })
        visual.trailCoreGeometry.setPositions(positions)
        visual.trailGlow.visible = latestTrailEnabled.current
        visual.trailCore.visible = latestTrailEnabled.current
      } else {
        visual.trailGlow.visible = false
        visual.trailCore.visible = false
      }
    }

    let compositionMode: 'mobile' | 'desktop' | null = null
    const applyComposition = () => {
      const nextMode = host.clientWidth <= 760 ? 'mobile' : 'desktop'
      if (nextMode === compositionMode) return
      controls.target.set(0, nextMode === 'mobile' ? -1 : 0, 0)
      controls.update()
      compositionMode = nextMode
    }

    const resize = () => {
      const { clientWidth, clientHeight } = host
      const width = Math.max(clientWidth, 1)
      const height = Math.max(clientHeight, 1)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      visuals.forEach((visual) => {
        visual.trailGlowMaterial.resolution.set(width, height)
        visual.trailCoreMaterial.resolution.set(width, height)
      })
      applyComposition()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    let frame = 0
    let lastTrailCapture = 0
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate)
      const current = latestBodies.current
      const currentIds = new Set(current.map((body) => body.id))
      const trailEnabledNow = latestTrailEnabled.current
      const trailDurationMs = Math.max(1, latestTrailDuration.current) * 1000
      const cutoff = now - trailDurationMs

      if (observedTrailVersion !== latestTrailVersion.current) {
        Array.from(visuals.keys()).forEach(removeVisual)
        observedTrailVersion = latestTrailVersion.current
        lastTrailCapture = now
      }

      if (observedTrailEnabled !== trailEnabledNow) {
        visuals.forEach(clearTrail)
        observedTrailEnabled = trailEnabledNow
        lastTrailCapture = now - TRAIL_CAPTURE_INTERVAL
      }

      Array.from(visuals.entries()).forEach(([id, visual]) => {
        if (currentIds.has(id)) return
        visual.mesh.visible = false
        visual.light.visible = false

        if (!trailEnabledNow) {
          removeVisual(id)
          return
        }

        while (visual.points.length > 0 && visual.points[0].capturedAt < cutoff) {
          visual.points.shift()
        }
        updateTrailVisual(visual, now, trailDurationMs)
        if (visual.points.length === 0) removeVisual(id)
      })

      const shouldCaptureTrail = trailEnabledNow && now - lastTrailCapture >= TRAIL_CAPTURE_INTERVAL

      current.forEach((body) => {
        const visual = ensureVisual(body)
        const position = new THREE.Vector3(body.position.x, body.position.y, body.position.z)
        visual.mesh.visible = true
        visual.light.visible = true
        visual.mesh.position.copy(position)
        visual.mesh.scale.setScalar(Math.max(body.radius, 0.025))
        visual.light.position.copy(position)

        const bodyMaterial = visual.mesh.material as THREE.MeshStandardMaterial
        bodyMaterial.color.set(body.color)
        bodyMaterial.emissive.set(body.color)
        visual.light.color.set(body.color)
        ;(visual.trailMaterial.uniforms.uColor.value as THREE.Color).set(body.color)
        visual.trailGlowMaterial.color.set(body.color)
        visual.trailCoreMaterial.color.set(body.color)

        if (!trailEnabledNow) {
          visual.trailPoints.visible = false
          visual.trailGlow.visible = false
          visual.trailCore.visible = false
          return
        }

        while (visual.points.length > 0 && visual.points[0].capturedAt < cutoff) {
          visual.points.shift()
        }

        if (shouldCaptureTrail) {
          visual.points.push({ position: position.clone(), capturedAt: now })
          if (visual.points.length > MAX_TRAIL_POINTS) visual.points.shift()
        }

        updateTrailVisual(visual, now, trailDurationMs)
      })

      if (shouldCaptureTrail) lastTrailCapture = now
      controls.update()
      renderer.render(scene, camera)
    }

    frame = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      Array.from(visuals.keys()).forEach(removeVisual)
      starsGeometry.dispose()
      ;(stars.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div className="simulation-view" ref={hostRef} aria-label="3D three-body simulation" />
}
