import React, { useRef } from 'react'
import { SiteHeader } from './SiteShell'
import { Camera, Upload, Download, Trash2 } from 'lucide-react'

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
    <>
      <SiteHeader />
      <div className="scanner-toolbar" role="region" aria-label="Scanner tools" hidden={pageCount === 0}>
        <div className="privacy-pill">
          <span className="privacy-dot" />
          <span>Zero Server Uploads</span>
        </div>
        <div className="header-actions">
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
          aria-label="Upload"
          disabled={isProcessing}
        >
          <Upload size={16} />
          <span>Upload</span>
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onOpenCamera}
          aria-label="Scan Camera"
          disabled={isProcessing}
        >
          <Camera size={16} />
          <span>Scan Camera</span>
        </button>

        <button
          type="button"
          className="btn btn-accent"
          onClick={onOpenExport}
          aria-label={pageCount > 0 ? `Export (${pageCount})` : 'Export'}
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
      </div>
    </>
  )
}
