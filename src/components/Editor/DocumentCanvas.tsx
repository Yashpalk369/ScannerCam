import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorView, Point, Quad, ScanPage } from '../../core/cv/types'
import { distance } from '../../core/cv/homography'
import { CornerMagnifier } from './CornerMagnifier'
import { Camera, Upload, Shield, Zap, FileCheck2, Sparkles } from 'lucide-react'
import { Logo } from '../Layout/Logo'

interface DocumentCanvasProps {
  page: ScanPage | null
  editMode: boolean
  editingQuad: Quad | null
  onUpdateQuadCorner: (index: number, pt: Point) => void
  isProcessing: boolean
  onOpenCamera?: () => void
  onAddFiles?: (files: FileList) => void
}

const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL']

export const DocumentCanvas: React.FC<DocumentCanvasProps> = ({
  page,
  editMode,
  editingQuad,
  onUpdateQuadCorner,
  isProcessing,
  onOpenCamera,
  onAddFiles,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const emptyFileInputRef = useRef<HTMLInputElement | null>(null)
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [activeHandleIndex, setActiveHandleIndex] = useState<number | null>(null)
  const [magnifierPos, setMagnifierPos] = useState<Point | null>(null)
  const [rawImage, setRawImage] = useState<HTMLImageElement | null>(null)
  const [previewImage, setPreviewImage] = useState<HTMLImageElement | null>(null)

  // Load raw image for corner edit
  useEffect(() => {
    if (!page) {
      setRawImage(null)
      return
    }
    let active = true
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
    const img = new Image()
    img.onload = () => {
      setPreviewImage(img)
    }
    img.src = page.previewUrl
  }, [page?.previewUrl, page])

  const calculateFit = useCallback(
    (imgW: number, imgH: number, canvasW: number, canvasH: number): EditorView => {
      const padding = 20
      const availW = Math.max(40, canvasW - padding * 2)
      const availH = Math.max(40, canvasH - padding * 2)
      const scale = Math.min(availW / imgW, availH / imgH)
      const drawWidth = imgW * scale
      const drawHeight = imgH * scale
      const offsetX = (canvasW - drawWidth) / 2
      const offsetY = (canvasH - drawHeight) / 2

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
    [],
  )

  // Main canvas redraw loop
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !page) return

    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    const width = Math.max(300, Math.floor(rect.width))
    const height = Math.max(350, Math.floor(rect.height))

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
    }
  }, [
    page,
    editMode,
    rawImage,
    previewImage,
    editingQuad,
    activeHandleIndex,
    calculateFit,
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
        <input
          ref={emptyFileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0 && onAddFiles) {
              onAddFiles(e.target.files)
              e.target.value = ''
            }
          }}
        />

        <div className="empty-hero-card">
          <div className="empty-badge-wrap">
            <Logo size={64} className="empty-hero-logo" />
            <span className="empty-glow-ring" />
          </div>

          <h2 className="empty-title">Free Online Document Scanner</h2>
          <p className="empty-subtitle">
            Scan documents, contracts, receipts & IDs right in your browser.
            Auto-crop, shadow removal & multi-page PDF export — zero server uploads.
          </p>

          <div className="empty-action-group">
            <button
              type="button"
              className="btn btn-primary btn-lg empty-cta-btn"
              onClick={onOpenCamera}
              disabled={isProcessing}
            >
              <Camera size={19} />
              <span>Scan with Camera</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-lg empty-cta-btn"
              onClick={() => emptyFileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Upload size={19} />
              <span>Upload Photos / Files</span>
            </button>
          </div>

          <p className="empty-drag-hint">or drag & drop images anywhere on screen</p>

          <div className="empty-trust-grid">
            <div className="trust-pill">
              <Shield size={14} className="text-brand" />
              <span>100% Client-Side Privacy</span>
            </div>
            <div className="trust-pill">
              <Zap size={14} className="text-brand" />
              <span>Auto-Edge Detection</span>
            </div>
            <div className="trust-pill">
              <FileCheck2 size={14} className="text-brand" />
              <span>Clean Multi-Page PDF</span>
            </div>
            <div className="trust-pill">
              <Sparkles size={14} className="text-brand" />
              <span>No Watermark & Free</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="document-canvas-container">
      <canvas
        ref={canvasRef}
        className={`interactive-canvas ${editMode ? 'edit-mode' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

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
