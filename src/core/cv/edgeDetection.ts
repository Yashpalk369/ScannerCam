import type { Point, Quad } from './types'
import { isConvexQuad, polygonArea, distance } from './homography'

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/**
 * 2D Cross product of OA and OB vectors = (A.x - O.x)*(B.y - O.y) - (A.y - O.y)*(B.x - O.x)
 */
function crossProduct(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/**
 * Monotone Chain Convex Hull algorithm.
 * Returns convex hull vertices in clockwise order.
 */
function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points

  // Sort points lexicographically (first by x, then by y)
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))

  const lower: Point[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i]
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * Perpendicular distance from point P to line segment AB
 */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const lineDist = distance(a, b)
  if (lineDist < 1e-6) return distance(p, a)
  return Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / lineDist
}

/**
 * Ramer-Douglas-Peucker (RDP) polygon simplification algorithm.
 */
function ramerDouglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points

  let maxDist = 0
  let index = 0
  const last = points.length - 1

  for (let i = 1; i < last; i += 1) {
    const dist = perpendicularDistance(points[i], points[0], points[last])
    if (dist > maxDist) {
      maxDist = dist
      index = i
    }
  }

  if (maxDist > epsilon) {
    const recResults1 = ramerDouglasPeucker(points.slice(0, index + 1), epsilon)
    const recResults2 = ramerDouglasPeucker(points.slice(index), epsilon)
    return recResults1.slice(0, recResults1.length - 1).concat(recResults2)
  }

  return [points[0], points[last]]
}

/**
 * Organizes 4 points into canonical [TL, TR, BR, BL] order.
 */
function orderQuadCorners(points: Point[]): Quad {
  let tl = points[0]
  let tr = points[0]
  let br = points[0]
  let bl = points[0]

  let minSum = tl.x + tl.y
  let maxSum = minSum
  let minDiff = tl.x - tl.y
  let maxDiff = minDiff

  for (const pt of points) {
    const sum = pt.x + pt.y
    const diff = pt.x - pt.y

    if (sum < minSum) {
      minSum = sum
      tl = pt
    }
    if (sum > maxSum) {
      maxSum = sum
      br = pt
    }
    if (diff > maxDiff) {
      maxDiff = diff
      tr = pt
    }
    if (diff < minDiff) {
      minDiff = diff
      bl = pt
    }
  }

  return [
    { x: tl.x, y: tl.y },
    { x: tr.x, y: tr.y },
    { x: br.x, y: br.y },
    { x: bl.x, y: bl.y },
  ]
}

/**
 * Intelligent Document Quad Detection.
 * Uses 2D Sobel gradient magnitude, inward edge ray scanning, convex hull,
 * and adaptive RDP polygon simplification to accurately identify document corners.
 */
