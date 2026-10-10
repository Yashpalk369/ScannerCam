import React, { useRef, useState } from 'react'
import { Trash2, Plus, FileText, GripVertical, ChevronUp, ChevronDown } from 'lucide-react'
import type { ScanPage } from '../../core/cv/types'

interface PageStripProps {
  pages: ScanPage[]
  activePageId: string | null
  isProcessing: boolean
  onSelectPage: (id: string) => void
  onMovePage: (id: string, direction: 'up' | 'down') => void
  onReorderPages: (fromIndex: number, toIndex: number) => void
  onRemovePage: (id: string) => void
  onAddFiles: (files: FileList) => void
}

export const PageStrip: React.FC<PageStripProps> = ({
  pages,
  activePageId,
  isProcessing,
  onSelectPage,
  onMovePage,
  onReorderPages,
  onRemovePage,
  onAddFiles,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(e.target.files)
      e.target.value = ''
    }
  }

  // ── Drag and Drop handlers ──────────────────────────────────────────────────

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    dragIndexRef.current = index
    setIsDragging(true)
    e.dataTransfer.effectAllowed = 'move'
    // Ghost image: use the card element itself at natural size
    const el = e.currentTarget
    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, 24)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (index !== dragIndexRef.current) {
      setDragOverIndex(index)
    }
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, toIndex: number) => {
    e.preventDefault()
    const fromIndex = dragIndexRef.current
    if (fromIndex !== null && fromIndex !== toIndex) {
      onReorderPages(fromIndex, toIndex)
    }
    dragIndexRef.current = null
    setDragOverIndex(null)
    setIsDragging(false)
  }

  const handleDragEnd = () => {
    dragIndexRef.current = null
    setDragOverIndex(null)
    setIsDragging(false)
  }

  return (
    <aside className="page-strip-panel">
      <div className="strip-header">
        <div className="strip-title">
          <FileText size={16} />
          <h3>Pages</h3>
        </div>
        <span className="page-count-badge">
          {pages.length} {pages.length === 1 ? 'page' : 'pages'}
        </span>
      </div>

      <div className="thumbnails-scroll-container">
        {pages.map((page, index) => {
          const isActive = page.id === activePageId
          const isDropTarget = dragOverIndex === index

          return (
            <div
              key={page.id}
              className={`page-thumbnail-card ${isActive ? 'active' : ''} ${isDropTarget ? 'drop-target' : ''} ${isDragging && dragIndexRef.current === index ? 'dragging-source' : ''}`}
              draggable={!isProcessing}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={() => onSelectPage(page.id)}
            >
              {/* Drag grip handle */}
              <div
                className="drag-grip"
                title="Drag to reorder"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <GripVertical size={14} />
              </div>

              <div className="thumbnail-preview-wrap">
                <img src={page.previewUrl} alt={page.name} className="thumbnail-img" />
                <span className="page-number-pill">{index + 1}</span>
              </div>

              <div className="thumbnail-info">
                <p className="page-name">{page.name}</p>
                <p className="page-dims">
                  {page.width}×{page.height} • {page.filter}
                </p>
              </div>

              <div className="thumbnail-actions" onClick={(e) => e.stopPropagation()}>
                {pages.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="btn-tiny btn-move-prev"
                      disabled={isProcessing || index === 0}
                      onClick={() => onMovePage(page.id, 'up')}
                      title="Move page earlier"
                      aria-label={`Move page ${index + 1} earlier`}
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn-tiny btn-move-next"
                      disabled={isProcessing || index === pages.length - 1}
                      onClick={() => onMovePage(page.id, 'down')}
                      title="Move page later"
                      aria-label={`Move page ${index + 1} later`}
                    >
                      <ChevronDown size={13} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="btn-tiny btn-danger"
                  disabled={isProcessing}
                  onClick={() => onRemovePage(page.id)}
                  title="Remove page"
                  aria-label={`Remove page ${index + 1}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })}

        {/* Drop indicator at end of list */}
        {isDragging && (
          <div
            className={`drop-zone-end ${dragOverIndex === pages.length ? 'active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOverIndex(pages.length) }}
            onDrop={(e) => handleDrop(e, pages.length - 1)}
            onDragLeave={handleDragLeave}
          />
        )}

        {/* Add Page Button Tile */}
        <div
          className="add-page-tile"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Plus size={24} />
          <span>Add Page</span>
        </div>
      </div>
    </aside>
  )
}
