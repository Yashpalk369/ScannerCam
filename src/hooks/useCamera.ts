import { useCallback, useEffect, useRef, useState } from 'react'
import { cvWorker } from '../core/workers/workerClient'
import type { Quad } from '../core/cv/types'
import { assessCaptureQuality, EMPTY_STABILITY, updateCaptureStability } from '../core/cv/captureGuidance'
import type { CaptureStability } from '../core/cv/captureGuidance'

export interface CameraDevice {
  deviceId: string
  label: string
}

const LIVE_DETECT_INTERVAL_MS = 250

export function useCamera(detectionPaused = false) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sharedCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const detectionBusyRef = useRef(false)
  const stabilityRef = useRef<CaptureStability>(EMPTY_STABILITY)
  const latestQuadRef = useRef<Quad | null>(null)
  const rearmQuadRef = useRef<Quad | null>(null)
  const requestRef = useRef(0)
  const pausedRef = useRef(detectionPaused)
  pausedRef.current = detectionPaused
  const [guidance, setGuidance] = useState('Place the whole document in view.')

  const [isActive, setIsActive] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  // Live detection state
  const [liveQuad, setLiveQuad] = useState<Quad | null>(null)
  const [autoCapturePending, setAutoCapturePending] = useState(false)
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true)

  const stopCamera = useCallback(() => {
    requestRef.current += 1
    if (startTimerRef.current !== null) {
      clearTimeout(startTimerRef.current)
      startTimerRef.current = null
    }
    if (detectIntervalRef.current !== null) {
      clearInterval(detectIntervalRef.current)
      detectIntervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsActive(false)
    setTorchOn(false)
    setHasTorch(false)
    setLiveQuad(null)
    setAutoCapturePending(false)
    stabilityRef.current = EMPTY_STABILITY
    latestQuadRef.current = null
    rearmQuadRef.current = null
  }, [])

  /**
   * Runs a lightweight quad detection on the current video frame.
   * Called on a ~4 FPS interval while the camera is active.
   */
  const runLiveDetection = useCallback(async () => {
    if (detectionBusyRef.current) return
    const video = videoRef.current
    if (pausedRef.current || document.hidden || !video || !video.videoWidth || !video.videoHeight || video.paused) {
      stabilityRef.current = EMPTY_STABILITY
      setAutoCapturePending(false)
      return
    }

    // Bound the longest edge for fast detection, without enlarging the image.
    const scale = Math.min(1, 400 / Math.max(video.videoWidth, video.videoHeight))
    const targetW = Math.round(video.videoWidth * scale)
    const targetH = Math.round(video.videoHeight * scale)

    if (!sharedCanvasRef.current) {
      sharedCanvasRef.current = document.createElement('canvas')
    }
    const canvas = sharedCanvasRef.current
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW
      canvas.height = targetH
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    detectionBusyRef.current = true
    const request = requestRef.current
    try {
      ctx.drawImage(video, 0, 0, targetW, targetH)
      const imageData = ctx.getImageData(0, 0, targetW, targetH)
      const detectedSmall = await cvWorker.detectImageData(imageData)
      if (request !== requestRef.current || pausedRef.current || document.hidden) return

      if (!detectedSmall) {
        setLiveQuad(null)
        stabilityRef.current = EMPTY_STABILITY
        latestQuadRef.current = null
        rearmQuadRef.current = null
        setGuidance('Place the whole document in view.')
        setAutoCapturePending(false)
        return
      }

      // Scale quad back to video coordinates
      const invScale = 1 / scale
      const detected: Quad = [
        { x: Math.round(detectedSmall[0].x * invScale), y: Math.round(detectedSmall[0].y * invScale) },
        { x: Math.round(detectedSmall[1].x * invScale), y: Math.round(detectedSmall[1].y * invScale) },
        { x: Math.round(detectedSmall[2].x * invScale), y: Math.round(detectedSmall[2].y * invScale) },
        { x: Math.round(detectedSmall[3].x * invScale), y: Math.round(detectedSmall[3].y * invScale) },
      ]

      setLiveQuad(detected)

      latestQuadRef.current = detectedSmall
      const rearmQuad = rearmQuadRef.current
      if (rearmQuad && detectedSmall.every((point, index) => Math.hypot(point.x - rearmQuad[index].x, point.y - rearmQuad[index].y) < 18)) {
        stabilityRef.current = EMPTY_STABILITY
        setAutoCapturePending(false)
        setGuidance('Move to the next page, or tap Capture photo.')
        return
      }
      rearmQuadRef.current = null
      const quality = assessCaptureQuality(imageData, detectedSmall)
      const nearBorder = detectedSmall.some(point => point.x < 6 || point.y < 6 || point.x > targetW - 7 || point.y > targetH - 7)
      const allowsCapture = !quality.lowLight && !quality.blurry && !nearBorder
      stabilityRef.current = updateCaptureStability(stabilityRef.current, detectedSmall, performance.now(), allowsCapture)
      setAutoCapturePending(stabilityRef.current.ready)
      setGuidance(nearBorder ? 'Move back so all page edges are visible.'
        : quality.lowLight ? 'Add more light or turn on the torch.'
        : quality.blurry ? 'Text looks soft. Hold steady and let the camera focus.'
        : stabilityRef.current.ready ? 'Ready to capture.' : 'Document found. Hold steady.')
    } catch {
      if (request !== requestRef.current) return
      stabilityRef.current = EMPTY_STABILITY
      setAutoCapturePending(false)
      setLiveQuad(null)
      setGuidance('Automatic edge detection is unavailable. You can still take a photo.')
    } finally {
      detectionBusyRef.current = false
    }
  }, [])

  const startLiveDetection = useCallback(() => {
    if (detectIntervalRef.current !== null) {
      clearInterval(detectIntervalRef.current)
    }
    stabilityRef.current = EMPTY_STABILITY
    detectIntervalRef.current = setInterval(runLiveDetection, LIVE_DETECT_INTERVAL_MS)
  }, [runLiveDetection])

  const startCamera = useCallback(
    async (deviceId?: string) => {
      stopCamera()
      setError(null)
      const request = requestRef.current

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(window.isSecureContext ? 'This browser does not support camera access. You can upload a photo instead.' : 'Camera access requires HTTPS. You can upload a photo instead.')
        return
      }

      try {
        const videoConstraints: MediaTrackConstraints = {
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        }

        if (deviceId) {
          videoConstraints.deviceId = { exact: deviceId }
        } else {
          videoConstraints.facingMode = { ideal: 'environment' }
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        })

        if (request !== requestRef.current || !videoRef.current) {
          stream.getTracks().forEach(track => track.stop())
          return
        }
        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        if (request !== requestRef.current) return
        setIsActive(true)

        // Check torch capability
        const [videoTrack] = stream.getVideoTracks()
        if (videoTrack) {
          const capabilities = (videoTrack.getCapabilities?.() || {}) as Record<string, unknown>
          setHasTorch(Boolean(capabilities.torch))
          videoTrack.addEventListener('ended', () => {
            if (request !== requestRef.current) return
            stopCamera()
            setError('The camera disconnected. Reconnect it and try again.')
          }, { once: true })
        }

        // Enumerate video devices
        const allDevices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
        if (request !== requestRef.current) return
        const videoInputs = allDevices
          .filter((d) => d.kind === 'videoinput')
          .map((d, index) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${index + 1}`,
          }))
        setDevices(videoInputs)
        if (videoTrack) {
          setSelectedDeviceId(videoTrack.getSettings().deviceId || '')
        }

        // Give video a moment to render first frame, then start live detection
        startTimerRef.current = setTimeout(startLiveDetection, 800)
      } catch (err: unknown) {
        if (request !== requestRef.current) return
        stopCamera()
        const name = err instanceof DOMException ? err.name : ''
        setError(name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings, then try again.'
          : name === 'NotFoundError' ? 'No camera was found. Connect a camera or upload a photo.'
          : name === 'NotReadableError' ? 'The camera is busy. Close other apps using it, then try again.'
          : name === 'OverconstrainedError' ? 'This camera is unavailable. Try another camera or upload a photo.'
          : 'Could not start the camera. Try again or upload a photo.')
      }
    },
    [stopCamera, startLiveDetection],
  )

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current || !hasTorch) return
    const [track] = streamRef.current.getVideoTracks()
    if (!track) return

    try {
      const currentStream = streamRef.current
      const nextTorch = !torchOn
      await (track as MediaStreamTrack & { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
        advanced: [{ torch: nextTorch }],
      })
      if (streamRef.current === currentStream) setTorchOn(nextTorch)
    } catch (err) {
      console.warn('Could not toggle torch:', err)
    }
  }, [hasTorch, torchOn])

  const captureFrame = useCallback(async (): Promise<Blob> => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      throw new Error('Camera video stream is not ready')
    }

    // Try high-resolution ImageCapture API if available
    const [track] = streamRef.current?.getVideoTracks() || []
    const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture

    if (track && ImageCaptureCtor) {
      try {
        const imageCapture = new ImageCaptureCtor(track)
        return await imageCapture.takePhoto()
      } catch (err) {
        console.warn('ImageCapture.takePhoto() failed, falling back to canvas:', err)
      }
    }

    // Canvas fallback
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2D canvas context')

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Failed to encode frame to blob'))
        },
        'image/jpeg',
        0.96,
      )
    })
  }, [])

  /** Reset auto-capture state (call after a capture to restart the stability counter) */
  const resetAutoCapture = useCallback((requireMovement = false) => {
    rearmQuadRef.current = requireMovement ? latestQuadRef.current : null
    stabilityRef.current = EMPTY_STABILITY
    setAutoCapturePending(false)
    setLiveQuad(null)
    setGuidance('Place the whole document in view.')
  }, [])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopCamera()
        setError('Camera paused while you were away. Tap Retry camera to continue.')
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopCamera()
    }
  }, [stopCamera])

  return {
    videoRef,
    isActive,
    hasTorch,
    torchOn,
    devices,
    selectedDeviceId,
    error,
    guidance,
    liveQuad,
    autoCapturePending,
    autoCaptureEnabled,
    setAutoCaptureEnabled,
    startCamera,
    stopCamera,
    toggleTorch,
    captureFrame,
    resetAutoCapture,
  }
}
