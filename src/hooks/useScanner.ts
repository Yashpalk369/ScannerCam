import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FilterMode, Point, Quad, ScanPage } from '../core/cv/types'
import { cvWorker } from '../core/workers/workerClient'
import { cloneQuad, defaultQuad, isConvexQuad, polygonArea } from '../core/cv/homography'
import { scanDb } from '../core/storage/scanDb'
import { useHistory } from './useHistory'

export function useScanner() {
  const [pages, setPages] = useState<ScanPage[]>([])
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isRestoring, setIsRestoring] = useState(true)
  const [statusMessage, setStatusMessage] = useState('Ready.')
  const [isError, setIsError] = useState(false)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const hasInitializedDbRef = useRef(false)
  const hasRestoredStorageRef = useRef(false)
  const pagesRef = useRef<ScanPage[]>([])

  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  // Corner perspective editing state
  const [editMode, setEditMode] = useState(false)
  const [editingQuad, setEditingQuad] = useState<Quad | null>(null)

  const { pushHistory, resetHistory, undo, redo, canUndo, canRedo } = useHistory([], null)

  const setStatus = useCallback((msg: string, error = false) => {
    setStatusMessage(msg)
    setIsError(error)
  }, [])

  // Helper: update pages + sync to history + IndexedDB
  const commitPages = useCallback(
    (newPages: ScanPage[], newActiveId: string | null, skipHistory = false) => {
      pagesRef.current = newPages
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
        if (!mounted) {
          restored.forEach(page => URL.revokeObjectURL(page.previewUrl))
          return
        }
        hasRestoredStorageRef.current = true
        if (restored.length > 0) {
          setPages(restored)
          setActivePageId(restored[0].id)
          resetHistory(restored, restored[0].id)
          setStatus(`Restored ${restored.length} page${restored.length > 1 ? 's' : ''} from session.`)
        }
      })
      .catch((err) => {
        console.warn('Failed to restore pages from IndexedDB:', err)
        if (mounted) setStorageWarning('Saved scans could not be restored. New scans will stay in this tab only; download them before closing. Reload to retry recovery.')
      })
      .finally(() => {
        if (mounted) {
          hasInitializedDbRef.current = true
          setIsRestoring(false)
        }
      })
    return () => {
      mounted = false
    }
  }, [setStatus, resetHistory])

  // Sync state changes to IndexedDB (only after initial load has completed)
  useEffect(() => {
    if (!hasInitializedDbRef.current || !hasRestoredStorageRef.current) return
    let current = true
    const update = pages.length > 0 ? scanDb.saveAllPages(pages) : scanDb.clearAll()
    update.then(() => { if (current) setStorageWarning(null) }).catch(error => {
      console.warn('Could not update saved scans:', error)
      if (current) setStorageWarning(pages.length > 0
        ? 'These scans could not be saved for recovery. Download them before closing this tab.'
        : 'Saved scans could not be cleared and may reappear after reload. Clear this site’s browser storage to remove them.')
    })
    return () => { current = false }
  }, [pages])

  const activePage = useMemo(() => {
    return pages.find((p) => p.id === activePageId)
  }, [pages, activePageId])

  useEffect(() => {
    setEditMode(false)
    setEditingQuad(null)
  }, [activePageId])

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
        const currentPages = pagesRef.current
        const pageName = customName || `Page ${currentPages.length + 1}`

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

        const newPages = [...currentPages, newPage]
        pagesRef.current = newPages
        commitPages(newPages, newPage.id)
        setEditMode(false)
        setEditingQuad(null)
        setStatus(`${pageName} added.`)
      } catch (err: unknown) {
        console.error(err)
        setStatus('Failed to process image. Try another file.', true)
        throw new Error('Failed to process the captured image.')
      } finally {
        setIsProcessing(false)
      }
    },
    [setStatus, commitPages],
  )

  const addBlobsAsPages = useCallback(
    async (blobs: Blob[], defaultFilter: FilterMode = 'magic') => {
      if (blobs.length === 0) return
      setIsProcessing(true)
      setStatus(`Processing 1 of ${blobs.length} images...`)

      const newPagesList: ScanPage[] = []
      let failedImages = 0

      try {
        for (let i = 0; i < blobs.length; i += 1) {
          const blob = blobs[i]
          setStatus(`Processing image ${i + 1} of ${blobs.length}...`)
          try {
            const rawImg = await cvWorker.blobToImage(blob)
            const rawWidth = rawImg.naturalWidth
            const rawHeight = rawImg.naturalHeight

            let initialQuad: Quad
            try {
              initialQuad = await cvWorker.detectQuad(blob)
            } catch {
              initialQuad = defaultQuad(rawWidth, rawHeight)
            }

            const warped = await cvWorker.warpAndFilter(blob, initialQuad, defaultFilter)
            const currentTotal = pagesRef.current.length + newPagesList.length
            const pageName = `Page ${currentTotal + 1}`

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

            newPagesList.push(newPage)
          } catch (error) {
            console.warn('Could not read image:', error)
            failedImages += 1
          }
        }

        const combinedPages = [...pagesRef.current, ...newPagesList]
        pagesRef.current = combinedPages
        const lastPage = newPagesList[newPagesList.length - 1]
        if (newPagesList.length) commitPages(combinedPages, lastPage!.id)
        setEditMode(false)
        setEditingQuad(null)
        const warning = failedImages ? ` ${failedImages} image${failedImages === 1 ? ' could' : 's could'} not be read. Try JPG, PNG, or WebP files.` : ''
        setStatus(`Added ${newPagesList.length} page${newPagesList.length > 1 ? 's' : ''}.${warning}`, failedImages > 0)
      } catch (err: unknown) {
        console.error(err)
        setStatus('Failed to process some images. Try another file.', true)
      } finally {
        setIsProcessing(false)
      }
    },
    [setStatus, commitPages],
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

      // Rotate the selected boundary along with the source, preserving its crop.
      const quad = activePage.quad
      const newQuad = [quad[3], quad[0], quad[1], quad[2]].map(point => ({
        x: activePage.rawHeight - 1 - point.y,
        y: point.x,
      })) as Quad
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

  const clearAllPages = useCallback(async () => {
    setIsProcessing(true)
    try {
      if (hasRestoredStorageRef.current) await scanDb.clearAll()
      pagesRef.current.forEach(page => URL.revokeObjectURL(page.previewUrl))
      setEditMode(false)
      setEditingQuad(null)
      commitPages([], null, true)
      resetHistory([], null)
      setStatus(hasRestoredStorageRef.current ? 'All pages cleared.' : 'Current pages cleared. Saved session recovery remains unavailable.')
    } catch (error) {
      console.warn('Could not clear saved scans:', error)
      setStorageWarning('Saved scans could not be cleared. Your pages are unchanged. Retry clearing, or clear this site’s browser storage.')
      setStatus('Could not clear saved scans. Your pages are unchanged.', true)
    } finally { setIsProcessing(false) }
  }, [setStatus, commitPages, resetHistory])

  /** Undo last page operation */
  const undoAction = useCallback(() => {
    const entry = undo()
    if (!entry) return
    pagesRef.current.forEach(page => URL.revokeObjectURL(page.previewUrl))
    // Re-create object URLs for any pages that might have had their previous URLs revoked
    const restoredPages = entry.pages.map((p) => ({
      ...p,
      previewUrl: URL.createObjectURL(p.blob),
    }))
    commitPages(restoredPages, entry.activePageId, true)
    setEditMode(false)
    setEditingQuad(null)
    setStatus('Undone.')
  }, [undo, setStatus, commitPages])

  /** Redo last undone operation */
  const redoAction = useCallback(() => {
    const entry = redo()
    if (!entry) return
    pagesRef.current.forEach(page => URL.revokeObjectURL(page.previewUrl))
    const restoredPages = entry.pages.map((p) => ({
      ...p,
      previewUrl: URL.createObjectURL(p.blob),
    }))
    commitPages(restoredPages, entry.activePageId, true)
    setEditMode(false)
    setEditingQuad(null)
    setStatus('Redone.')
  }, [redo, setStatus, commitPages])

  return {
    pages,
    activePageId,
    activePage,
    isProcessing: isProcessing || isRestoring,
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
  }
}
