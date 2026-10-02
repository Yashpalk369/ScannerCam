import type { Point, Quad } from './types'

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function cloneQuad(quad: Quad): Quad {
  return [
    { x: quad[0].x, y: quad[0].y },
    { x: quad[1].x, y: quad[1].y },
    { x: quad[2].x, y: quad[2].y },
    { x: quad[3].x, y: quad[3].y },
  ]
}

export function defaultQuad(width: number, height: number): Quad {
  const maxX = Math.max(1, width - 1)
  const maxY = Math.max(1, height - 1)
  return [
    { x: 0, y: 0 },
    { x: maxX, y: 0 },
    { x: maxX, y: maxY },
    { x: 0, y: maxY },
  ]
}

export function polygonArea(points: Point[]): number {
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i]
    const p2 = points[(i + 1) % points.length]
    area += p1.x * p2.y - p2.x * p1.y
  }
  return Math.abs(area) / 2
}

export function isConvexQuad(points: Point[]): boolean {
  if (points.length !== 4) return false

  let sign = 0
  for (let i = 0; i < 4; i += 1) {
    const p0 = points[i]
    const p1 = points[(i + 1) % 4]
    const p2 = points[(i + 2) % 4]
    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x)

    if (Math.abs(cross) < 1e-4) return false

    const currentSign = Math.sign(cross)
    if (sign === 0) {
      sign = currentSign
    } else if (currentSign !== sign) {
      return false
    }
  }
  return true
}

export function estimateWarpSize(quad: Quad): { width: number; height: number } {
  const widthA = distance(quad[0], quad[1])
  const widthB = distance(quad[3], quad[2])
  const heightA = distance(quad[0], quad[3])
  const heightB = distance(quad[1], quad[2])

  const width = Math.max(120, Math.min(3840, Math.round(Math.max(widthA, widthB))))
  const height = Math.max(120, Math.min(3840, Math.round(Math.max(heightA, heightB))))

  return { width, height }
}

export function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const n = vector.length
  const augmented = matrix.map((row, index) => [...row, vector[index]])

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivotRow][col])) {
        pivotRow = row
      }
    }

    if (Math.abs(augmented[pivotRow][col]) < 1e-10) {
      throw new Error('Singular matrix while solving homography')
    }

    if (pivotRow !== col) {
      ;[augmented[col], augmented[pivotRow]] = [augmented[pivotRow], augmented[col]]
    }

    const pivotValue = augmented[col][col]
    for (let c = col; c <= n; c += 1) {
      augmented[col][c] /= pivotValue
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = augmented[row][col]
      if (factor === 0) continue
      for (let c = col; c <= n; c += 1) {
        augmented[row][c] -= factor * augmented[col][c]
      }
    }
  }

  return augmented.map((row) => row[n])
}

export function buildHomography(from: Quad, to: Quad): number[] {
  const matrix: number[][] = []
  const vector: number[] = []

  for (let i = 0; i < 4; i += 1) {
    const x = from[i].x
    const y = from[i].y
    const u = to[i].x
    const v = to[i].y

    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    vector.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    vector.push(v)
  }

  const h = solveLinearSystem(matrix, vector)
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

export function applyHomography(matrix: number[], x: number, y: number): Point {
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8]
  const mappedX = (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator
  const mappedY = (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator
  return { x: mappedX, y: mappedY }
}
