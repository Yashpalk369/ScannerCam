import { useCallback, useEffect, useRef, useState } from 'react'
import { detectDocumentQuad } from '../core/cv/edgeDetection'
import type { Quad } from '../core/cv/types'

export interface CameraDevice {
  deviceId: string
  label: string
}

export interface LiveDetectionResult {
  quad: Quad | null
  stable: boolean // true when the quad has been stable for auto-capture
}

const LIVE_DETECT_INTERVAL_MS = 120    // ~8 FPS for live quad overlay
const STABILITY_FRAMES_REQUIRED = 5   // ~600ms of stable detection before auto-capture
const STABILITY_THRESHOLD_PX = 12     // max pixel drift allowed between frames

function quadDistance(a: Quad, b: Quad): number {
  let sum = 0
  for (let i = 0; i < 4; i += 1) {
    const dx = a[i].x - b[i].x
    const dy = a[i].y - b[i].y
    sum += Math.sqrt(dx * dx + dy * dy)
  }
  return sum / 4
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sharedCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const stableFramesRef = useRef(0)
  const lastQuadRef = useRef<Quad | null>(null)

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
    stableFramesRef.current = 0
    lastQuadRef.current = null
  }, [])

  /**
   * Runs a lightweight quad detection on the current video frame.
   * Called on a ~8 FPS interval while the camera is active.
   */
  const runLiveDetection = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight || video.paused) return

    // Downscale to 400px wide for fast detection
    const targetW = 400
    const scale = targetW / video.videoWidth
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

    ctx.drawImage(video, 0, 0, targetW, targetH)
    const imageData = ctx.getImageData(0, 0, targetW, targetH)
    const detectedSmall = detectDocumentQuad(imageData)

    if (!detectedSmall) {
      setLiveQuad(null)
      stableFramesRef.current = 0
      lastQuadRef.current = null
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

    // Stability tracking for auto-capture
    const prev = lastQuadRef.current
    if (prev && quadDistance(prev, detected) < STABILITY_THRESHOLD_PX) {
      stableFramesRef.current += 1
    } else {
      stableFramesRef.current = 1
    }
    lastQuadRef.current = detected

    if (stableFramesRef.current >= STABILITY_FRAMES_REQUIRED) {
      setAutoCapturePending(true)
    }
  }, [])

  const startLiveDetection = useCallback(() => {
    if (detectIntervalRef.current !== null) {
      clearInterval(detectIntervalRef.current)
    }
    stableFramesRef.current = 0
    lastQuadRef.current = null
    detectIntervalRef.current = setInterval(runLiveDetection, LIVE_DETECT_INTERVAL_MS)
  }, [runLiveDetection])

  const startCamera = useCallback(
    async (deviceId?: string) => {
      stopCamera()
      setError(null)

      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera API is not supported in this browser.')
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

        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        setIsActive(true)

        // Check torch capability
        const [videoTrack] = stream.getVideoTracks()
        if (videoTrack) {
          const capabilities = (videoTrack.getCapabilities?.() || {}) as Record<string, unknown>
          setHasTorch(Boolean(capabilities.torch))
        }

        // Enumerate video devices
        const allDevices = await navigator.mediaDevices.enumerateDevices()
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
        console.error('Camera access error:', err)
        setError('Could not access camera. Please check permissions.')
      }
    },
    [stopCamera, startLiveDetection],
  )

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current || !hasTorch) return
    const [track] = streamRef.current.getVideoTracks()
    if (!track) return

    try {
      const nextTorch = !torchOn
      await (track as MediaStreamTrack & { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
        advanced: [{ torch: nextTorch }],
      })
      setTorchOn(nextTorch)
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
  const resetAutoCapture = useCallback(() => {
    stableFramesRef.current = 0
    lastQuadRef.current = null
    setAutoCapturePending(false)
    setLiveQuad(null)
  }, [])

  useEffect(() => {
    return () => {
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