export function detectDocumentQuad(imageData: ImageData): Quad | null {
  const { data, width, height } = imageData

  // Step 1: Compute downscaled grayscale map (width ~400px)
  const targetW = 400
  const scale = targetW / width
  const targetH = Math.max(100, Math.round(height * scale))

  const gray = new Uint8Array(targetW * targetH)
  for (let y = 0; y < targetH; y += 1) {
    const srcY = Math.min(height - 1, Math.floor(y / scale))
    const rowOffset = y * targetW
    const srcRowOffset = srcY * width

    for (let x = 0; x < targetW; x += 1) {
      const srcX = Math.min(width - 1, Math.floor(x / scale))
      const idx = (srcRowOffset + srcX) * 4
      gray[rowOffset + x] = Math.round(
        data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114,
      )
    }
  }

  // Step 2: 3x3 Box blur to remove high-frequency text & noise
  const blurred = new Uint8Array(targetW * targetH)
  for (let y = 1; y < targetH - 1; y += 1) {
    const yRow = y * targetW
    const ym1Row = (y - 1) * targetW
    const yp1Row = (y + 1) * targetW

    for (let x = 1; x < targetW - 1; x += 1) {
      const sum =
        gray[ym1Row + x - 1] +
        gray[ym1Row + x] +
        gray[ym1Row + x + 1] +
        gray[yRow + x - 1] +
        gray[yRow + x] +
        gray[yRow + x + 1] +
        gray[yp1Row + x - 1] +
        gray[yp1Row + x] +
        gray[yp1Row + x + 1]
      blurred[yRow + x] = Math.round(sum / 9)
    }
  }

  // Step 3: 3x3 Sobel edge gradient magnitude
  const grad = new Float32Array(targetW * targetH)
  let maxGrad = 0

  for (let y = 1; y < targetH - 1; y += 1) {
    const yRow = y * targetW
    const ym1Row = (y - 1) * targetW
    const yp1Row = (y + 1) * targetW

    for (let x = 1; x < targetW - 1; x += 1) {
      // Sobel X
      const gx =
        -blurred[ym1Row + x - 1] +
        blurred[ym1Row + x + 1] -
        2 * blurred[yRow + x - 1] +
        2 * blurred[yRow + x + 1] -
        blurred[yp1Row + x - 1] +
        blurred[yp1Row + x + 1]

      // Sobel Y
      const gy =
        -blurred[ym1Row + x - 1] -
        2 * blurred[ym1Row + x] -
        blurred[ym1Row + x + 1] +
        blurred[yp1Row + x - 1] +
        2 * blurred[yp1Row + x] +
        blurred[yp1Row + x + 1]

      const magnitude = Math.hypot(gx, gy)
      grad[yRow + x] = magnitude
      if (magnitude > maxGrad) {
        maxGrad = magnitude
      }
    }
  }

  if (maxGrad < 20) {
    return null
  }

  const edgeThreshold = Math.max(25, maxGrad * 0.22)
  const candidatePoints: Point[] = []

  // Step 4: Scan outward from center across 72 radial rays (every 5 degrees)
  const centerX = targetW / 2
  const centerY = targetH / 2
  const maxRadius = Math.hypot(centerX, centerY)

  for (let angleDeg = 0; angleDeg < 360; angleDeg += 5) {
    const angleRad = (angleDeg * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)

    // Scan from 25% outward to 98% edge of image
    let bestRadius = -1
    let bestMag = edgeThreshold

    for (let r = 20; r < maxRadius; r += 2) {
      const px = Math.round(centerX + r * cos)
      const py = Math.round(centerY + r * sin)

      if (px < 4 || px >= targetW - 4 || py < 4 || py >= targetH - 4) {
        break
      }

      const mag = grad[py * targetW + px]
      if (mag > bestMag) {
        bestMag = mag
        bestRadius = r
      }
    }

    if (bestRadius > 0) {
      candidatePoints.push({
        x: centerX + bestRadius * cos,
        y: centerY + bestRadius * sin,
      })
    }
  }

  // Also scan 4 outer borders inward toward center
  const stepCol = Math.max(2, Math.floor(targetW / 40))
  for (let x = 10; x < targetW - 10; x += stepCol) {
    // Top-down
    for (let y = 4; y < targetH * 0.45; y += 2) {
      if (grad[y * targetW + x] > edgeThreshold) {
        candidatePoints.push({ x, y })
        break
      }
    }
    // Bottom-up
    for (let y = targetH - 5; y > targetH * 0.55; y -= 2) {
      if (grad[y * targetW + x] > edgeThreshold) {
        candidatePoints.push({ x, y })
        break
      }
    }
  }

  const stepRow = Math.max(2, Math.floor(targetH / 40))
  for (let y = 10; y < targetH - 10; y += stepRow) {
    // Left-right
    for (let x = 4; x < targetW * 0.45; x += 2) {
      if (grad[y * targetW + x] > edgeThreshold) {
        candidatePoints.push({ x, y })
        break
      }
    }
    // Right-left
    for (let x = targetW - 5; x > targetW * 0.55; x -= 2) {
      if (grad[y * targetW + x] > edgeThreshold) {
        candidatePoints.push({ x, y })
        break
      }
    }
  }

  if (candidatePoints.length < 16) {
    return null
  }

  // Step 5: Compute Convex Hull of candidate boundary points
  const hull = convexHull(candidatePoints)
  if (hull.length < 4) {
    return null
  }

  // Step 6: Multi-pass RDP polygon simplification to isolate 4 dominant corners
  const hullClosed = [...hull, hull[0]]
  let bestQuad: Quad | null = null
  let minEpsilon = 4
  let maxEpsilon = Math.min(targetW, targetH) * 0.35

  for (let eps = minEpsilon; eps <= maxEpsilon; eps += 2) {
    const simplified = ramerDouglasPeucker(hullClosed, eps)
    // Remove duplicate end point if present
    const unique = simplified.slice(0, simplified.length - 1)

    if (unique.length === 4) {
      const ordered = orderQuadCorners(unique)
      if (isConvexQuad(ordered)) {
        const areaRatio = polygonArea(ordered) / (targetW * targetH)
        if (areaRatio >= 0.18 && areaRatio <= 0.96) {
          bestQuad = ordered
          break
        }
      }
    }
  }

  // Fallback: If exact 4-point RDP couldn't find a convex 4-gon, take 4 extreme projections of hull
  if (!bestQuad) {
    const extremeQuad = orderQuadCorners(hull)
    if (isConvexQuad(extremeQuad)) {
      const areaRatio = polygonArea(extremeQuad) / (targetW * targetH)
      if (areaRatio >= 0.18 && areaRatio <= 0.96) {
        bestQuad = extremeQuad
      }
    }
  }

  if (!bestQuad) {
    return null
  }

  // Step 7: Scale coordinates back to original image resolution
  const invScale = 1.0 / scale
  const nativeQuad: Quad = [
    {
      x: clamp(Math.round(bestQuad[0].x * invScale), 0, width - 1),
      y: clamp(Math.round(bestQuad[0].y * invScale), 0, height - 1),
    },
    {
      x: clamp(Math.round(bestQuad[1].x * invScale), 0, width - 1),
      y: clamp(Math.round(bestQuad[1].y * invScale), 0, height - 1),
    },
    {
      x: clamp(Math.round(bestQuad[2].x * invScale), 0, width - 1),
      y: clamp(Math.round(bestQuad[2].y * invScale), 0, height - 1),
    },
    {
      x: clamp(Math.round(bestQuad[3].x * invScale), 0, width - 1),
      y: clamp(Math.round(bestQuad[3].y * invScale), 0, height - 1),
    },
  ]

  return nativeQuad
}
