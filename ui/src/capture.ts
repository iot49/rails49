/**
 * Shared camera constraints for the application.
 */
export const DEFAULT_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    facingMode: 'environment'
  },
  audio: false
};

/**
 * Requests access to the camera and returns a MediaStream.
 */
export async function getCameraStream(constraints = DEFAULT_CAMERA_CONSTRAINTS): Promise<MediaStream> {
  return await navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * Utility to capture a single frame from the camera.
 * It opens the camera, grabs one frame, and then stops the stream.
 */
export async function captureFromCamera(): Promise<Uint8Array> {
  const stream = await getCameraStream();

  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    
    // Wait for video to be ready and playing
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(reject);
      };
      video.onerror = (e) => reject(new Error('Video element error: ' + e));
      
      // Safety timeout
      setTimeout(() => reject(new Error('Camera capture timed out')), 5000);
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    
    ctx.drawImage(video, 0, 0);
    
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Could not create blob from canvas');
    
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  } finally {
    // Ensure all tracks are stopped even if capture fails
    stream.getTracks().forEach(track => track.stop());
  }
}
