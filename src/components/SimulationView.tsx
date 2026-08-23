import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
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
  trail: THREE.Line
  trailDots: THREE.Points
  trailGeometry: THREE.BufferGeometry
  points: TrailPoint[]
}

const MAX_TRAIL_POINTS = 3600
const TRAIL_CAPTURE_INTERVAL = 24

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

    const updateTrailGeometry = (visual: VisualBody) => {
      visual.trailGeometry.setFromPoints(visual.points.map((point) => point.position))
      if (visual.points.length > 0) visual.trailGeometry.computeBoundingSphere()
    }

    const clearTrail = (visual: VisualBody) => {
      visual.points = []
      visual.trailGeometry.setFromPoints([])
      visual.trailGeometry.boundingSphere = null
    }

    const removeVisual = (id: string) => {
      const visual = visuals.get(id)
      if (!visual) return
      scene.remove(visual.mesh, visual.light, visual.trail, visual.trailDots)
      visual.mesh.geometry.dispose()
      ;(visual.mesh.material as THREE.Material).dispose()
      visual.trailGeometry.dispose()
      ;(visual.trail.material as THREE.Material).dispose()
      ;(visual.trailDots.material as THREE.Material).dispose()
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

      const trailGeometry = new THREE.BufferGeometry().setFromPoints([])
      const trailMaterial = new THREE.LineBasicMaterial({
        color: body.color,
        transparent: true,
        opacity: 0.88,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      const trail = new THREE.Line(trailGeometry, trailMaterial)
      trail.visible = latestTrailEnabled.current
      trail.renderOrder = 20
      trail.frustumCulled = false

      const trailDotMaterial = new THREE.PointsMaterial({
        color: body.color,
        size: 0.022,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.42,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      const trailDots = new THREE.Points(trailGeometry, trailDotMaterial)
      trailDots.visible = latestTrailEnabled.current
      trailDots.renderOrder = 19
      trailDots.frustumCulled = false

      scene.add(mesh, light, trail, trailDots)
      const created = { mesh, light, trail, trailDots, trailGeometry, points: [] }
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
      camera.aspect = Math.max(clientWidth, 1) / Math.max(clientHeight, 1)
      camera.updateProjectionMatrix()
      renderer.setSize(clientWidth, clientHeight, false)
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
      }

      if (observedTrailEnabled !== trailEnabledNow) {
        visuals.forEach((visual) => {
          visual.trail.visible = trailEnabledNow
          visual.trailDots.visible = trailEnabledNow
          clearTrail(visual)
        })
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
        visual.trail.visible = trailEnabledNow
        visual.trailDots.visible = trailEnabledNow

        const material = visual.mesh.material as THREE.MeshStandardMaterial
        material.color.set(body.color)
        material.emissive.set(body.color)
        ;(visual.trail.material as THREE.LineBasicMaterial).color.set(body.color)
        ;(visual.trailDots.material as THREE.PointsMaterial).color.set(body.color)
        visual.light.color.set(body.color)

        if (!trailEnabledNow) return

        let trailChanged = false
        while (visual.points.length > 0 && visual.points[0].capturedAt < cutoff) {
          visual.points.shift()
          trailChanged = true
        }

        if (shouldCaptureTrail) {
          const previous = visual.points[visual.points.length - 1]?.position
          if (!previous || previous.distanceToSquared(position) > 1e-10) {
            visual.points.push({ position: position.clone(), capturedAt: now })
            if (visual.points.length > MAX_TRAIL_POINTS) visual.points.shift()
            trailChanged = true
          }
        }

        if (trailChanged) updateTrailGeometry(visual)
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
