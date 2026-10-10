import React, { useRef } from 'react'
import { Camera, Upload, Download, ShieldCheck, Trash2, BookOpen } from 'lucide-react'

interface HeaderProps {
  pageCount: number
  isProcessing: boolean
  onOpenCamera: () => void
  onOpenExport: () => void
  onAddFiles: (files: FileList) => void
  onClearAll: () => void
}

export const Header: React.FC<HeaderProps> = ({
  pageCount,
  isProcessing,
  onOpenCamera,
  onOpenExport,
  onAddFiles,
  onClearAll,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(e.target.files)
      e.target.value = ''
    }
  }

  const handleClearClick = () => {
    if (pageCount === 0) return
    if (window.confirm('Are you sure you want to clear all scanned pages?')) {
      onClearAll()
    }
  }

  return (
    <header className="app-header">
      <div className="brand-section">
        <div className="brand-logo-wrap">
          <div className="brand-icon">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h1 className="brand-name">Scanner.cam</h1>
            <p className="brand-tagline">Client-Side Private Scanner</p>
          </div>
        </div>

        <div className="privacy-pill">
          <span className="privacy-dot" />
          <span>Zero Server Uploads</span>
        </div>
      </div>

      <div className="header-actions">
        <a
          href="/blog"
          className="btn btn-ghost header-guides-link"
          title="Document Scanning Guides & Tutorials"
        >
          <BookOpen size={15} />
          <span>Guides</span>
        </a>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          <Upload size={16} />
          <span>Upload</span>
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onOpenCamera}
          disabled={isProcessing}
        >
          <Camera size={16} />
          <span>Scan Camera</span>
        </button>

        <button
          type="button"
          className="btn btn-accent"
          onClick={onOpenExport}
          disabled={pageCount === 0 || isProcessing}
        >
          <Download size={16} />
          <span>Export {pageCount > 0 ? `(${pageCount})` : ''}</span>
        </button>

        {pageCount > 0 && (
          <button
            type="button"
            className="btn btn-danger-subtle"
            onClick={handleClearClick}
            disabled={isProcessing}
            title="Clear all pages"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </header>
  )
}
