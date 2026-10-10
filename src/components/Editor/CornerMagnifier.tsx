import React, { useEffect, useRef } from 'react'
import type { Point } from '../../core/cv/types'

interface CornerMagnifierProps {
  sourceImage: HTMLImageElement | null
  cornerPoint: Point
  canvasPos: Point
  zoom?: number
  size?: number
}

export const CornerMagnifier: React.FC<CornerMagnifierProps> = ({
  sourceImage,
  cornerPoint,
  canvasPos,
  zoom = 2.4,
  size = 130,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !sourceImage) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = size
    canvas.height = size

    // Clear
    ctx.clearRect(0, 0, size, size)

    // Clip to circle
    ctx.save()
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    ctx.clip()

    // Draw zoomed image centered on cornerPoint
    const sw = size / zoom
    const sh = size / zoom
    const sx = cornerPoint.x - sw / 2
    const sy = cornerPoint.y - sh / 2

    ctx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, size, size)

    // Draw precision crosshairs
    const center = size / 2
    ctx.strokeStyle = '#0a8f5b'
    ctx.lineWidth = 1.5

    ctx.beginPath()
    // Horizontal crosshair with gap
    ctx.moveTo(center - 18, center)
    ctx.lineTo(center - 4, center)
    ctx.moveTo(center + 4, center)
    ctx.lineTo(center + 18, center)

    // Vertical crosshair with gap
    ctx.moveTo(center, center - 18)
    ctx.lineTo(center, center - 4)
    ctx.moveTo(center, center + 4)
    ctx.lineTo(center, center + 18)
    ctx.stroke()

    // Center target dot
    ctx.beginPath()
    ctx.arc(center, center, 2, 0, Math.PI * 2)
    ctx.fillStyle = '#0a8f5b'
    ctx.fill()

    ctx.restore()
  }, [sourceImage, cornerPoint, zoom, size])

  // Position loupe offset above the finger/cursor; flip below if too close to top edge
  const left = canvasPos.x - size / 2
  const top = canvasPos.y - size - 24 < 12 ? canvasPos.y + 28 : canvasPos.y - size - 24

  return (
    <div
      className="corner-magnifier"
      style={{
        transform: `translate3d(${left}px, ${top}px, 0)`,
        width: size,
        height: size,
      }}
    >
      <canvas ref={canvasRef} className="magnifier-canvas" />
    </div>
  )
}
