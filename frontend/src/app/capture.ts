import { CAMERA_PARAMS } from "./config";

/**
 * Requests a camera stream using the shared CAMERA_PARAMS.
 */
export async function getCameraStream(): Promise<MediaStream> {
  return await navigator.mediaDevices.getUserMedia({
    video: CAMERA_PARAMS,
  });
}

/**
 * Captures a single frame from an active video element and returns it as a File.
 */
export async function captureFromVideo(video: HTMLVideoElement): Promise<File | null> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0);
  
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
        resolve(file);
      } else {
        resolve(null);
      }
    }, 'image/jpeg');
  });
}

/**
 * Captures a high-resolution image from the environment camera.
 * This is faster than ImageCapture.takePhoto() as it avoids the focus/exposure cycle delay.
 * 
 * Used in rr-layout-editor for one-shot captures.
 */
export async function captureImage(): Promise<File | null> {
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;

  try {
    stream = await getCameraStream();

    video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.autoplay = true;

    // Wait for metadata to load so we know dimensions
    await new Promise<void>((resolve) => {
      if (!video) return;
      video.onloadedmetadata = () => resolve();
    });

    // Wait a short delay to ensure the camera has adjusted (exposure, white balance)
    await video.play();
    await new Promise((r) => setTimeout(r, 500));

    return await captureFromVideo(video);
  } catch (err) {
    console.error('Error accessing camera:', err);
    alert('Could not access the camera. Please ensure you have granted permission.');
    return null;
  } finally {
    // Cleanup
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (video) {
        video.srcObject = null;
    }
  }
}
