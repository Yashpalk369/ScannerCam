import type { FilterMode } from './types'

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/**
 * Otsu's global thresholding method.
 */
export function otsuThreshold(grayValues: Uint8Array): number {
  const histogram = new Uint32Array(256)
  const total = grayValues.length

  for (let i = 0; i < total; i += 1) {
    histogram[grayValues[i]] += 1
  }

  let sum = 0
  for (let i = 0; i < 256; i += 1) {
    sum += i * histogram[i]
  }

  let sumBackground = 0
  let weightBackground = 0
  let maxVariance = -1
  let threshold = 128

  for (let i = 0; i < 256; i += 1) {
    weightBackground += histogram[i]
    if (weightBackground === 0) continue

    const weightForeground = total - weightBackground
    if (weightForeground === 0) break

    sumBackground += i * histogram[i]
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sum - sumBackground) / weightForeground

    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2

    if (variance > maxVariance) {
      maxVariance = variance
      threshold = i
    }
  }

  return threshold
}

/**
 * Bradley-Roth / Sauvola adaptive local thresholding using Integral Image.
 * Produces crisp, deep-black text on pure white paper without blacking out shadows.
 */
export function adaptiveThreshold(data: Uint8ClampedArray, width: number, height: number): void {
  const numPixels = width * height
  const gray = new Uint8Array(numPixels)

  // 1. Convert to grayscale
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
  }

  // 2. Compute 2D Integral Image
  const integral = new Float64Array((width + 1) * (height + 1))
  const stride = width + 1

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0
    const yOffset = (y + 1) * stride
    const prevYOffset = y * stride
    const grayYOffset = y * width

    for (let x = 0; x < width; x += 1) {
      rowSum += gray[grayYOffset + x]
      integral[yOffset + x + 1] = integral[prevYOffset + x + 1] + rowSum
    }
  }

  // 3. Adaptive thresholding with window S = width / 18, T = 12% lower than local mean
  const s = Math.max(8, Math.floor(Math.min(width, height) / 18))
  const s2 = Math.floor(s / 2)
  const t = 0.13

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - s2)
    const y1 = Math.min(height, y + s2)
    const rowOffset = y * width

    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - s2)
      const x1 = Math.min(width, x + s2)
      const count = (x1 - x0) * (y1 - y0)

      const sum =
        integral[y1 * stride + x1] -
        integral[y0 * stride + x1] -
        integral[y1 * stride + x0] +
        integral[y0 * stride + x0]

      const localMean = sum / count
      const pixelVal = gray[rowOffset + x]

      // If pixel is sufficiently darker than surrounding background -> ink (0), else paper (255)
      const isForeground = pixelVal < localMean * (1.0 - t)
      const outColor = isForeground ? 0 : 255

      const idx = (rowOffset + x) * 4
      data[idx] = outColor
      data[idx + 1] = outColor
      data[idx + 2] = outColor
    }
  }
}

/**
 * HD Detail Sharpening (Unsharp Mask Filter).
 * Elevates soft camera captures into sharp, crisp, high-definition scans.
 */
export function applyHDSharpening(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  strength = 0.45,
): void {
  const original = new Uint8ClampedArray(data)

  // 3x3 Laplacian / Unsharp detail kernel
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width * 4
    const rowPrev = (y - 1) * width * 4
    const rowNext = (y + 1) * width * 4

    for (let x = 1; x < width - 1; x += 1) {
      const idx = row + x * 4

      for (let c = 0; c < 3; c += 1) {
        const center = original[idx + c]
        // 4-neighbor average
        const neighborAvg =
          (original[rowPrev + x * 4 + c] +
            original[rowNext + x * 4 + c] +
            original[row + (x - 1) * 4 + c] +
            original[row + (x + 1) * 4 + c]) *
          0.25

        const diff = center - neighborAvg
        // Only sharpen real edges, avoid amplifying micro-noise on flat paper
        if (Math.abs(diff) > 2) {
          data[idx + c] = clamp(Math.round(center + diff * strength), 0, 255)
        }
      }
    }
  }
}

/**
 * Smart Blur Detection — measures Laplacian variance as a proxy for image sharpness.
 * Returns a blur score 0–1: 0 = perfectly sharp, 1 = severely blurred.
 * Samples every 4th pixel for speed.
 */
