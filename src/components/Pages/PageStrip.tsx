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
  const listRef = useRef<HTMLDivElement>(null)
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(e.target.files)
      e.target.value = ''
    }
  }

  const navigatePage = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const movement = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (movement === undefined && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    event.stopPropagation()
    if (isProcessing) return
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : (index + movement! + pages.length) % pages.length
    onSelectPage(pages[next].id)
    listRef.current?.querySelectorAll<HTMLButtonElement>('.page-thumbnail-select')[next]?.focus()
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

      <div ref={listRef} className="thumbnails-scroll-container" role="list" aria-label="Scanned pages">
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
              role="listitem"
            >
              {/* Drag grip handle */}
              <div
                className="drag-grip"
                title="Drag to reorder"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <GripVertical size={14} />
              </div>

              <button type="button" className="page-thumbnail-select" aria-label={`Select page ${index + 1}: ${page.name}`} aria-current={isActive ? 'page' : undefined} disabled={isProcessing} onClick={() => onSelectPage(page.id)} onKeyDown={event => navigatePage(event, index)}>
              <div className="thumbnail-preview-wrap">
                <img src={page.previewUrl} alt="" className="thumbnail-img" draggable={false} />
                <span className="page-number-pill">{index + 1}</span>
              </div>

              <div className="thumbnail-info">
                <p className="page-name">{page.name}</p>
                <p className="page-dims">
                  {page.width}×{page.height} • {page.filter}
                </p>
              </div>

              </button>

              <div className="thumbnail-actions" onClick={(e) => e.stopPropagation()}>
                {pages.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="btn-tiny"
                      disabled={isProcessing || index === 0}
                      onClick={() => onMovePage(page.id, 'up')}
                      title="Move page up"
                      aria-label={`Move page ${index + 1} up`}
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn-tiny"
                      disabled={isProcessing || index === pages.length - 1}
                      onClick={() => onMovePage(page.id, 'down')}
                      title="Move page down"
                      aria-label={`Move page ${index + 1} down`}
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

        <div className="add-page-slot" role="listitem">
          <button type="button" className="add-page-tile" disabled={isProcessing} onClick={() => fileInputRef.current?.click()}>
            <Plus size={24} /><span>Add Page</span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileChange} />
        </div>
      </div>
    </aside>
  )
}
