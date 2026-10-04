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
 * Calculates cosine of the corner angle ∠ABC at vertex B.
 */
function cornerCosine(a: Point, b: Point, c: Point): number {
  const bax = a.x - b.x
  const bay = a.y - b.y
  const bcx = c.x - b.x
  const bcy = c.y - b.y
  const mag = Math.hypot(bax, bay) * Math.hypot(bcx, bcy)
  if (mag < 1e-6) return 1.0
  return (bax * bcx + bay * bcy) / mag
}

/**
 * Validates whether the 4 points form a geometrically plausible document in perspective:
 * - Must be strictly convex.
 * - Corner angles must be roughly perpendicular (between ~45° and ~135°).
 * - Area must be between 10% and 94% of the image frame.
 * - Aspect ratio must not be extremely skewed.
 */
function isRealisticDocumentQuad(quad: Quad, imgW: number, imgH: number): boolean {
  if (!isConvexQuad(quad)) return false

  const area = polygonArea(quad)
  const areaRatio = area / (imgW * imgH)
  if (areaRatio < 0.10 || areaRatio > 0.94) return false

  const d0 = distance(quad[0], quad[1]) // Top
  const d1 = distance(quad[1], quad[2]) // Right
  const d2 = distance(quad[2], quad[3]) // Bottom
  const d3 = distance(quad[3], quad[0]) // Left

  const minSide = Math.min(imgW, imgH) * 0.15
  if (d0 < minSide || d1 < minSide || d2 < minSide || d3 < minSide) return false

  // Check all 4 corner angles: in real perspective, corner angles should not be ultra-sharp or flat
  // |cos(θ)| <= 0.72 corresponds to angles between ~44° and ~136°
  const cos0 = Math.abs(cornerCosine(quad[3], quad[0], quad[1]))
  const cos1 = Math.abs(cornerCosine(quad[0], quad[1], quad[2]))
  const cos2 = Math.abs(cornerCosine(quad[1], quad[2], quad[3]))
  const cos3 = Math.abs(cornerCosine(quad[2], quad[3], quad[0]))
  if (cos0 > 0.72 || cos1 > 0.72 || cos2 > 0.72 || cos3 > 0.72) return false

  const maxW = Math.max(d0, d2)
  const maxH = Math.max(d1, d3)
  const aspect = maxW / maxH
  if (aspect < 0.2 || aspect > 5.0) return false

  return true
}

/**
 * Edge Verification:
 * Samples pixel gradient along all 4 boundary segments of the candidate quad.
 * Rejects false positives (e.g. noise on walls or floors) that don't have true contrast edges.
 */
function verifyQuadEdges(
  quad: Quad,
  grad: Float32Array,
  width: number,
  height: number,
  edgeThreshold: number,
): { valid: boolean; score: number } {
  const sides: [Point, Point][] = [
    [quad[0], quad[1]], // Top
    [quad[1], quad[2]], // Right
    [quad[2], quad[3]], // Bottom
    [quad[3], quad[0]], // Left
  ]

  const SAMPLES_PER_SIDE = 20
  const minGradPerPixel = Math.max(22, edgeThreshold * 0.55)

  let totalHits = 0
  let totalGradSum = 0
  let totalSamples = 0

  for (const [p1, p2] of sides) {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-4) return { valid: false, score: 0 }

    // Unit normal vector perpendicular to the side
    const nx = -dy / len
    const ny = dx / len

    let sideHits = 0
    let sideGradSum = 0

    // Sample along side from t = 0.08 to 0.92 (avoiding corner intersection artifacts)
    for (let s = 1; s <= SAMPLES_PER_SIDE; s += 1) {
      const t = 0.08 + (s / (SAMPLES_PER_SIDE + 1)) * 0.84
      const sx = p1.x + t * dx
      const sy = p1.y + t * dy

      // Search in a small perpendicular window (-2px to +2px) for local gradient peak
      let maxLocal = 0
      for (let offset = -2; offset <= 2; offset += 1) {
        const qx = Math.round(sx + offset * nx)
        const qy = Math.round(sy + offset * ny)
        if (qx >= 0 && qx < width && qy >= 0 && qy < height) {
          const g = grad[qy * width + qx]
          if (g > maxLocal) maxLocal = g
        }
      }

      sideGradSum += maxLocal
      if (maxLocal >= minGradPerPixel) {
        sideHits += 1
      }
    }

    const sideHitRate = sideHits / SAMPLES_PER_SIDE
    const sideAvgGrad = sideGradSum / SAMPLES_PER_SIDE

    // Every side MUST have a minimum fraction of edge hits and contrast.
    // If even ONE side of the quad has no contrast edge, this is not a real document!
    if (sideHitRate < 0.35 || sideAvgGrad < 18) {
      return { valid: false, score: 0 }
    }

    totalHits += sideHits
    totalGradSum += sideGradSum
    totalSamples += SAMPLES_PER_SIDE
  }

  const overallHitRate = totalHits / totalSamples
  const overallAvgGrad = totalGradSum / totalSamples

  // Overall criteria across all 4 sides combined
  if (overallHitRate < 0.45 || overallAvgGrad < Math.max(25, edgeThreshold * 0.60)) {
    return { valid: false, score: 0 }
  }

  const score = overallHitRate * 0.6 + (overallAvgGrad / edgeThreshold) * 0.4
  return { valid: true, score }
}

