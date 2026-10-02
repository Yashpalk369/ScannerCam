import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X, Zap, ZapOff, SwitchCamera, Check, Camera, Crosshair } from 'lucide-react'
import { useCamera } from '../../hooks/useCamera'
import type { Quad } from '../../core/cv/types'

interface CameraModalProps {
  isOpen: boolean
  onClose: () => void
  onCapture: (blob: Blob) => Promise<void>
}

/**
 * Renders the live green quad overlay on the video feed.
 * Points are scaled from native video dimensions to the visible <video> element dimensions.
 */
function LiveQuadOverlay({ quad, videoEl }: { quad: Quad | null; videoEl: HTMLVideoElement | null }) {
  if (!quad || !videoEl) return null

  const vw = videoEl.videoWidth
  const vh = videoEl.videoHeight
  const dw = videoEl.clientWidth
  const dh = videoEl.clientHeight
  if (!vw || !vh || !dw || !dh) return null

  const sx = dw / vw
  const sy = dh / vh

  const pts = quad.map((p) => ({
    x: p.x * sx,
    y: p.y * sy,
  }))

  const pathD = `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y} L ${pts[2].x} ${pts[2].y} L ${pts[3].x} ${pts[3].y} Z`

  return (
    <svg
      className="live-quad-svg"
      viewBox={`0 0 ${dw} ${dh}`}
      width={dw}
      height={dh}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    >
      {/* Filled region highlight */}
      <path d={pathD} fill="rgba(0, 220, 120, 0.08)" stroke="none" />
      {/* Edge outline */}
      <path d={pathD} fill="none" stroke="#00dc78" strokeWidth="2.5" strokeLinejoin="round" strokeDasharray="0" />
      {/* Corner dots */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="7" fill="#00dc78" stroke="#fff" strokeWidth="2" />
      ))}
    </svg>
  )
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onCapture,
}) => {
  const {
    videoRef,
    isActive,
    hasTorch,
    torchOn,
    devices,
    selectedDeviceId,
    error,
    liveQuad,
    autoCapturePending,
    autoCaptureEnabled,
    setAutoCaptureEnabled,
    startCamera,
    stopCamera,
    toggleTorch,
    captureFrame,
    resetAutoCapture,
  } = useCamera()

  const [capturedCount, setCapturedCount] = useState(0)
  const [isCapturing, setIsCapturing] = useState(false)
  const [flashAnimation, setFlashAnimation] = useState(false)
  const [autoCaptureCountdown, setAutoCaptureCountdown] = useState<number | null>(null)
  const autoCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Start camera when modal opens, stop when closes
  useEffect(() => {
    if (isOpen) {
      setCapturedCount(0)
      startCamera()
    } else {
      stopCamera()
      setAutoCaptureCountdown(null)
      if (autoCaptureTimerRef.current) clearTimeout(autoCaptureTimerRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [isOpen, startCamera, stopCamera])

  const triggerCapture = useCallback(async () => {
    if (isCapturing || !isActive) return
    setIsCapturing(true)
    setFlashAnimation(true)
    setTimeout(() => setFlashAnimation(false), 220)

    try {
      const blob = await captureFrame()
      setCapturedCount((prev) => prev + 1)
      await onCapture(blob)
      resetAutoCapture()
    } catch (err) {
      console.error('Capture failed:', err)
    } finally {
      setIsCapturing(false)
      setAutoCaptureCountdown(null)
    }
  }, [isCapturing, isActive, captureFrame, onCapture, resetAutoCapture])

  // Auto-capture: when quad is stable and feature is enabled, show 2s countdown ring then fire
  useEffect(() => {
    if (!autoCapturePending || !autoCaptureEnabled || isCapturing) return
    if (autoCaptureCountdown !== null) return // already counting

    let remaining = 2
    setAutoCaptureCountdown(remaining)

    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1
      setAutoCaptureCountdown(remaining)
      if (remaining <= 0) {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      }
    }, 1000)

    autoCaptureTimerRef.current = setTimeout(() => {
      setAutoCaptureCountdown(null)
      triggerCapture()
    }, 2000)

    return () => {
      if (autoCaptureTimerRef.current) clearTimeout(autoCaptureTimerRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCapturePending, autoCaptureEnabled, isCapturing])

  const handleSwitchDevice = () => {
    if (devices.length <= 1) return
    const currentIdx = devices.findIndex((d) => d.deviceId === selectedDeviceId)
    const nextDevice = devices[(currentIdx + 1) % devices.length]
    if (nextDevice) {
      startCamera(nextDevice.deviceId)
    }
  }

  if (!isOpen) return null

  const hasLiveQuad = liveQuad !== null

  return (
    <div className="camera-modal-overlay">
      <div className="camera-viewport-wrap">
        {/* Shutter flash effect */}
        {flashAnimation && <div className="camera-shutter-flash" />}

        {/* Video feed */}
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className="camera-video-stream"
        />

        {/* Live quad detection overlay */}
        <LiveQuadOverlay quad={liveQuad} videoEl={videoRef.current} />

        {/* Static framing guide (shown only when no live quad detected) */}
        {!hasLiveQuad && (
          <div className="camera-guidelines">
            <div className="guide-box">
              <div className="notch notch-tl" />
              <div className="notch notch-tr" />
              <div className="notch notch-br" />
              <div className="notch notch-bl" />
              <p className="guide-hint">
                <Crosshair size={14} style={{ display: 'inline', marginRight: 6 }} />
                Point at a document to auto-detect
              </p>
            </div>
          </div>
        )}

        {/* Document detected banner */}
        {hasLiveQuad && autoCaptureCountdown === null && (
          <div className="live-detect-banner live-detect-found">
            ✓ Document detected
          </div>
        )}

        {/* Auto-capture countdown */}
        {autoCaptureCountdown !== null && (
          <div className="auto-capture-countdown">
            <div className="countdown-ring">
              <svg viewBox="0 0 64 64" className="countdown-svg">
                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
                <circle
                  cx="32" cy="32" r="28"
                  fill="none" stroke="#00dc78" strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 28}`}
                  strokeDashoffset={`${2 * Math.PI * 28 * (1 - (2 - autoCaptureCountdown) / 2)}`}
                  strokeLinecap="round"
                  style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <span className="countdown-number">{autoCaptureCountdown}</span>
            </div>
            <p className="countdown-label">Auto-capturing…</p>
          </div>
        )}

        {/* Top Floating Action Bar */}
        <div className="camera-top-bar">
          <button
            type="button"
            className="btn-circle"
            onClick={onClose}
            title="Close camera"
          >
            <X size={20} />
          </button>

          <div className="camera-top-actions">
            {/* Auto-capture toggle */}
            <button
              type="button"
              className={`btn-circle auto-capture-toggle ${autoCaptureEnabled ? 'active' : ''}`}
              onClick={() => {
                setAutoCaptureEnabled(!autoCaptureEnabled)
                setAutoCaptureCountdown(null)
                if (autoCaptureTimerRef.current) clearTimeout(autoCaptureTimerRef.current)
                if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
              }}
              title={autoCaptureEnabled ? 'Disable auto-capture' : 'Enable auto-capture'}
            >
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '-0.5px' }}>AUTO</span>
            </button>

            {hasTorch && (
              <button
                type="button"
                className={`btn-circle ${torchOn ? 'active' : ''}`}
                onClick={toggleTorch}
                title="Toggle torch"
              >
                {torchOn ? <Zap size={20} /> : <ZapOff size={20} />}
              </button>
            )}

            {devices.length > 1 && (
              <button
                type="button"
                className="btn-circle"
                onClick={handleSwitchDevice}
                title="Switch camera"
              >
                <SwitchCamera size={20} />
              </button>
            )}
          </div>
        </div>

        {/* Error notice */}
        {error && (
          <div className="camera-error-banner">
            <p>{error}</p>
          </div>
        )}

        {/* Bottom Shutter & Burst Bar */}
        <div className="camera-bottom-bar">
          <div className="batch-counter-wrap">
            {capturedCount > 0 && (
              <span className="batch-pill">
                {capturedCount} {capturedCount === 1 ? 'page' : 'pages'} scanned
              </span>
            )}
          </div>

          <button
            type="button"
            className="camera-shutter-btn"
            disabled={!isActive || isCapturing}
            onClick={triggerCapture}
            title="Capture photo"
          >
            <div className="shutter-inner">
              <Camera size={26} />
            </div>
          </button>

          <div className="done-btn-wrap">
            {capturedCount > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-done"
                onClick={onClose}
              >
                <Check size={18} />
                <span>Done</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
