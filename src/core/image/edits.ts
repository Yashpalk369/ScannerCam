export interface Redaction {
  x: number
  y: number
  width: number
  height: number
}
export function coverRectangle(rect: Redaction, width: number, height: number) {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x >= 1 ||
    rect.y >= 1 ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    throw new Error('Redaction boxes must cover a visible part of the page.')
  const x = Math.max(0, Math.floor(rect.x * width))
  const y = Math.max(0, Math.floor(rect.y * height))
  return {
    x,
    y,
    width: Math.min(width - x, Math.ceil((rect.x + rect.width) * width) - x),
    height: Math.min(
      height - y,
      Math.ceil((rect.y + rect.height) * height) - y,
    ),
  }
}
export function curveOffset(x: number, bend: number, height: number) {
  return 4 * x * (1 - x) * bend * height
}
export async function editRaster(
  blob: Blob,
  redactions: Redaction[],
  top = 0,
  bottom = 0,
): Promise<Blob> {
  const image = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  try {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0)
    if (top || bottom) {
      const source = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const result = ctx.createImageData(canvas.width, canvas.height)
      const { width, height } = canvas
      for (let x = 0; x < width; x++) {
        const t = x / Math.max(1, width - 1)
        const start = curveOffset(t, top, height)
        const end = height - 1 + curveOffset(t, bottom, height)
        for (let y = 0; y < height; y++) {
          const sourceY = start + (y / Math.max(1, height - 1)) * (end - start)
          const offset = (y * width + x) * 4
          if (sourceY < 0 || sourceY > height - 1) {
            result.data.set([255, 255, 255, 255], offset)
            continue
          }
          const y0 = Math.floor(sourceY),
            y1 = Math.min(height - 1, y0 + 1),
            fraction = sourceY - y0
          for (let c = 0; c < 3; c++)
            result.data[offset + c] =
              source.data[(y0 * width + x) * 4 + c] * (1 - fraction) +
              source.data[(y1 * width + x) * 4 + c] * fraction
          result.data[offset + 3] = 255
        }
      }
      ctx.putImageData(result, 0, 0)
    }
    ctx.fillStyle = '#000'
    for (const rect of redactions) {
      const r = coverRectangle(rect, canvas.width, canvas.height)
      ctx.fillRect(r.x, r.y, r.width, r.height)
    }
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('Could not save edited image.')),
        'image/png',
      ),
    )
  } finally {
    image.close()
    canvas.width = canvas.height = 1
  }
}
