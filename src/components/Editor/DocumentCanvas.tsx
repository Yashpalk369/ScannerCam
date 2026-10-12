import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView, Point, Quad, ScanPage } from '../../core/cv/types'
import { distance } from '../../core/cv/homography'
import { CornerMagnifier } from './CornerMagnifier'
import { cvWorker } from '../../core/workers/workerClient'
import { Columns2, Loader2 } from 'lucide-react'

interface DocumentCanvasProps {
  page: ScanPage | null
  editMode: boolean
  editingQuad: Quad | null
  onUpdateQuadCorner: (index: number, pt: Point) => void
  isProcessing: boolean
}

const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL']

export const DocumentCanvas: React.FC<DocumentCanvasProps> = ({
  page,
  editMode,
  editingQuad,
  onUpdateQuadCorner,
  isProcessing,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [activeHandleIndex, setActiveHandleIndex] = useState<number | null>(null)
  const [magnifierPos, setMagnifierPos] = useState<Point | null>(null)
  const [rawImage, setRawImage] = useState<HTMLImageElement | null>(null)
  const [previewImage, setPreviewImage] = useState<HTMLImageElement | null>(null)
  const [comparisonEnabled, setComparisonEnabled] = useState(false)
  const [comparisonPosition, setComparisonPosition] = useState(50)
  const [comparisonImage, setComparisonImage] = useState<HTMLImageElement | null>(null)
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const comparisonCache = useRef<{ rawBlob: Blob; crop: string; image: HTMLImageElement } | null>(null)
  const cropKey = page ? JSON.stringify(page.quad) : ''

  useEffect(() => {
    setComparisonEnabled(false)
    setComparisonImage(null)
    setComparisonError(null)
    setComparisonPosition(50)
  }, [page?.id, page?.rawBlob, cropKey, editMode])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      setCanvasSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [page?.id])

  useEffect(() => {
    if (!page || !comparisonEnabled || editMode) { setComparisonLoading(false); return }
    let active = true
    const cached = comparisonCache.current
    if (cached?.rawBlob === page.rawBlob && cached.crop === cropKey) {
      setComparisonImage(cached.image)
      setComparisonLoading(false)
      return
    }
    setComparisonLoading(true)
    setComparisonError(null)
    setComparisonImage(null)
    void (async () => {
      try {
        const result = await cvWorker.warpAndFilter(page.rawBlob, page.quad, 'original')
        const image = await cvWorker.blobToImage(result.blob)
        if (!active) return
        comparisonCache.current = { rawBlob: page.rawBlob, crop: cropKey, image }
        setComparisonImage(image)
      } catch {
        if (active) setComparisonError('Could not prepare the comparison. Turn comparison off and try again.')
      } finally {
        if (active) setComparisonLoading(false)
      }
    })()
    return () => { active = false }
  }, [page?.id, page?.rawBlob, cropKey, comparisonEnabled, editMode])

  // Load raw image for corner edit
  useEffect(() => {
    if (!page) {
      setRawImage(null)
      return
    }
    let active = true
    setRawImage(null)
    const img = new Image()
    const url = URL.createObjectURL(page.rawBlob)
    img.onload = () => {
      if (active) {
        setRawImage(img)
      }
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
    }
    img.src = url
    return () => {
      active = false
      URL.revokeObjectURL(url)
    }
  }, [page?.id, page?.rawBlob])

  // Load output image for standard preview
  useEffect(() => {
    if (!page) {
      setPreviewImage(null)
      return
    }
    let active = true
    setPreviewImage(null)
    const img = new Image()
    img.onload = () => {
      if (active) setPreviewImage(img)
    }
    img.src = page.previewUrl
    return () => { active = false }
  }, [page?.previewUrl])

  const calculateFit = useCallback(
    (imgW: number, imgH: number, canvasW: number, canvasH: number): EditorView => {
      const padding = 20
      const availW = Math.max(40, canvasW - padding * 2)
      const topPadding = editMode ? padding : 58
      const bottomPadding = comparisonEnabled ? 72 : padding
      const availH = Math.max(40, canvasH - topPadding - bottomPadding)
      const scale = Math.min(availW / imgW, availH / imgH)
      const drawWidth = imgW * scale
      const drawHeight = imgH * scale
      const offsetX = (canvasW - drawWidth) / 2
      const offsetY = topPadding + (availH - drawHeight) / 2

      return {
        offsetX,
        offsetY,
        scale,
        drawWidth,
        drawHeight,
        imageWidth: imgW,
        imageHeight: imgH,
      }
    },
    [editMode, comparisonEnabled],
  )

  // Main canvas redraw loop
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !page) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    const width = Math.max(1, Math.floor(rect.width))
    const height = Math.max(1, Math.floor(rect.height))

    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    // Render edit mode (raw image + polygon quad)
    if (editMode && rawImage && editingQuad) {
      const view = calculateFit(rawImage.naturalWidth, rawImage.naturalHeight, width, height)
      setEditorView(view)

      // Draw original image
      ctx.drawImage(rawImage, view.offsetX, view.offsetY, view.drawWidth, view.drawHeight)

      // Projected quad points in canvas space
      const projected = editingQuad.map((pt) => ({
        x: view.offsetX + pt.x * view.scale,
        y: view.offsetY + pt.y * view.scale,
      }))

      // Draw semi-transparent green document mask
      ctx.save()
      ctx.fillStyle = 'rgba(10, 143, 91, 0.18)'
      ctx.strokeStyle = '#0a8f5b'
      ctx.lineWidth = 2.5

      ctx.beginPath()
      projected.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Draw draggable corner handles
      projected.forEach((p, idx) => {
        const isDragged = idx === activeHandleIndex

        // Outer glow on active
        if (isDragged) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 20, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(10, 143, 91, 0.25)'
          ctx.fill()
        }

        // Handle circle
        ctx.beginPath()
        ctx.arc(p.x, p.y, isDragged ? 12 : 9, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.strokeStyle = '#065f3d'
        ctx.lineWidth = 2.5
        ctx.stroke()

        // Label pill
        ctx.fillStyle = '#065f3d'
        ctx.font = '700 11px system-ui, -apple-system, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(CORNER_LABELS[idx], p.x, p.y - 18)
      })
      ctx.restore()
      return
    }

    // Standard output preview mode
    if (previewImage) {
      const view = calculateFit(
        previewImage.naturalWidth,
        previewImage.naturalHeight,
        width,
        height,
      )
      setEditorView(view)

      // Soft paper drop shadow
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.12)'
      ctx.shadowBlur = 24
      ctx.shadowOffsetY = 8

      ctx.drawImage(previewImage, view.offsetX, view.offsetY, view.drawWidth, view.drawHeight)
      ctx.restore()

      if (comparisonEnabled && comparisonImage) {
        const split = view.offsetX + view.drawWidth * comparisonPosition / 100
        ctx.save()
        ctx.beginPath()
        ctx.rect(view.offsetX, view.offsetY, split - view.offsetX, view.drawHeight)
        ctx.clip()
        ctx.drawImage(comparisonImage, view.offsetX, view.offsetY, view.drawWidth, view.drawHeight)
        ctx.restore()
        ctx.beginPath()
        ctx.moveTo(split, view.offsetY)
        ctx.lineTo(split, view.offsetY + view.drawHeight)
        ctx.strokeStyle = '#059669'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
  }, [
    page,
    editMode,
    rawImage,
    previewImage,
    editingQuad,
    activeHandleIndex,
    calculateFit,
    comparisonEnabled,
    comparisonImage,
    comparisonPosition,
    canvasSize,
  ])

  // Handle pointer interactions
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editMode || !editingQuad || !editorView || isProcessing) return

    const pointer = getCanvasCoords(e)
    let closestIndex = -1
    let minDist = Number.POSITIVE_INFINITY

    editingQuad.forEach((pt, idx) => {
      const projX = editorView.offsetX + pt.x * editorView.scale
      const projY = editorView.offsetY + pt.y * editorView.scale
      const d = distance(pointer, { x: projX, y: projY })

      if (d < 38 && d < minDist) {
        closestIndex = idx
        minDist = d
      }
    })

    if (closestIndex >= 0) {
      setActiveHandleIndex(closestIndex)
      setMagnifierPos(pointer)
      e.currentTarget.setPointerCapture(e.pointerId)
      e.preventDefault()
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      activeHandleIndex === null ||
      !editMode ||
      !editingQuad ||
      !editorView ||
      isProcessing
    ) {
      return
    }

    const pointer = getCanvasCoords(e)
    setMagnifierPos(pointer)

    // Convert canvas coordinates back to raw image space
    const rawX = Math.max(
      0,
      Math.min(editorView.imageWidth - 1, (pointer.x - editorView.offsetX) / editorView.scale),
    )
    const rawY = Math.max(
      0,
      Math.min(editorView.imageHeight - 1, (pointer.y - editorView.offsetY) / editorView.scale),
    )

    onUpdateQuadCorner(activeHandleIndex, { x: Math.round(rawX), y: Math.round(rawY) })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeHandleIndex !== null) {
      setActiveHandleIndex(null)
      setMagnifierPos(null)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    }
  }

  if (!page) {
    return (
      <div className="canvas-empty-state">
        <div className="empty-content">
          <p className="empty-title">No Document Selected</p>
          <p className="empty-subtitle">Take a photo with your camera or drop image files here.</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="document-canvas-container">
      {!editMode && <div className="comparison-top-bar">
        <button type="button" className="btn btn-secondary comparison-toggle" aria-pressed={comparisonEnabled} disabled={isProcessing} onClick={() => setComparisonEnabled(value => !value)}>
          {comparisonLoading ? <Loader2 size={16} className="spin-icon" /> : <Columns2 size={16} />}<span>Before / After</span>
        </button>
        {comparisonEnabled && comparisonImage && <span className="comparison-caption">Before enhancement · After enhancement</span>}
      </div>}
      <canvas
        ref={canvasRef}
        className={`interactive-canvas ${editMode ? 'edit-mode' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={editMode ? 'Document crop editor' : comparisonEnabled ? 'Before and after document comparison' : 'Scanned document preview'}
      />

      {comparisonEnabled && !editMode && <div className="comparison-controls">
        {comparisonLoading ? <p role="status">Preparing the same crop without enhancement…</p>
          : comparisonError ? <p role="alert">{comparisonError}</p>
          : comparisonImage && <><label htmlFor="comparison-slider"><span>Before</span><span>After</span></label><input id="comparison-slider" type="range" min={0} max={100} value={comparisonPosition} disabled={isProcessing} aria-label="Before and after comparison" aria-valuetext={`${comparisonPosition}% before enhancement`} onChange={event => setComparisonPosition(Number(event.target.value))} /></>}
      </div>}

      {/* Floating 2.5x Loupe Magnifier during corner dragging */}
      {editMode && activeHandleIndex !== null && editingQuad && magnifierPos && rawImage && (
        <CornerMagnifier
          sourceImage={rawImage}
          cornerPoint={editingQuad[activeHandleIndex]}
          canvasPos={magnifierPos}
        />
      )}
    </div>
  )
}
