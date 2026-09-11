import type { BodyState } from './types'

type Listener = () => void

let currentTrackedBody: BodyState | null = null
const listeners = new Set<Listener>()

export function publishTrackedBodyTelemetry(body: BodyState | null) {
  if (currentTrackedBody === body) return
  currentTrackedBody = body
  listeners.forEach((listener) => listener())
}

export function getTrackedBodyTelemetry() {
  return currentTrackedBody
}

export function subscribeTrackedBodyTelemetry(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