export function detectBlurStrength(data: Uint8ClampedArray, width: number, height: number): number {
  let sumSquared = 0
  let count = 0

  for (let y = 2; y < height - 2; y += 4) {
    const row = y * width * 4
    const rowPrev = (y - 1) * width * 4
    const rowNext = (y + 1) * width * 4

    for (let x = 2; x < width - 2; x += 4) {
      const idx = row + x * 4
      // Grayscale Laplacian on the luminance channel
      const lCenter = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114
      const lTop = data[rowPrev + x * 4] * 0.299 + data[rowPrev + x * 4 + 1] * 0.587 + data[rowPrev + x * 4 + 2] * 0.114
      const lBot = data[rowNext + x * 4] * 0.299 + data[rowNext + x * 4 + 1] * 0.587 + data[rowNext + x * 4 + 2] * 0.114
      const lLft = data[row + (x - 1) * 4] * 0.299 + data[row + (x - 1) * 4 + 1] * 0.587 + data[row + (x - 1) * 4 + 2] * 0.114
      const lRgt = data[row + (x + 1) * 4] * 0.299 + data[row + (x + 1) * 4 + 1] * 0.587 + data[row + (x + 1) * 4 + 2] * 0.114

      const lap = Math.abs(4 * lCenter - lTop - lBot - lLft - lRgt)
      sumSquared += lap * lap
      count += 1
    }
  }

  if (count === 0) return 0
  const variance = sumSquared / count
  // Typical sharp scans have variance > 2000; blurry ones < 400
  const normalised = clamp(1 - variance / 2200, 0, 1)
  return normalised
}

/**
 * Smart Deblur Sharpening — multi-pass Laplacian boost tuned by auto-detected blur severity.
 * Applied after Magic Color / Enhance to rescue soft camera captures.
 * Skipped entirely on already-sharp images to avoid over-sharpening.
 */
export function applySmartDeblur(data: Uint8ClampedArray, width: number, height: number): void {
  const blurScore = detectBlurStrength(data, width, height)

  // Skip deblur if image is already sharp enough (score < 0.25)
  if (blurScore < 0.25) return

  // Scale deblur intensity: mild (0.5) to aggressive (0.85) based on blur score
  const intensity = clamp(0.5 + blurScore * 0.6, 0.5, 0.85)

  const original = new Uint8ClampedArray(data)

  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width * 4
    const rowPrev = (y - 1) * width * 4
    const rowNext = (y + 1) * width * 4

    for (let x = 1; x < width - 1; x += 1) {
      const idx = row + x * 4

      for (let c = 0; c < 3; c += 1) {
        const center = original[idx + c]
        const top = original[rowPrev + x * 4 + c]
        const bot = original[rowNext + x * 4 + c]
        const lft = original[row + (x - 1) * 4 + c]
        const rgt = original[row + (x + 1) * 4 + c]

        // Full Laplacian response
        const lap = 4 * center - top - bot - lft - rgt

        // Add edge energy back, scaled by intensity and capped to avoid halos
        if (Math.abs(lap) > 3) {
          data[idx + c] = clamp(Math.round(center + lap * intensity * 0.5), 0, 255)
        }
      }
    }
  }
}

/**
 * Studio-Grade Magic Color:
 * 1. Computes document luminance histogram to find true black and white points (Auto Color Levels).
 * 2. Applies smooth, bounded shadow attenuation (no blinding overexposure or washed-out whiteouts).
 * 3. Preserves authentic ink color saturation, stamps, signatures, and photos.
 */
