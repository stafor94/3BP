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

type TrailLayer = {
  core: Line2
  coreGeometry: LineGeometry
  coreMaterial: LineMaterial
  glow: Line2
  glowGeometry: LineGeometry
  glowMaterial: LineMaterial
}

type VisualBody = {
  mesh: THREE.Mesh
  light: THREE.PointLight
  trailLayers: TrailLayer[]
  points: TrailPoint[]
}

const MAX_TRAIL_POINTS = 1800
const TRAIL_CAPTURE_INTERVAL = 40
const TRAIL_FADE_LAYERS = 7

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

    const hideTrailLayer = (layer: TrailLayer) => {
      layer.core.visible = false
      layer.glow.visible = false
    }

    const updateTrailGeometry = (visual: VisualBody, now: number, durationMs: number) => {
      if (visual.points.length < 2) {
        visual.trailLayers.forEach(hideTrailLayer)
        return
      }

      const layerPositions = Array.from({ length: TRAIL_FADE_LAYERS }, () => [] as number[])

      for (let index = 1; index < visual.points.length; index += 1) {
        const previous = visual.points[index - 1]
        const current = visual.points[index]
        const ageRatio = THREE.MathUtils.clamp((now - current.capturedAt) / durationMs, 0, 0.999999)
        const layerIndex = Math.min(TRAIL_FADE_LAYERS - 1, Math.floor(ageRatio * TRAIL_FADE_LAYERS))
        const positions = layerPositions[layerIndex]

        if (positions.length === 0) {
          positions.push(previous.position.x, previous.position.y, previous.position.z)
        }
        positions.push(current.position.x, current.position.y, current.position.z)
      }

      visual.trailLayers.forEach((layer, index) => {
        const positions = layerPositions[index]
        if (positions.length < 6) {
          hideTrailLayer(layer)
          return
        }

        layer.coreGeometry.setPositions(positions)
        layer.glowGeometry.setPositions(positions)
        layer.core.visible = latestTrailEnabled.current
        layer.glow.visible = latestTrailEnabled.current
      })
    }

    const clearTrail = (visual: VisualBody) => {
      visual.points = []
      visual.trailLayers.forEach(hideTrailLayer)
    }

    const removeVisual = (id: string) => {
      const visual = visuals.get(id)
      if (!visual) return
      scene.remove(visual.mesh, visual.light)
      visual.mesh.geometry.dispose()
      ;(visual.mesh.material as THREE.Material).dispose()

      visual.trailLayers.forEach((layer) => {
        scene.remove(layer.core, layer.glow)
        layer.coreGeometry.dispose()
        layer.glowGeometry.dispose()
        layer.coreMaterial.dispose()
        layer.glowMaterial.dispose()
      })
      visuals.delete(id)
    }

    const createTrailLayer = (body: BodyState, layerIndex: number): TrailLayer => {
      const freshness = 1 - layerIndex / (TRAIL_FADE_LAYERS - 1)
      const strength = freshness * freshness

      const coreGeometry = new LineGeometry()
      coreGeometry.setPositions([0, 0, 0, 0, 0, 0])
      const coreMaterial = new LineMaterial({
        color: new THREE.Color(body.color).getHex(),
        linewidth: 1.1 + 2.6 * freshness,
        transparent: true,
        opacity: 0.035 + 0.84 * strength,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      coreMaterial.resolution.set(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1))
      const core = new Line2(coreGeometry, coreMaterial)
      core.visible = false
      core.renderOrder = 31 + (TRAIL_FADE_LAYERS - layerIndex)
      core.frustumCulled = false

      const glowGeometry = new LineGeometry()
      glowGeometry.setPositions([0, 0, 0, 0, 0, 0])
      const glowMaterial = new LineMaterial({
        color: new THREE.Color(body.color).getHex(),
        linewidth: 3.5 + 5.5 * freshness,
        transparent: true,
        opacity: 0.012 + 0.22 * strength,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      glowMaterial.resolution.set(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1))
      const glow = new Line2(glowGeometry, glowMaterial)
      glow.visible = false
      glow.renderOrder = 20 + (TRAIL_FADE_LAYERS - layerIndex)
      glow.frustumCulled = false

      scene.add(glow, core)
      return { core, coreGeometry, coreMaterial, glow, glowGeometry, glowMaterial }
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
      const trailLayers = Array.from({ length: TRAIL_FADE_LAYERS }, (_, index) => createTrailLayer(body, index))

      scene.add(mesh, light)
      const created = { mesh, light, trailLayers, points: [] }
      visuals.set(body.id, created)
      return created
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
        visual.trailLayers.forEach((layer) => {
          layer.coreMaterial.resolution.set(width, height)
          layer.glowMaterial.resolution.set(width, height)
        })
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

      Array.from(visuals.keys()).forEach((id) => {
        if (!currentIds.has(id)) removeVisual(id)
      })

      if (observedTrailVersion !== latestTrailVersion.current) {
        visuals.forEach(clearTrail)
        observedTrailVersion = latestTrailVersion.current
        lastTrailCapture = now
      }

      if (observedTrailEnabled !== trailEnabledNow) {
        visuals.forEach(clearTrail)
        observedTrailEnabled = trailEnabledNow
        lastTrailCapture = now - TRAIL_CAPTURE_INTERVAL
      }

      const shouldCaptureTrail = trailEnabledNow && now - lastTrailCapture >= TRAIL_CAPTURE_INTERVAL
      const cutoff = now - trailDurationMs

      current.forEach((body) => {
        const visual = ensureVisual(body)
        const position = new THREE.Vector3(body.position.x, body.position.y, body.position.z)
        visual.mesh.position.copy(position)
        visual.mesh.scale.setScalar(Math.max(body.radius, 0.025))
        visual.light.position.copy(position)

        const bodyMaterial = visual.mesh.material as THREE.MeshStandardMaterial
        bodyMaterial.color.set(body.color)
        bodyMaterial.emissive.set(body.color)
        visual.light.color.set(body.color)
        visual.trailLayers.forEach((layer) => {
          layer.coreMaterial.color.set(body.color)
          layer.glowMaterial.color.set(body.color)
        })

        if (!trailEnabledNow) {
          visual.trailLayers.forEach(hideTrailLayer)
          return
        }

        let trailChanged = false
        while (visual.points.length > 0 && visual.points[0].capturedAt < cutoff) {
          visual.points.shift()
          trailChanged = true
        }

        if (shouldCaptureTrail) {
          visual.points.push({ position: position.clone(), capturedAt: now })
          if (visual.points.length > MAX_TRAIL_POINTS) visual.points.shift()
          trailChanged = true
        }

        if (trailChanged) updateTrailGeometry(visual, now, trailDurationMs)
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
