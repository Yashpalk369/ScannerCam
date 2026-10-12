import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X, Zap, ZapOff, SwitchCamera, Check, Camera, Crosshair, RotateCcw, Loader2 } from 'lucide-react'
import { useCamera } from '../../hooks/useCamera'
import { mapVideoQuad } from '../../core/cv/captureGuidance'
import type { Quad } from '../../core/cv/types'

interface CameraModalProps {
  isOpen: boolean
  onClose: () => void
  onCapture: (blob: Blob) => Promise<void>
}

function LiveQuadOverlay({ quad, videoEl }: { quad: Quad | null; videoEl: HTMLVideoElement | null }) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!videoEl) return
    const update = () => setSize({ width: videoEl.clientWidth, height: videoEl.clientHeight })
    const observer = new ResizeObserver(update)
    observer.observe(videoEl)
    videoEl.addEventListener('loadedmetadata', update)
    update()
    return () => {
      observer.disconnect()
      videoEl.removeEventListener('loadedmetadata', update)
    }
  }, [videoEl])
  if (!quad || !videoEl?.videoWidth || !videoEl.videoHeight || !size.width || !size.height) return null
  const points = mapVideoQuad(quad, videoEl.videoWidth, videoEl.videoHeight, size.width, size.height)
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ') + ' Z'
  return (
    <svg className="live-quad-svg" viewBox={`0 0 ${size.width} ${size.height}`} width={size.width} height={size.height} aria-hidden="true">
      <path d={path} fill="rgba(0, 220, 120, 0.08)" stroke="#00dc78" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="6" fill="#00dc78" stroke="#fff" strokeWidth="2" />)}
    </svg>
  )
}

