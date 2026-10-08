import React, { useEffect, useState, lazy, Suspense } from 'react'
import { Header } from './components/Layout/Header'
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
    editMode,
    editingQuad,
    canUndo,
    canRedo,
    setStatus,
    setActivePageId,
    addBlobAsPage,
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

  // Handle file uploads (batch support)
  const handleAddFiles = async (files: FileList) => {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      if (file.type.startsWith('image/')) {
        await addBlobAsPage(file, `Page ${pages.length + i + 1}`, 'magic')
      }
    }
  }

  // Handle camera captures
  const handleCameraCapture = async (blob: Blob) => {
    await addBlobAsPage(blob, `Page ${pages.length + 1}`, 'magic')
  }

  // Global drag-and-drop listener
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      setIsDraggingOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setIsDraggingOver(false)
      }
    }
    const onDrop = (e: DragEvent) => {
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
  }, [pages.length])

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

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (canUndo) undoAction()
        return
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        if (canRedo) redoAction()
        return
      }

      if (pages.length > 1) {
        const currentIdx = pages.findIndex((p) => p.id === activePageId)
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          const next = pages[(currentIdx + 1) % pages.length]
          setActivePageId(next.id)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
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
      {/* Top Header */}
      <Header
        pageCount={pages.length}
        isProcessing={isProcessing}
        onOpenCamera={() => setIsCameraOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onAddFiles={handleAddFiles}
        onClearAll={clearAllPages}
      />

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
      <footer className="scanner-status-bar">
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
      </footer>

      {/* SEO, GEO & AEO Content Section */}
      <SeoArticle />

      {/* Modern Accessible Light Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <p className="footer-copy">
            <strong>Scanner.cam</strong> — 100% Client-Side Private Online Document Scanner & CamScanner Alternative.
            No server uploads, no watermarks, no accounts required.
          </p>
          <div className="footer-links">
            <a href="/blog" className="footer-nav-link">Guides & Tutorials</a>
            <span>•</span>
            <span>100% Free & Open Web Tool</span>
            <span>•</span>
            <span>Client-Side Web Workers</span>
            <span>•</span>
            <span>Zero Cloud Storage</span>
          </div>
          <div className="footer-tags">
            <a href="/blog/how-to-scan-id-card-online" className="footer-tag">Scan ID Card Online</a>
            <a href="/blog/how-to-scan-receipts-for-expenses" className="footer-tag">Scan Receipts for Expenses</a>
            <a href="/blog/scan-multi-page-pdf-online-free" className="footer-tag">Multi-Page PDF Scanner</a>
            <a href="/blog/camscanner-vs-free-online-alternatives" className="footer-tag">Free CamScanner Alternative</a>
            <a href="/blog/how-to-scan-documents-iphone-without-app" className="footer-tag">Scan on iPhone (No App)</a>
            <a href="/blog/how-to-scan-documents-android-without-app" className="footer-tag">Scan on Android (No App)</a>
            <a href="/blog/is-it-safe-to-scan-documents-online" className="footer-tag">Private Document Scanner</a>
          </div>
        </div>
      </footer>

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
