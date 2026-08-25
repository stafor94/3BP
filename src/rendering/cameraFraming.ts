export const TARGET_BODY_RADIUS_SCREEN_FRACTION = 1 / 20

export type PerspectiveBodyFramingInput = {
  bodyRadius: number
  minRenderRadius: number
  verticalFovDegrees: number
  viewportWidth: number
  viewportHeight: number
  targetRadiusFraction?: number
}

function getHorizontalHalfFov(
  verticalFovDegrees: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const width = Math.max(viewportWidth, 1)
  const height = Math.max(viewportHeight, 1)
  const aspect = width / height
  const verticalHalfFov = Math.max(verticalFovDegrees, 0.001) * Math.PI / 360
  return Math.atan(Math.tan(verticalHalfFov) * aspect)
}

export function getRenderedBodyRadius(bodyRadius: number, minRenderRadius: number) {
  return Math.max(bodyRadius, minRenderRadius)
}

export function calculatePerspectiveBodyDistance({
  bodyRadius,
  minRenderRadius,
  verticalFovDegrees,
  viewportWidth,
  viewportHeight,
  targetRadiusFraction = TARGET_BODY_RADIUS_SCREEN_FRACTION,
}: PerspectiveBodyFramingInput) {
  const radius = getRenderedBodyRadius(bodyRadius, minRenderRadius)
  const horizontalHalfFov = getHorizontalHalfFov(
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  )
  const targetNdcRadius = Math.max(targetRadiusFraction * 2, 1e-6)
  const projectedTan = targetNdcRadius * Math.max(Math.tan(horizontalHalfFov), 1e-9)

  // Exact perspective projection for a sphere silhouette. Its angular radius is
  // asin(radius / distance), so tan(angle) = radius / sqrt(distance² - radius²).
  return radius * Math.sqrt(1 + 1 / (projectedTan * projectedTan))
}

export function calculateProjectedBodyRadiusPixels(
  bodyRadius: number,
  distance: number,
  verticalFovDegrees: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const radius = Math.max(bodyRadius, 0)
  if (distance <= radius) return Number.POSITIVE_INFINITY

  const horizontalHalfFov = getHorizontalHalfFov(
    verticalFovDegrees,
    viewportWidth,
    viewportHeight,
  )
  const silhouetteTan = radius / Math.sqrt(distance * distance - radius * radius)
  const ndcRadius = silhouetteTan / Math.max(Math.tan(horizontalHalfFov), 1e-9)
  return Math.max(viewportWidth, 1) * ndcRadius * 0.5
}
