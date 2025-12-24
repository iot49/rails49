/**
 * Captures a high-resolution image from the environment camera.
 * Preferentially requests 4K resolution (4096x2160) video stream and captures a frame.
 * This is faster than ImageCapture.takePhoto() as it avoids the focus/exposure cycle delay.
 */
export async function captureImage(): Promise<File | null> {
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 4096 },
        height: { ideal: 2160 },
      },
    });

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
