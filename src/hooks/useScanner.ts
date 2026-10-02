import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FilterMode, Point, Quad, ScanPage } from '../core/cv/types'
import { cvWorker } from '../core/workers/workerClient'
import { cloneQuad, defaultQuad, isConvexQuad, polygonArea } from '../core/cv/homography'
import { scanDb } from '../core/storage/scanDb'
import { useHistory } from './useHistory'

export function useScanner() {
  const [pages, setPages] = useState<ScanPage[]>([])
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Ready.')
  const [isError, setIsError] = useState(false)

  // Corner perspective editing state
  const [editMode, setEditMode] = useState(false)
  const [editingQuad, setEditingQuad] = useState<Quad | null>(null)

  const { pushHistory, undo, redo, canUndo, canRedo } = useHistory([], null)

  const setStatus = useCallback((msg: string, error = false) => {
    setStatusMessage(msg)
    setIsError(error)
  }, [])

  // Helper: update pages + sync to history + IndexedDB
  const commitPages = useCallback(
    (newPages: ScanPage[], newActiveId: string | null, skipHistory = false) => {
      setPages(newPages)
      setActivePageId(newActiveId)
      if (!skipHistory) {
        pushHistory(newPages, newActiveId)
      }
    },
    [pushHistory],
  )

  // Restore scans from IndexedDB on initial mount
  useEffect(() => {
    let mounted = true
    scanDb
      .loadAllPages()
      .then((restored) => {
        if (!mounted || restored.length === 0) return
        setPages(restored)
        setActivePageId(restored[0].id)
        pushHistory(restored, restored[0].id)
        setStatus(`Restored ${restored.length} page${restored.length > 1 ? 's' : ''} from session.`)
      })
      .catch((err) => {
        console.warn('Failed to restore pages from IndexedDB:', err)
      })
    return () => {
      mounted = false
    }
  }, [setStatus, pushHistory])

  // Sync state changes to IndexedDB
  useEffect(() => {
    if (pages.length > 0) {
      scanDb.saveAllPages(pages).catch(console.error)
    } else {
      scanDb.clearAll().catch(console.error)
    }
  }, [pages])

  const activePage = useMemo(() => {
    return pages.find((p) => p.id === activePageId)
  }, [pages, activePageId])

  const addBlobAsPage = useCallback(
    async (blob: Blob, customName?: string, defaultFilter: FilterMode = 'magic') => {
      setIsProcessing(true)
      setStatus('Processing image...')

      try {
        const rawImg = await cvWorker.blobToImage(blob)
        const rawWidth = rawImg.naturalWidth
        const rawHeight = rawImg.naturalHeight

        // Auto-detect document quad corners
        let initialQuad: Quad
        try {
          initialQuad = await cvWorker.detectQuad(blob)
        } catch {
          initialQuad = defaultQuad(rawWidth, rawHeight)
        }

        // Warp perspective and apply filter
        const warped = await cvWorker.warpAndFilter(blob, initialQuad, defaultFilter)
        const pageName = customName || `Page ${pages.length + 1}`

        const newPage: ScanPage = {
          id: crypto.randomUUID(),
          name: pageName,
          blob: warped.blob,
          previewUrl: URL.createObjectURL(warped.blob),
          width: warped.width,
          height: warped.height,
          filter: defaultFilter,
          quad: initialQuad,
          rawBlob: blob,
          rawWidth,
          rawHeight,
          createdAt: Date.now(),
        }

        const newPages = [...pages, newPage]
        commitPages(newPages, newPage.id)
        setEditMode(false)
        setEditingQuad(null)
        setStatus(`${pageName} added.`)
      } catch (err: unknown) {
        console.error(err)
        setStatus('Failed to process image. Try another file.', true)
      } finally {
        setIsProcessing(false)
      }
    },
    [pages, setStatus, commitPages],
  )

  const updateFilter = useCallback(
    async (filter: FilterMode) => {
      if (!activePage || editMode) return
      setIsProcessing(true)
      setStatus(`Applying ${filter} filter...`)

      try {
        // Re-warp from rawBlob with existing quad and new filter
        const result = await cvWorker.warpAndFilter(activePage.rawBlob, activePage.quad, filter)

        const newPages = pages.map((p) => {
          if (p.id !== activePage.id) return p
          URL.revokeObjectURL(p.previewUrl)
          return {
            ...p,
            blob: result.blob,
            previewUrl: URL.createObjectURL(result.blob),
            width: result.width,
            height: result.height,
            filter,
          }
        })
        commitPages(newPages, activePageId)
        setStatus(`${activePage.name} updated with ${filter} filter.`)
      } catch (err) {
        console.error(err)
        setStatus('Filter update failed.', true)
      } finally {
        setIsProcessing(false)
      }
    },
    [activePage, editMode, setStatus, pages, activePageId, commitPages],
  )

  const rotateActivePage = useCallback(async () => {
    if (!activePage || editMode) return
    setIsProcessing(true)
    setStatus('Rotating page...')

    try {
      // Rotate both rawBlob and output
      const rotatedRaw = await cvWorker.rotateBlob90(activePage.rawBlob)
      const rawImg = await cvWorker.blobToImage(rotatedRaw)
      const rotatedWidth = rawImg.naturalWidth
      const rotatedHeight = rawImg.naturalHeight

      // Reset quad for rotated coordinates
      const newQuad = defaultQuad(rotatedWidth, rotatedHeight)
      const warped = await cvWorker.warpAndFilter(rotatedRaw, newQuad, activePage.filter)

      const newPages = pages.map((p) => {
        if (p.id !== activePage.id) return p
        URL.revokeObjectURL(p.previewUrl)
        return {
          ...p,
          blob: warped.blob,
          previewUrl: URL.createObjectURL(warped.blob),
          rawBlob: rotatedRaw,
          rawWidth: rotatedWidth,
          rawHeight: rotatedHeight,
          width: warped.width,
          height: warped.height,
          quad: newQuad,
        }
      })
      commitPages(newPages, activePageId)
      setStatus(`${activePage.name} rotated.`)
    } catch (err) {
      console.error(err)
      setStatus('Unable to rotate page.', true)
    } finally {
      setIsProcessing(false)
    }
  }, [activePage, editMode, setStatus, pages, activePageId, commitPages])

  const startEditCorners = useCallback(() => {
    if (!activePage) return
    setEditMode(true)
    setEditingQuad(cloneQuad(activePage.quad))
    setStatus('Corner edit mode enabled. Drag handles, then apply.')
  }, [activePage, setStatus])

  const cancelEditCorners = useCallback(() => {
    setEditMode(false)
    setEditingQuad(null)
    setStatus('Corner editing canceled.')
  }, [setStatus])

  const resetCorners = useCallback(() => {
    if (!activePage || !editMode) return
    setEditingQuad(defaultQuad(activePage.rawWidth, activePage.rawHeight))
    setStatus('Corners reset to full image frame.')
  }, [activePage, editMode, setStatus])

  const autoDetectCorners = useCallback(async () => {
    if (!activePage) return
    setIsProcessing(true)
    setStatus('Detecting document borders...')

    try {
      const quad = await cvWorker.detectQuad(activePage.rawBlob)
      setEditMode(true)
      setEditingQuad(quad)
      setStatus('Corners proposed. Adjust handles and apply.')
    } catch (err) {
      console.error(err)
      setStatus('Auto edge detection could not find high contrast borders.', true)
    } finally {
      setIsProcessing(false)
    }
  }, [activePage, setStatus])

  const applyPerspective = useCallback(async () => {
    if (!activePage || !editingQuad) return

    const area = polygonArea(editingQuad)
    const minArea = activePage.rawWidth * activePage.rawHeight * 0.03

    if (!isConvexQuad(editingQuad) || area < minArea) {
      setStatus('Invalid quad shape. Corners must form a convex polygon covering document.', true)
      return
    }

    setIsProcessing(true)
    setStatus('Applying perspective transformation...')

    try {
      const warped = await cvWorker.warpAndFilter(
        activePage.rawBlob,
        editingQuad,
        activePage.filter,
      )

      const newPages = pages.map((p) => {
        if (p.id !== activePage.id) return p
        URL.revokeObjectURL(p.previewUrl)
        return {
          ...p,
          blob: warped.blob,
          previewUrl: URL.createObjectURL(warped.blob),
          width: warped.width,
          height: warped.height,
          quad: cloneQuad(editingQuad),
        }
      })
      commitPages(newPages, activePageId)
      setEditMode(false)
      setEditingQuad(null)
      setStatus(`${activePage.name} perspective corrected.`)
    } catch (err) {
      console.error(err)
      setStatus('Perspective correction failed.', true)
    } finally {
      setIsProcessing(false)
    }
  }, [activePage, editingQuad, setStatus, pages, activePageId, commitPages])

  const updateQuadCorner = useCallback((index: number, pt: Point) => {
    setEditingQuad((prev) => {
      if (!prev) return prev
      const next: Quad = cloneQuad(prev)
      next[index] = pt
      return next
    })
  }, [])

  const movePage = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const idx = pages.findIndex((p) => p.id === id)
      if (idx < 0) return
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1
      if (targetIdx < 0 || targetIdx >= pages.length) return

      const copy = [...pages]
      const [item] = copy.splice(idx, 1)
      copy.splice(targetIdx, 0, item)
      commitPages(copy, activePageId)
    },
    [pages, activePageId, commitPages],
  )

  /**
   * Reorder pages by moving a page from `fromIndex` to `toIndex` (for drag-and-drop).
   */
  const reorderPages = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return
      const copy = [...pages]
      const [item] = copy.splice(fromIndex, 1)
      copy.splice(toIndex, 0, item)
      commitPages(copy, activePageId)
    },
    [pages, activePageId, commitPages],
  )

  const removePage = useCallback(
    (id: string) => {
      const idx = pages.findIndex((p) => p.id === id)
      if (idx < 0) return
      const copy = [...pages]
      const [removed] = copy.splice(idx, 1)
      URL.revokeObjectURL(removed.previewUrl)

      const newActive =
        activePageId === id
          ? (copy[idx] || copy[idx - 1] || null)?.id ?? null
          : activePageId

      setStatus(`${removed.name} removed.`)
      setEditMode(false)
      setEditingQuad(null)
      commitPages(copy, newActive)
    },
    [pages, activePageId, setStatus, commitPages],
  )

  const clearAllPages = useCallback(() => {
    pages.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    setEditMode(false)
    setEditingQuad(null)
    commitPages([], null)
    setStatus('All pages cleared.')
  }, [pages, setStatus, commitPages])

  /** Undo last page operation */
  const undoAction = useCallback(() => {
    const entry = undo()
    if (!entry) return
    // Revoke any previewUrls that are going away would be complex; instead we simply restore state.
    // The old Blobs remain referenced so they stay alive.
    setPages(entry.pages)
    setActivePageId(entry.activePageId)
    setEditMode(false)
    setEditingQuad(null)
    setStatus('Undone.')
  }, [undo, setStatus])

  /** Redo last undone operation */
  const redoAction = useCallback(() => {
    const entry = redo()
    if (!entry) return
    setPages(entry.pages)
    setActivePageId(entry.activePageId)
    setEditMode(false)
    setEditingQuad(null)
    setStatus('Redone.')
  }, [redo, setStatus])

  return {
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
  }
}