/**
 * Intelligent Document Quad Detection.
 * Uses 2D Sobel gradient magnitude, inward edge ray scanning, convex hull,
 * RDP polygon simplification, and strict edge-continuity verification to detect
 * real documents while rejecting walls, floors, and blank surfaces.
 */
export function detectDocumentQuad(imageData: ImageData): Quad | null {
  const { data, width, height } = imageData

  // Step 1: Compute downscaled grayscale map (width ~400px)
  const targetW = 400
  const scale = targetW / width
  const targetH = Math.max(100, Math.round(height * scale))

  const gray = new Uint8Array(targetW * targetH)
  let sumLum = 0
  let sumLumSq = 0
  let sampleCount = 0

  for (let y = 0; y < targetH; y += 1) {
    const srcY = Math.min(height - 1, Math.floor(y / scale))
    const rowOffset = y * targetW
    const srcRowOffset = srcY * width

    for (let x = 0; x < targetW; x += 1) {
      const srcX = Math.min(width - 1, Math.floor(x / scale))
      const idx = (srcRowOffset + srcX) * 4
      const lum = Math.round(
        data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114,
      )
      gray[rowOffset + x] = lum

      // Sample every 4th pixel for fast scene contrast check
      if ((x & 1) === 0 && (y & 1) === 0) {
        sumLum += lum
        sumLumSq += lum * lum
        sampleCount += 1
      }
    }
  }

  // Fast rejection of flat/monotone scenes (blank walls, uniform textures):
  // A scene with a document on a table has distinct contrast (stdDev >= 18).
  // Blank walls have stdDev typically < 10-14.
  const meanLum = sumLum / Math.max(1, sampleCount)
  const variance = Math.max(0, sumLumSq / Math.max(1, sampleCount) - meanLum * meanLum)
  const stdDev = Math.sqrt(variance)

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

  // If contrast is very low or maximum gradient across entire frame is weak,
  // there is no document in frame (e.g. wall, floor, empty room).
  if (maxGrad < 35 || (stdDev < 14 && maxGrad < 55)) {
    return null
  }

  const edgeThreshold = Math.max(30, maxGrad * 0.25)
  const candidatePoints: Point[] = []

  // Step 4: Scan outward from center across 72 radial rays (every 5 degrees)
  const centerX = targetW / 2
  const centerY = targetH / 2
  const maxRadius = Math.hypot(centerX, centerY)

  for (let angleDeg = 0; angleDeg < 360; angleDeg += 5) {
    const angleRad = (angleDeg * Math.PI) / 180
    const cos = Math.cos(angleRad)
    const sin = Math.sin(angleRad)

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

  if (candidatePoints.length < 24) {
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
  let bestScore = -1

  const minEpsilon = 4
  const maxEpsilon = Math.min(targetW, targetH) * 0.35

  for (let eps = minEpsilon; eps <= maxEpsilon; eps += 2) {
    const simplified = ramerDouglasPeucker(hullClosed, eps)
    // Remove duplicate end point if present
    const unique = simplified.slice(0, simplified.length - 1)

    if (unique.length === 4) {
      const ordered = orderQuadCorners(unique)
      if (isRealisticDocumentQuad(ordered, targetW, targetH)) {
        const { valid, score } = verifyQuadEdges(ordered, grad, targetW, targetH, edgeThreshold)
        if (valid && score > bestScore) {
          bestScore = score
          bestQuad = ordered
        }
      }
    }
  }

  // Fallback candidate: If exact 4-point RDP couldn't find a valid convex 4-gon,
  // test the extreme projections of the hull, but ONLY accept if it strictly passes
  // edge verification and geometric realism.
  if (!bestQuad) {
    const extremeQuad = orderQuadCorners(hull)
    if (isRealisticDocumentQuad(extremeQuad, targetW, targetH)) {
      const { valid, score } = verifyQuadEdges(extremeQuad, grad, targetW, targetH, edgeThreshold)
      if (valid && score >= 0.50) {
        bestQuad = extremeQuad
      }
    }
  }

  // If no candidate passed edge verification, this scene does NOT contain a document!
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
