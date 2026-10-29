import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView, Point, Quad, ScanPage } from '../../core/cv/types'
import { distance } from '../../core/cv/homography'
import { CornerMagnifier } from './CornerMagnifier'
import { cvWorker } from '../../core/workers/workerClient'
import { Columns2, Loader2, Camera, Upload, ShieldCheck, ZoomIn, ZoomOut, Scan } from 'lucide-react'
import { calculateImageView, clampZoom, zoomAtPoint } from '../../core/cv/viewerTransform'
import type { ViewerTransform, ViewerViewport } from '../../core/cv/viewerTransform'

interface DocumentCanvasProps {
  importOnly?: boolean
  page: ScanPage | null
  editMode: boolean
  editingQuad: Quad | null
  onUpdateQuadCorner: (index: number, pt: Point) => void
  isProcessing: boolean
  onOpenCamera: () => void
  onAddFiles: (files: FileList) => void
}

const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL']
const FIT_TRANSFORM: ViewerTransform = { zoom: 1, pan: { x: 0, y: 0 } }
type ViewerGesture = { kind: 'pan'; start: Point; transform: ViewerTransform }
  | { kind: 'pinch'; distance: number; midpoint: Point; transform: ViewerTransform }

export const DocumentCanvas: React.FC<DocumentCanvasProps> = ({
  page,
  importOnly = false,
  editMode,
  editingQuad,
  onUpdateQuadCorner,
  isProcessing,
  onOpenCamera,
  onAddFiles,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
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
  const [transform, setTransform] = useState<ViewerTransform>(FIT_TRANSFORM)
  const [isPanning, setIsPanning] = useState(false)
  const transformRef = useRef<ViewerTransform>(FIT_TRANSFORM)
  const viewRef = useRef<EditorView | null>(null)
  const viewportRef = useRef<ViewerViewport>({ width: 0, height: 0, top: 62, bottom: 20 })
  const fitScaleRef = useRef(1)
  const centerRef = useRef<Point>({ x: 0, y: 0 })
  const pointersRef = useRef(new Map<number, Point>())
  const gestureRef = useRef<ViewerGesture | null>(null)
  const handleRef = useRef<number | null>(null)
  const cropKey = page ? JSON.stringify(page.quad) : ''

  const changeTransform = useCallback((requested: ViewerTransform) => {
    const view = viewRef.current
    const next = { ...requested, zoom: clampZoom(requested.zoom) }
    if (view) next.pan = calculateImageView(view.imageWidth, view.imageHeight, viewportRef.current, next).pan
    transformRef.current = next
    setTransform(next)
  }, [])

  const resetViewer = useCallback(() => {
    pointersRef.current.clear()
    gestureRef.current = null
    handleRef.current = null
    setActiveHandleIndex(null)
    setMagnifierPos(null)
    setIsPanning(false)
    changeTransform(FIT_TRANSFORM)
  }, [changeTransform])

  useEffect(() => { resetViewer() }, [page?.id, page?.rawBlob, cropKey, editMode, resetViewer])

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
      const viewport = { width: canvasW, height: canvasH, top: canvasW < 600 ? 112 : 62, bottom: comparisonEnabled ? 112 : 36 }
      const layout = calculateImageView(imgW, imgH, viewport, transform)
      viewportRef.current = viewport
      fitScaleRef.current = layout.fitScale
      centerRef.current = layout.center
      viewRef.current = layout.view
      if (layout.pan.x !== transform.pan.x || layout.pan.y !== transform.pan.y) {
        const bounded = { ...transform, pan: layout.pan }
        transformRef.current = bounded
        setTransform(bounded)
      }
      return layout.view
    },
    [comparisonEnabled, transform],
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
    transform,
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

  const zoomViewer = useCallback((zoom: number, anchor = centerRef.current) => {
    changeTransform(zoomAtPoint(transformRef.current, zoom, anchor, centerRef.current))
  }, [changeTransform])

  const toggleComparison = () => {
    const enabled = !comparisonEnabled
    const view = viewRef.current
    // Keep inspected text at the same magnification when comparison adds a slider.
    if (view && transformRef.current.zoom > 1) {
      const viewport = { ...viewportRef.current, bottom: enabled ? 112 : 36 }
      const fit = calculateImageView(view.imageWidth, view.imageHeight, viewport, FIT_TRANSFORM)
      const zoom = clampZoom(view.scale / fit.fitScale)
      const next = { zoom, pan: calculateImageView(view.imageWidth, view.imageHeight, viewport, { zoom, pan: transformRef.current.pan }).pan }
      transformRef.current = next
      setTransform(next)
    }
    setComparisonEnabled(enabled)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      if (isProcessing) return
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const rect = canvas.getBoundingClientRect()
        zoomViewer(transformRef.current.zoom * Math.exp(-event.deltaY * 0.005), { x: event.clientX - rect.left, y: event.clientY - rect.top })
      } else if (transformRef.current.zoom > 1) {
        event.preventDefault()
        const current = transformRef.current
        changeTransform({ ...current, pan: { x: current.pan.x - (event.shiftKey ? event.deltaY : event.deltaX), y: current.pan.y - (event.shiftKey ? 0 : event.deltaY) } })
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [page?.id, isProcessing, zoomViewer, changeTransform])

  const startPinch = () => {
    const [a, b] = [...pointersRef.current.values()]
    gestureRef.current = { kind: 'pinch', distance: Math.max(1, distance(a, b)), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, transform: transformRef.current }
    handleRef.current = null
    setActiveHandleIndex(null)
    setMagnifierPos(null)
    setIsPanning(true)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (isProcessing || !viewRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return
    const pointer = getCanvasCoords(event)
    pointersRef.current.set(event.pointerId, pointer)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointersRef.current.size === 2) { startPinch(); event.preventDefault(); return }
    if (pointersRef.current.size > 2) return
    if (editMode && editingQuad) {
      const view = viewRef.current
      let closest = -1
      let minimum = 38
      editingQuad.forEach((point, index) => {
        const gap = distance(pointer, { x: view.offsetX + point.x * view.scale, y: view.offsetY + point.y * view.scale })
        if (gap < minimum) { minimum = gap; closest = index }
      })
      if (closest >= 0) {
        handleRef.current = closest
        setActiveHandleIndex(closest)
        setMagnifierPos(pointer)
        event.preventDefault()
        return
      }
    }
    if (transformRef.current.zoom > 1) {
      gestureRef.current = { kind: 'pan', start: pointer, transform: transformRef.current }
      setIsPanning(true)
      event.preventDefault()
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(event.pointerId) || isProcessing) return
    const pointer = getCanvasCoords(event)
    pointersRef.current.set(event.pointerId, pointer)
    const gesture = gestureRef.current
    if (gesture?.kind === 'pinch' && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const next = zoomAtPoint(gesture.transform, gesture.transform.zoom * distance(a, b) / gesture.distance, gesture.midpoint, centerRef.current)
      next.pan.x += midpoint.x - gesture.midpoint.x
      next.pan.y += midpoint.y - gesture.midpoint.y
      changeTransform(next)
    } else if (handleRef.current !== null && editMode && editingQuad && viewRef.current) {
      const view = viewRef.current
      setMagnifierPos(pointer)
      const x = Math.max(0, Math.min(view.imageWidth - 1, (pointer.x - view.offsetX) / view.scale))
      const y = Math.max(0, Math.min(view.imageHeight - 1, (pointer.y - view.offsetY) / view.scale))
      onUpdateQuadCorner(handleRef.current, { x: Math.round(x), y: Math.round(y) })
    } else if (gesture?.kind === 'pan') {
      changeTransform({ ...gesture.transform, pan: { x: gesture.transform.pan.x + pointer.x - gesture.start.x, y: gesture.transform.pan.y + pointer.y - gesture.start.y } })
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    handleRef.current = null
    setActiveHandleIndex(null)
    setMagnifierPos(null)
    gestureRef.current = null
    setIsPanning(false)
    if (pointersRef.current.size === 1 && transformRef.current.zoom > 1) {
      gestureRef.current = { kind: 'pan', start: [...pointersRef.current.values()][0], transform: transformRef.current }
    }
  }

  const onViewerKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (isProcessing || event.ctrlKey || event.metaKey || event.altKey) return
    const movements: Record<string, Point> = { ArrowLeft: { x: 40, y: 0 }, ArrowRight: { x: -40, y: 0 }, ArrowUp: { x: 0, y: 40 }, ArrowDown: { x: 0, y: -40 } }
    if (['+', '=', '-', '0'].includes(event.key) || movements[event.key]) {
      event.preventDefault()
      event.stopPropagation()
      const current = transformRef.current
      if (event.key === '0') resetViewer()
      else if (event.key === '+' || event.key === '=') zoomViewer(current.zoom * 1.25)
      else if (event.key === '-') zoomViewer(current.zoom / 1.25)
      else if (current.zoom > 1) changeTransform({ ...current, pan: { x: current.pan.x + movements[event.key].x, y: current.pan.y + movements[event.key].y } })
    }
  }

  if (!page) {
    return (
      <div className="canvas-empty-state">
        <div className="empty-content">
          <span className="scanner-start-icon" aria-hidden="true">{importOnly ? <Upload size={32} /> : <Camera size={32} />}</span>
          <p className="empty-title">{importOnly ? 'Add PDFs or document photos' : 'Scan your first document'}</p>
          <p className="empty-subtitle">Upload PDFs, HEIC, or document photos to create a clean PDF.</p>
          <div className="scanner-start-actions">
            {!importOnly && <button type="button" className="btn btn-primary" onClick={onOpenCamera} disabled={isProcessing}><Camera size={18} />Scan Document</button>}
            <button type="button" className={`btn ${importOnly ? 'btn-primary' : 'btn-secondary'}`} onClick={() => fileInputRef.current?.click()} disabled={isProcessing}><Upload size={18} />Upload Files</button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif,application/pdf,.pdf" multiple hidden onChange={event => { if (event.target.files?.length) onAddFiles(event.target.files); event.target.value = '' }} />
          <p className="scanner-start-privacy"><ShieldCheck size={15} />Free · No signup · Documents stay on your device</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="document-canvas-container">
      <div className="canvas-tools">
        {!editMode && <button type="button" className="btn btn-secondary comparison-toggle" aria-pressed={comparisonEnabled} disabled={isProcessing} onClick={toggleComparison}>
          {comparisonLoading ? <Loader2 size={16} className="spin-icon" /> : <Columns2 size={16} />}<span>Before / After</span>
        </button>}
        <div className="viewer-zoom-controls" aria-label="Document zoom controls">
          <button type="button" className="viewer-tool-button" aria-label="Zoom out" title="Zoom out" disabled={isProcessing || transform.zoom <= 1} onClick={() => zoomViewer(transform.zoom / 1.25)}><ZoomOut size={18} /></button>
          <output aria-label="Zoom level" data-testid="viewer-transform" data-zoom={transform.zoom} data-pan-x={transform.pan.x} data-pan-y={transform.pan.y}>{Math.round((editorView?.scale ?? 1) * 100)}%</output>
          <button type="button" className="viewer-tool-button" aria-label="Zoom in" title="Zoom in" disabled={isProcessing || transform.zoom >= 24} onClick={() => zoomViewer(transform.zoom * 1.25)}><ZoomIn size={18} /></button>
          <button type="button" className="viewer-tool-button viewer-fit" disabled={isProcessing} aria-label="Fit document" onClick={resetViewer}><Scan size={16} />Fit</button>
          <button type="button" className="viewer-tool-button" disabled={isProcessing} aria-label="Actual size" title="View at actual size" onClick={() => zoomViewer(1 / fitScaleRef.current)}>100%</button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className={`interactive-canvas ${editMode ? 'edit-mode' : ''} ${transform.zoom > 1 ? 'viewer-zoomed' : ''} ${isPanning ? 'viewer-panning' : ''}`}
        tabIndex={0}
        aria-describedby="viewer-help"
        onKeyDown={onViewerKeyDown}
        style={{ touchAction: editMode || transform.zoom > 1 ? 'none' : 'pan-y' }}
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

      <p id="viewer-help" className="viewer-help">Pinch to zoom · Drag to move<span className="viewer-keyboard-help"> · Ctrl+scroll or +/− to zoom · Arrows to pan · 0 to fit</span></p>

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