export const CameraModal: React.FC<CameraModalProps> = ({ isOpen, onClose, onCapture }) => {
  const [capturedCount, setCapturedCount] = useState(0)
  const [isCapturing, setIsCapturing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [reviewBlob, setReviewBlob] = useState<Blob | null>(null)
  const [reviewUrl, setReviewUrl] = useState('')
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [autoCaptureCountdown, setAutoCaptureCountdown] = useState<number | null>(null)
  const captureLock = useRef(false)
  const saveLock = useRef(false)
  const sessionRef = useRef(0)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const reviewButtonRef = useRef<HTMLButtonElement>(null)
  const shutterButtonRef = useRef<HTMLButtonElement>(null)
  const {
    videoRef, isActive, hasTorch, torchOn, devices, selectedDeviceId,
    error, guidance, liveQuad, autoCapturePending, autoCaptureEnabled,
    setAutoCaptureEnabled, startCamera, stopCamera, toggleTorch, captureFrame, resetAutoCapture,
  } = useCamera(Boolean(reviewBlob) || isCapturing || isSaving)

  useEffect(() => {
    if (!isOpen) return
    const previousFocus = document.activeElement as HTMLElement | null
    setCapturedCount(0)
    void startCamera()
    closeButtonRef.current?.focus()
    return () => {
      sessionRef.current += 1
      stopCamera()
      previousFocus?.focus()
    }
  }, [isOpen, startCamera, stopCamera])

  useEffect(() => {
    if (!reviewBlob) {
      setReviewUrl('')
      shutterButtonRef.current?.focus()
      return
    }
    const url = URL.createObjectURL(reviewBlob)
    setReviewUrl(url)
    reviewButtonRef.current?.focus()
    return () => URL.revokeObjectURL(url)
  }, [reviewBlob])

  const triggerCapture = useCallback(async () => {
    if (captureLock.current || reviewBlob || !isActive) return
    captureLock.current = true
    setIsCapturing(true)
    setCaptureError(null)
    const session = sessionRef.current
    try {
      const blob = await captureFrame()
      if (session !== sessionRef.current) return
      setReviewBlob(blob)
    } catch {
      if (session === sessionRef.current) setCaptureError('Could not capture this photo. Hold steady and try again.')
    } finally {
      captureLock.current = false
      if (session === sessionRef.current) {
        setIsCapturing(false)
        setAutoCaptureCountdown(null)
      }
    }
  }, [reviewBlob, isActive, captureFrame])

  // Losing stability, hiding the camera, disabling AUTO or reviewing a photo
  // cancels both timers. State changes in the countdown do not restart them.
  useEffect(() => {
    if (!isOpen || !isActive || !autoCapturePending || !autoCaptureEnabled || isCapturing || reviewBlob) {
      setAutoCaptureCountdown(null)
      return
    }
    setAutoCaptureCountdown(2)
    const tick = setTimeout(() => setAutoCaptureCountdown(1), 1000)
    const capture = setTimeout(() => void triggerCapture(), 2000)
    return () => {
      clearTimeout(tick)
      clearTimeout(capture)
    }
  }, [isOpen, isActive, autoCapturePending, autoCaptureEnabled, isCapturing, reviewBlob, triggerCapture])

  const keepCapture = async (finish: boolean) => {
    if (!reviewBlob || saveLock.current) return
    saveLock.current = true
    setIsSaving(true)
    setCaptureError(null)
    const session = sessionRef.current
    try {
      await onCapture(reviewBlob)
      if (session !== sessionRef.current) return
      setCapturedCount(count => count + 1)
      setReviewBlob(null)
      resetAutoCapture(true)
      if (finish) onClose()
    } catch {
      if (session === sessionRef.current) setCaptureError('Could not save this scan. Your photo is still here; try keeping it again.')
    } finally {
      saveLock.current = false
      if (session === sessionRef.current) setIsSaving(false)
    }
  }

  const handleSwitchDevice = () => {
    if (devices.length <= 1 || isCapturing || reviewBlob) return
    const currentIndex = devices.findIndex(device => device.deviceId === selectedDeviceId)
    const nextDevice = devices[(currentIndex + 1) % devices.length]
    if (nextDevice) void startCamera(nextDevice.deviceId)
  }

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    if (buttons.length === 0) { event.preventDefault(); return }
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  if (!isOpen) return null
  return (
    <div className="camera-modal-overlay" role="dialog" aria-modal="true" aria-label={reviewBlob ? 'Review captured photo' : 'Scan documents with camera'} onKeyDown={trapFocus}>
      <div className="camera-viewport-wrap">
        <video ref={videoRef} playsInline autoPlay muted className="camera-video-stream" aria-label="Live camera preview" />
        {!reviewBlob && <LiveQuadOverlay quad={liveQuad} videoEl={videoRef.current} />}
        {!reviewBlob && !liveQuad && !error && (
          <div className="camera-guidelines" aria-hidden="true">
            <div className="guide-box">
              <div className="notch notch-tl" /><div className="notch notch-tr" />
              <div className="notch notch-br" /><div className="notch notch-bl" />
              <p className="guide-hint"><Crosshair size={14} /> Keep all four page edges visible</p>
            </div>
          </div>
        )}
        {!reviewBlob && !error && <div className="live-detect-banner live-detect-found" role="status">{isCapturing ? 'Taking photo…' : guidance}</div>}
        {!reviewBlob && autoCaptureCountdown !== null && (
          <div className="auto-capture-countdown" role="status">
            <div className="countdown-ring"><span className="countdown-number">{autoCaptureCountdown}</span></div>
            <p className="countdown-label">Hold steady · auto-capture</p>
          </div>
        )}
        {reviewBlob && (
          <div className="camera-review">
            <h2>Review your photo</h2>
            <p>Check that the text is readable and all edges are visible. Cropping and enhancement apply when you keep it.</p>
            {reviewUrl && <img src={reviewUrl} alt="Captured document before cropping" className="camera-review-image" />}
            <div className="camera-review-actions">
              <button ref={reviewButtonRef} type="button" className="btn btn-secondary" disabled={isSaving} onClick={() => { setReviewBlob(null); setCaptureError(null); resetAutoCapture() }}><RotateCcw size={16} /> Retake</button>
              <button type="button" className="btn btn-primary" disabled={isSaving} onClick={() => void keepCapture(false)}>{isSaving ? <Loader2 size={16} className="spin-icon" /> : <Check size={16} />} Keep & scan next</button>
              <button type="button" className="btn btn-secondary" disabled={isSaving} onClick={() => void keepCapture(true)}>Keep & finish</button>
            </div>
          </div>
        )}
        <div className="camera-top-bar">
          <button ref={closeButtonRef} type="button" className="btn-circle" onClick={onClose} disabled={isSaving} aria-label="Close camera" title="Close camera"><X size={20} /></button>
          {!reviewBlob && <div className="camera-top-actions">
            <button type="button" className={`btn-circle auto-capture-toggle ${autoCaptureEnabled ? 'active' : ''}`} onClick={() => setAutoCaptureEnabled(!autoCaptureEnabled)} aria-pressed={autoCaptureEnabled} aria-label="Auto-capture" title={autoCaptureEnabled ? 'Disable auto-capture' : 'Enable auto-capture'}><span>AUTO</span></button>
            {hasTorch && <button type="button" className={`btn-circle ${torchOn ? 'active' : ''}`} onClick={toggleTorch} aria-label="Toggle torch" aria-pressed={torchOn}>{torchOn ? <Zap size={20} /> : <ZapOff size={20} />}</button>}
            {devices.length > 1 && <button type="button" className="btn-circle" disabled={isCapturing} onClick={handleSwitchDevice} aria-label="Switch camera"><SwitchCamera size={20} /></button>}
          </div>}
        </div>
        {(captureError || (!reviewBlob && error)) && (
          <div className={`camera-feedback ${reviewBlob ? 'camera-feedback-review' : ''}`} role="alert">
            <p>{captureError || error}</p>
            {!reviewBlob && error && <button type="button" className="btn btn-secondary" onClick={() => void startCamera()}>Retry camera</button>}
          </div>
        )}
        {!reviewBlob && <div className="camera-bottom-bar">
          <div className="batch-counter-wrap">{capturedCount > 0 && <span className="batch-pill">{capturedCount} {capturedCount === 1 ? 'page' : 'pages'} kept</span>}</div>
          <button ref={shutterButtonRef} type="button" className="camera-shutter-btn" disabled={!isActive || isCapturing} onClick={() => void triggerCapture()} aria-label="Capture photo" title="Capture photo"><div className="shutter-inner">{isCapturing ? <Loader2 size={26} className="spin-icon" /> : <Camera size={26} />}</div></button>
          <div className="done-btn-wrap">{capturedCount > 0 && <button type="button" className="btn btn-primary btn-done" onClick={onClose}><Check size={18} /><span>Done</span></button>}</div>
        </div>}
      </div>
    </div>
  )
}
