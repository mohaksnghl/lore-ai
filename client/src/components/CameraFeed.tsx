import { useEffect, useRef } from "react";

interface Props {
  onVideoReady: (video: HTMLVideoElement) => void;
}

export function CameraFeed({ onVideoReady }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;

    async function startCamera() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: 1280, height: 720 },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        onVideoReady(videoRef.current);
      }
    }

    startCamera().catch(console.error);

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onVideoReady]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        transform: "scaleX(1)", // No mirror for environment cam
      }}
    />
  );
}