export function applyMagicColor(data: Uint8ClampedArray, width: number, height: number): void {
  const numPixels = width * height

  // 1. Compute histogram of luminance to find black point (1st percentile) and white point (96th percentile)
  const hist = new Uint32Array(256)
  const lums = new Uint8Array(numPixels)

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const l = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
    lums[p] = l
    hist[l] += 1
  }

  const p1Target = Math.floor(numPixels * 0.015)
  const p96Target = Math.floor(numPixels * 0.95)

  let accum = 0
  let blackPoint = 15
  let whitePoint = 235

  for (let i = 0; i < 256; i += 1) {
    accum += hist[i]
    if (accum <= p1Target) {
      blackPoint = i
    }
    if (accum <= p96Target) {
      whitePoint = i
    }
  }

  // Ensure healthy spread
  if (whitePoint - blackPoint < 60) {
    blackPoint = Math.max(0, blackPoint - 20)
    whitePoint = Math.min(255, whitePoint + 40)
  }

  const spread = Math.max(1, whitePoint - blackPoint)
  const levelScale = 255.0 / spread

  // 2. Estimate gentle background illumination map (block-based low-pass)
  const blockSize = Math.max(20, Math.floor(Math.min(width, height) / 16))
  const blocksX = Math.ceil(width / blockSize)
  const blocksY = Math.ceil(height / blockSize)
  const bgMap = new Float32Array(blocksX * blocksY)

  for (let by = 0; by < blocksY; by += 1) {
    const yStart = by * blockSize
    const yEnd = Math.min(height, yStart + blockSize)

    for (let bx = 0; bx < blocksX; bx += 1) {
      const xStart = bx * blockSize
      const xEnd = Math.min(width, xStart + blockSize)

      let sum = 0
      let count = 0
      for (let y = yStart; y < yEnd; y += 3) {
        for (let x = xStart; x < xEnd; x += 3) {
          sum += lums[y * width + x]
          count += 1
        }
      }
      bgMap[by * blocksX + bx] = count > 0 ? sum / count : 180
    }
  }

  // 3. Apply balanced Auto-Levels + Gentle Shadow Lift (bounded between 0.95 and 1.25)
  for (let y = 0; y < height; y += 1) {
    const by = Math.min(blocksY - 1, Math.floor(y / blockSize))

    for (let x = 0; x < width; x += 1) {
      const bx = Math.min(blocksX - 1, Math.floor(x / blockSize))
      const bgLum = bgMap[by * blocksX + bx]

      // Gentle shadow compensation factor: Never blow out highlights!
      const shadowCompensation = clamp(1.0 + 0.28 * ((220.0 - bgLum) / 220.0), 0.95, 1.22)

      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]

      // Auto levels stretch
      const rStretched = (r - blackPoint) * levelScale * shadowCompensation
      const gStretched = (g - blackPoint) * levelScale * shadowCompensation
      const bStretched = (b - blackPoint) * levelScale * shadowCompensation

      // Mild saturation preservation (1.1x)
      const lum = rStretched * 0.299 + gStretched * 0.587 + bStretched * 0.114
      const sat = 1.12

      data[idx] = clamp(Math.round(lum + (rStretched - lum) * sat), 0, 255)
      data[idx + 1] = clamp(Math.round(lum + (gStretched - lum) * sat), 0, 255)
      data[idx + 2] = clamp(Math.round(lum + (bStretched - lum) * sat), 0, 255)
    }
  }

  // 4. Polish with subtle HD sharpness
  applyHDSharpening(data, width, height, 0.4)
}

/**
 * Main filter dispatcher function. Modifies ImageData in-place.
 */
export function applyFilterToImageData(imageData: ImageData, mode: FilterMode): void {
  const { data, width, height } = imageData

  if (mode === 'original') {
    // Smart deblur then crisp HD sharpening
    applySmartDeblur(data, width, height)
    applyHDSharpening(data, width, height, 0.35)
    return
  }

  if (mode === 'grayscale') {
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
      data[i] = lum
      data[i + 1] = lum
      data[i + 2] = lum
    }
    applySmartDeblur(data, width, height)
    applyHDSharpening(data, width, height, 0.4)
    return
  }

  if (mode === 'bw') {
    adaptiveThreshold(data, width, height)
    return
  }

  if (mode === 'magic') {
    applyMagicColor(data, width, height)
    // Smart deblur is already run at end of applyMagicColor via applyHDSharpening;
    // run an additional targeted deblur pass for very blurry inputs
    applySmartDeblur(data, width, height)
    return
  }

  if (mode === 'enhance') {
    const contrast = 1.2
    const brightness = 4

    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp((data[i] - 128) * contrast + 128 + brightness, 0, 255)
      data[i + 1] = clamp((data[i + 1] - 128) * contrast + 128 + brightness, 0, 255)
      data[i + 2] = clamp((data[i + 2] - 128) * contrast + 128 + brightness, 0, 255)
    }
    applySmartDeblur(data, width, height)
    applyHDSharpening(data, width, height, 0.45)
    return
  }
}
