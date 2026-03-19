import { useRef, useState, useEffect } from 'react'
import './IdScanStep.css'

export default function IdScanStep({ onSubmit, onBack }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [stream, setStream] = useState(null)
  const [capturedImage, setCapturedImage] = useState(null)
  const [cameraError, setCameraError] = useState(false)

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [])

  async function startCamera() {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      setStream(mediaStream)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
      }
    } catch {
      setCameraError(true)
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
    }
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const imageData = canvas.toDataURL('image/jpeg', 0.85)
    setCapturedImage(imageData)
    stopCamera()
  }

  function retake() {
    setCapturedImage(null)
    startCamera()
  }

  function handleFileUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setCapturedImage(ev.target.result)
    reader.readAsDataURL(file)
  }

  function handleSubmit() {
    if (!capturedImage) return
    onSubmit(capturedImage)
  }

  return (
    <div className="idscan">
      {/* Header */}
      <button className="idscan__back" onClick={onBack}>
        ← Back
      </button>

      <div className="idscan__body">
        <div className="idscan__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" xmlns="http://www.w3.org/2000/svg">
            <path d="M15 3h6v6M9 3H3v6M15 21h6v-6M9 21H3v-6" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="5" y="8" width="14" height="9" rx="1" strokeLinecap="round" />
            <circle cx="8.5" cy="12" r="1.5" />
            <path d="M11 12h5M11 14.5h3" strokeLinecap="round" />
          </svg>
        </div>

        <h2 className="idscan__title">Scan your Barangay ID</h2>
        <p className="idscan__sub">(Make sure it shows your address)</p>

        {/* Camera / Preview area */}
        <div className="idscan__viewport">
          {capturedImage ? (
            <img src={capturedImage} alt="Captured ID" className="idscan__preview" />
          ) : cameraError ? (
            <div className="idscan__error">
              <p>Camera not available.</p>
              <label className="idscan__upload-btn">
                Upload Image
                <input type="file" accept="image/*" onChange={handleFileUpload} hidden />
              </label>
            </div>
          ) : (
            <>
              <video ref={videoRef} className="idscan__video" autoPlay playsInline muted />
              <div className="idscan__corners">
                <span /><span /><span /><span />
              </div>
            </>
          )}
        </div>

        <canvas ref={canvasRef} hidden />

        {/* Actions */}
        <div className="idscan__actions">
          {capturedImage ? (
            <>
              <button className="idscan__btn idscan__btn--outline" onClick={retake}>Retake</button>
              <button className="idscan__btn" onClick={handleSubmit}>Submit</button>
            </>
          ) : !cameraError ? (
            <button className="idscan__btn" onClick={capturePhoto}>Capture</button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
