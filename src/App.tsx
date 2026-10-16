import React, { useEffect, useState, lazy, Suspense } from 'react'
import { heading } from './content/homepage.json'
import { Header } from './components/Layout/Header'
import { SiteFooter } from './components/Layout/SiteShell'
import { DocumentCanvas } from './components/Editor/DocumentCanvas'
import { FilterToolbar } from './components/Editor/FilterToolbar'
import { PageStrip } from './components/Pages/PageStrip'
import { SeoArticle } from './components/Content/SeoArticle'
import { useScanner } from './hooks/useScanner'
import { Loader2, AlertCircle, CheckCircle2, UploadCloud } from 'lucide-react'
import './styles/app.css'

const CameraModal = lazy(() =>
  import('./components/Camera/CameraModal').then((m) => ({ default: m.CameraModal })),
)
const ExportModal = lazy(() =>
  import('./components/Export/ExportModal').then((m) => ({ default: m.ExportModal })),
)

export const App: React.FC = () => {
  const {
    pages,
    activePageId,
    activePage,
    isProcessing,
    statusMessage,
    isError,
    storageWarning,
    editMode,
    editingQuad,
    canUndo,
    canRedo,
    setStatus,
    setActivePageId,
    addBlobAsPage,
    addBlobsAsPages,
    updateFilter,
    rotateActivePage,
    startEditCorners,
    cancelEditCorners,
    resetCorners,
    autoDetectCorners,
    applyPerspective,
    updateQuadCorner,
    movePage,
    reorderPages,
    removePage,
    clearAllPages,
    undoAction,
    redoAction,
  } = useScanner()

  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  // Handle file uploads (batch multi-image support)
  const handleAddFiles = async (files: FileList) => {
    if (isProcessing || isCameraOpen || isExportOpen) return
    const validImages: Blob[] = []
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      if (file.type.startsWith('image/')) {
        validImages.push(file)
      }
    }
    if (validImages.length > 0) {
      await addBlobsAsPages(validImages, 'magic')
    } else {
      setStatus('Choose image files such as JPG, PNG, or WebP. PDF import is not supported.', true)
    }
  }

  // Handle camera captures
  const handleCameraCapture = async (blob: Blob) => {
    await addBlobAsPage(blob, undefined, 'magic')
  }

  // Global drag-and-drop listener
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      const hasFiles = e.dataTransfer?.types
        ? Array.from(e.dataTransfer.types).includes('Files')
        : false
      if (!hasFiles) return

      e.preventDefault()
      if (isProcessing || isCameraOpen || isExportOpen) return
      setIsDraggingOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setIsDraggingOver(false)
      }
    }
    const onDrop = (e: DragEvent) => {
      const hasFiles = e.dataTransfer?.types
        ? Array.from(e.dataTransfer.types).includes('Files')
        : false
      if (!hasFiles) return

      e.preventDefault()
      setIsDraggingOver(false)
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleAddFiles(e.dataTransfer.files)
      }
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)

    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [isProcessing, isCameraOpen, isExportOpen])

  // Keyboard navigation + undo/redo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isCameraOpen || isExportOpen) {
        if (e.key === 'Escape') {
          setIsCameraOpen(false)
          setIsExportOpen(false)
        }
        return
      }

      if (e.key === 'Escape' && editMode) {
        cancelEditCorners()
        return
      }

      if (e.defaultPrevented || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target instanceof HTMLElement && e.target.isContentEditable)) {
        return
      }
      if (isProcessing) return
      const key = e.key.toLowerCase()

      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (canUndo) undoAction()
        return
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault()
        if (canRedo) redoAction()
        return
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (pages.length > 1 && !editMode) {
        const currentIdx = pages.findIndex((p) => p.id === activePageId)
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          const next = pages[(currentIdx + 1) % pages.length]
          setActivePageId(next.id)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          const prev = pages[(currentIdx - 1 + pages.length) % pages.length]
          setActivePageId(prev.id)
        }
      }

      if ((e.key === 'r' || e.key === 'R') && !editMode) {
        rotateActivePage()
      }
      if ((e.key === 'e' || e.key === 'E') && !editMode && activePage) {
        startEditCorners()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    isCameraOpen,
    isExportOpen,
    isProcessing,
    editMode,
    cancelEditCorners,
    pages,
    activePageId,
    setActivePageId,
    rotateActivePage,
    startEditCorners,
    activePage,
    canUndo,
    canRedo,
    undoAction,
    redoAction,
  ])

  return (
    <div className="scanner-app-shell">
      <div className="scanner-app-content" inert={isCameraOpen || isExportOpen}>
      {/* Top Header */}
      <Header
        pageCount={pages.length}
        isProcessing={isProcessing}
        onOpenCamera={() => setIsCameraOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onAddFiles={handleAddFiles}
        onClearAll={clearAllPages}
      />

      <div role="region" aria-labelledby="scanner-page-title">
      <h1 className="scanner-page-title" id="scanner-page-title">{heading}</h1>
      {storageWarning && <p className="scanner-storage-warning" role="alert">{storageWarning}</p>}
      </div>

      {/* Main Workspace Layout */}
      <main className="scanner-workspace">
        <section className="editor-main-area">
          {/* Active Page Meta Header */}
          {activePage && (
            <div className="page-meta-header">
              <span className="page-meta-title">{activePage.name}</span>
              <span className="page-meta-details">
                {activePage.width} × {activePage.height} px
                {editMode ? ' • EDITING CORNERS' : ` • ${activePage.filter.toUpperCase()}`}
              </span>
            </div>
          )}

          {/* Canvas & Corner Editor */}
          <DocumentCanvas
            page={activePage ?? null}
            editMode={editMode}
            editingQuad={editingQuad}
            onUpdateQuadCorner={updateQuadCorner}
            isProcessing={isProcessing}
            onOpenCamera={() => setIsCameraOpen(true)}
            onAddFiles={handleAddFiles}
          />

          {/* Bottom Filter & Actions Toolbar */}
          <FilterToolbar
            activePage={activePage ?? null}
            editMode={editMode}
            isProcessing={isProcessing}
            onUpdateFilter={updateFilter}
            onRotate={rotateActivePage}
            onStartEditCorners={startEditCorners}
            onCancelEditCorners={cancelEditCorners}
            onApplyPerspective={applyPerspective}
            onResetCorners={resetCorners}
            onAutoDetectCorners={autoDetectCorners}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undoAction}
            onRedo={redoAction}
          />
        </section>

        {/* Sidebar / Bottom Page Strip */}
        <PageStrip
          pages={pages}
          activePageId={activePageId}
          isProcessing={isProcessing}
          onSelectPage={setActivePageId}
          onMovePage={movePage}
          onReorderPages={reorderPages}
          onRemovePage={removePage}
          onAddFiles={handleAddFiles}
        />
      </main>

      {/* Global Status Bar */}
      <div className="scanner-status-bar" role="region" aria-label="Scanner status">
        <div className="status-indicator">
          {isProcessing ? (
            <Loader2 size={15} className="spin-icon text-brand" />
          ) : isError ? (
            <AlertCircle size={15} className="text-danger" />
          ) : (
            <CheckCircle2 size={15} className="text-brand" />
          )}
          <span className={`status-text ${isError ? 'error' : ''}`}>{statusMessage}</span>
        </div>

        <div className="status-shortcuts">
          <span>Ctrl+Z (Undo) • Ctrl+Y (Redo) • R (Rotate) • E (Crop) • Arrows (Nav) • Esc (Cancel)</span>
        </div>
      </div>

      {/* SEO, GEO & AEO Content Section */}
      <SeoArticle />

      <SiteFooter />
      </div>

      {/* Camera Capture Modal */}
      {isCameraOpen && (
        <Suspense fallback={null}>
          <CameraModal
            isOpen={isCameraOpen}
            onClose={() => setIsCameraOpen(false)}
            onCapture={handleCameraCapture}
          />
        </Suspense>
      )}

      {/* Export Dialog */}
      {isExportOpen && (
        <Suspense fallback={null}>
          <ExportModal
            isOpen={isExportOpen}
            onClose={() => setIsExportOpen(false)}
            pages={pages}
            activePage={activePage ?? null}
            setStatus={setStatus}
          />
        </Suspense>
      )}

      {/* Drag and Drop Full Screen Overlay */}
      {isDraggingOver && (
        <div className="drag-drop-overlay">
          <div className="drag-drop-card">
            <UploadCloud size={48} className="drag-drop-icon" />
            <h3>Drop Images Here</h3>
            <p>Your documents will be processed locally and private.</p>
          </div>
        </div>
      )}
    </div>
  )
}
