import { useEffect, useRef, useState } from 'react'
import type { ScanPage } from '../../core/cv/types'
import { editRaster } from '../../core/image/edits'
import type { Redaction } from '../../core/image/edits'

export function PageTools({
  page,
  mode,
  onClose,
  onApply,
}: {
  page: ScanPage
  mode: 'redact' | 'flatten'
  onClose: () => void
  onApply: (blob: Blob) => Promise<void>
}) {
  const [rects, setRects] = useState<Redaction[]>([])
  const [draft, setDraft] = useState<Redaction | null>(null)
  const [top, setTop] = useState(0),
    [bottom, setBottom] = useState(0)
  const [preview, setPreview] = useState(page.previewUrl)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const start = useRef<{ x: number; y: number } | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      old?.focus()
    }
  }, [])
  useEffect(() => {
    if (mode !== 'flatten') return
    let cancelled = false,
      url = ''
    const timer = setTimeout(async () => {
      try {
        const blob = await editRaster(page.blob, [], top / 100, bottom / 100)
        if (!cancelled) {
          url = URL.createObjectURL(blob)
          setPreview(url)
        }
      } catch {
        if (!cancelled) setError('Could not prepare the curve preview.')
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (url) URL.revokeObjectURL(url)
    }
  }, [mode, page.blob, top, bottom])
  const coordinate = (event: React.PointerEvent<SVGSVGElement>) => {
    const r = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
    }
  }
  const apply = async () => {
    setBusy(true)
    setError('')
    try {
      await onApply(await editRaster(page.blob, rects, top / 100, bottom / 100))
      onClose()
    } catch {
      setError('Could not save the edit. Your page is unchanged.')
      setBusy(false)
    }
  }
  return (
    <div className="modal-overlay">
      <div
        className="modal-dialog page-tools-dialog"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="page-tools-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onClose()
          if (event.key === 'Tab') {
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled)',
              ),
            ]
            const first = controls[0],
              last = controls[controls.length - 1]
            if (
              event.shiftKey &&
              [first, dialog.current].includes(
                document.activeElement as HTMLElement,
              )
            ) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <div className="modal-header">
          <h2 id="page-tools-title">
            {mode === 'redact'
              ? 'Redact sensitive information'
              : 'Flatten a curved page'}
          </h2>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
        <div className="modal-body">
          <p>
            {mode === 'redact'
              ? 'Draw boxes over sensitive details. Applied boxes replace the image pixels in downloads. The original and undo history remain on this device until you clear saved scans.'
              : 'Adjust the top and bottom bends until curved lines look straighter. This manual correction works best for gentle page curves; review the preview before applying.'}
          </p>
          <div
            className="page-edit-preview"
            style={{ aspectRatio: `${page.width}/${page.height}` }}
          >
            <img src={preview} alt="Page edit preview" />
            {mode === 'redact' && (
              <svg
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-label="Draw redaction boxes"
                onPointerDown={(event) => {
                  if (busy) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  start.current = coordinate(event)
                }}
                onPointerMove={(event) => {
                  if (!start.current) return
                  const p = coordinate(event),
                    a = start.current
                  setDraft({
                    x: Math.min(p.x, a.x),
                    y: Math.min(p.y, a.y),
                    width: Math.abs(p.x - a.x),
                    height: Math.abs(p.y - a.y),
                  })
                }}
                onPointerUp={(event) => {
                  if (!start.current) return
                  const p = coordinate(event),
                    a = start.current
                  const r = {
                    x: Math.min(p.x, a.x),
                    y: Math.min(p.y, a.y),
                    width: Math.abs(p.x - a.x),
                    height: Math.abs(p.y - a.y),
                  }
                  if (r.width > 0.002 && r.height > 0.002)
                    setRects([...rects, r])
                  start.current = null
                  setDraft(null)
                }}
                onPointerCancel={() => {
                  start.current = null
                  setDraft(null)
                }}
              >
                {[...rects, ...(draft ? [draft] : [])].map((r, i) => (
                  <rect key={i} {...r} fill="black" />
                ))}
              </svg>
            )}
          </div>
          {mode === 'redact' ? (
            <>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() =>
                  setRects([
                    ...rects,
                    { x: 0.1, y: 0.1, width: 0.3, height: 0.1 },
                  ])
                }
              >
                Add redaction box
              </button>
              {rects.map((r, index) => (
                <fieldset key={index} className="redaction-coordinates">
                  <legend>Box {index + 1}</legend>
                  {(['x', 'y', 'width', 'height'] as const).map((key) => (
                    <label key={key}>
                      {key} (%)
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round(r[key] * 100)}
                        disabled={busy}
                        onChange={(event) => {
                          const value = Math.min(
                            1,
                            Math.max(0, Number(event.target.value) / 100),
                          )
                          setRects(
                            rects.map((rect, i) =>
                              i === index ? { ...rect, [key]: value } : rect,
                            ),
                          )
                        }}
                      />
                    </label>
                  ))}
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() =>
                      setRects(rects.filter((_, i) => i !== index))
                    }
                  >
                    Remove box {index + 1}
                  </button>
                </fieldset>
              ))}
            </>
          ) : (
            <>
              {[
                ['Top edge bend', top, setTop],
                ['Bottom edge bend', bottom, setBottom],
              ].map(([label, value, setter]) => (
                <label className="curve-control" key={label as string}>
                  {label as string}: {value as number}%
                  <input
                    type="range"
                    min={-25}
                    max={25}
                    value={value as number}
                    disabled={busy}
                    onChange={(event) =>
                      (setter as (v: number) => void)(
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
              ))}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              (mode === 'redact'
                ? !rects.length ||
                  rects.some(
                    (r) =>
                      r.width <= 0 || r.height <= 0 || r.x >= 1 || r.y >= 1,
                  )
                : !top && !bottom)
            }
            onClick={() => void apply()}
          >
            {busy
              ? 'Applying…'
              : mode === 'redact'
                ? 'Apply redactions'
                : 'Apply curve correction'}
          </button>
        </div>
      </div>
    </div>
  )
}
