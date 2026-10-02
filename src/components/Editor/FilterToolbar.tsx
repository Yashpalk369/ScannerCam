import React from 'react'
import {
  Sparkles,
  Contrast,
  Sliders,
  Layers,
  Image as ImageIcon,
  RotateCw,
  Crop,
  Check,
  X,
  Wand2,
  RotateCcw,
} from 'lucide-react'
import type { FilterMode, ScanPage } from '../../core/cv/types'

interface FilterToolbarProps {
  activePage: ScanPage | null
  editMode: boolean
  isProcessing: boolean
  onUpdateFilter: (filter: FilterMode) => void
  onRotate: () => void
  onStartEditCorners: () => void
  onCancelEditCorners: () => void
  onApplyPerspective: () => void
  onResetCorners: () => void
  onAutoDetectCorners: () => void
}

const FILTERS: { id: FilterMode; label: string; icon: React.FC<{ size?: number }> }[] = [
  { id: 'magic', label: 'Magic Color', icon: Sparkles },
  { id: 'bw', label: 'Clean B/W', icon: Contrast },
  { id: 'enhance', label: 'Enhance', icon: Sliders },
  { id: 'grayscale', label: 'Gray', icon: Layers },
  { id: 'original', label: 'Original', icon: ImageIcon },
]

export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  activePage,
  editMode,
  isProcessing,
  onUpdateFilter,
  onRotate,
  onStartEditCorners,
  onCancelEditCorners,
  onApplyPerspective,
  onResetCorners,
  onAutoDetectCorners,
}) => {
  const hasPage = Boolean(activePage)

  return (
    <div className="filter-toolbar">
      {/* Corner Editing Controls */}
      {editMode ? (
        <div className="toolbar-group edit-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onApplyPerspective}
            disabled={isProcessing}
          >
            <Check size={16} />
            <span>Apply Perspective</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onAutoDetectCorners}
            disabled={isProcessing}
            title="Auto detect document edges"
          >
            <Wand2 size={16} />
            <span>Auto Detect</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onResetCorners}
            disabled={isProcessing}
            title="Reset corners to full frame"
          >
            <RotateCcw size={16} />
            <span>Reset Corners</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancelEditCorners}
            disabled={isProcessing}
          >
            <X size={16} />
            <span>Cancel</span>
          </button>
        </div>
      ) : (
        <div className="toolbar-row">
          {/* Filter Selection Pills */}
          <div className="toolbar-group filters-group">
            {FILTERS.map((f) => {
              const Icon = f.icon
              const isActive = activePage?.filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`filter-pill ${isActive ? 'active' : ''}`}
                  onClick={() => onUpdateFilter(f.id)}
                  disabled={!hasPage || isProcessing}
                >
                  <Icon size={14} />
                  <span>{f.label}</span>
                </button>
              )
            })}
          </div>

          {/* Quick Actions: Rotate & Crop */}
          <div className="toolbar-group page-actions">
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={onRotate}
              disabled={!hasPage || isProcessing}
              title="Rotate 90° clockwise"
            >
              <RotateCw size={16} />
              <span>Rotate</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={onStartEditCorners}
              disabled={!hasPage || isProcessing}
              title="Adjust perspective corners"
            >
              <Crop size={16} />
              <span>Edit Corners</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
