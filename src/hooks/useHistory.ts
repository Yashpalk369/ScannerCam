import { useCallback, useRef, useState } from 'react'
import type { ScanPage } from '../core/cv/types'

const MAX_HISTORY = 20

interface HistoryEntry {
  pages: ScanPage[]
  activePageId: string | null
}

/**
 * Generic undo/redo history manager for the scanner page list.
 * Stores deep snapshots of the pages array on each meaningful change.
 * Note: ScanPage contains Blob references — we do NOT clone Blobs (they are immutable and shared safely).
 */
export function useHistory(
  initialPages: ScanPage[],
  initialActiveId: string | null,
) {
  const historyRef = useRef<HistoryEntry[]>([{ pages: initialPages, activePageId: initialActiveId }])
  const cursorRef = useRef(0)

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const syncFlags = useCallback(() => {
    setCanUndo(cursorRef.current > 0)
    setCanRedo(cursorRef.current < historyRef.current.length - 1)
  }, [])

  /** Push a new snapshot onto the history stack (clears any forward redo history). */
  const pushHistory = useCallback(
    (pages: ScanPage[], activePageId: string | null) => {
      // Trim any redo history beyond the current cursor
      historyRef.current = historyRef.current.slice(0, cursorRef.current + 1)

      // Enforce max history depth
      if (historyRef.current.length >= MAX_HISTORY) {
        historyRef.current.shift()
        cursorRef.current = Math.max(0, cursorRef.current - 1)
      }

      historyRef.current.push({ pages: [...pages], activePageId })
      cursorRef.current = historyRef.current.length - 1
      syncFlags()
    },
    [syncFlags],
  )

  /** Undo: step back one in history. Returns the previous state, or null if nothing to undo. */
  const undo = useCallback((): HistoryEntry | null => {
    if (cursorRef.current <= 0) return null
    cursorRef.current -= 1
    syncFlags()
    return historyRef.current[cursorRef.current]
  }, [syncFlags])

  /** Redo: step forward one in history. Returns the next state, or null if nothing to redo. */
  const redo = useCallback((): HistoryEntry | null => {
    if (cursorRef.current >= historyRef.current.length - 1) return null
    cursorRef.current += 1
    syncFlags()
    return historyRef.current[cursorRef.current]
  }, [syncFlags])

  return { pushHistory, undo, redo, canUndo, canRedo }
}
