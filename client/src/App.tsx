import { useCallback, useState } from "react";
import { CameraFeed } from "./components/CameraFeed";
import { NarrationPanel } from "./components/NarrationPanel";
import { MicButton } from "./components/MicButton";
import { useLoreSession } from "./hooks/useLoreSession";

export default function App() {
  const { status, transcript, images, isSpeaking, isMicMuted, summary, connect, disconnect, toggleMicMuted } =
    useLoreSession();

  const [started, setStarted] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    setVideoEl(video);
    setVideoReady(true);
  }, []);

  const handleStart = useCallback(() => {
    if (videoEl) {
      setStarted(true);
      connect(videoEl);
    }
  }, [videoEl, connect]);

  const handleEnd = useCallback(() => {
    disconnect();
    setStarted(false);
  }, [disconnect]);

  // Show session summary screen
  if (summary) {
    return (
      <div style={styles.summary}>
        <h1 style={styles.summaryTitle}>Session Complete</h1>
        <p style={styles.summarySubtitle}>
          {summary.topics.length} topics explored · {summary.images.length} images generated
        </p>
        {summary.images.map((img, i) => (
          <p key={i} style={styles.summaryCaption}>🖼 {img.caption}</p>
        ))}
        <button style={styles.restartBtn} onClick={() => window.location.reload()}>
          Start New Session
        </button>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {/* Camera feed — top 68% */}
      <div style={styles.cameraPane}>
        <CameraFeed onVideoReady={handleVideoReady} />

        {/* Overlay: Lore wordmark */}
        <div style={styles.wordmark}>LORE</div>

        {/* Start button (before session begins) */}
        {videoReady && !started && (
          <div style={styles.startOverlay}>
            <button style={styles.startBtn} onClick={handleStart}>
              Start Exploring
            </button>
            <p style={styles.startHint}>Point your camera. Hear the story.</p>
          </div>
        )}

        {/* End session button */}
        {started && (
          <button style={styles.endBtn} onClick={handleEnd}>
            End Session
          </button>
        )}
      </div>

      {/* Narration panel */}
      <div style={styles.narrationPane}>
        <NarrationPanel transcript={transcript} images={images} isSpeaking={isSpeaking} />
      </div>

      {/* Mic button row — always in flow, below narration */}
      <div style={styles.micBar}>
        {started && status === "connected" && (
          <MicButton
            isMuted={isMicMuted}
            isSpeaking={isSpeaking}
            onToggle={toggleMicMuted}
          />
        )}
      </div>

      {/* Connection status indicator */}
      {status === "error" && (
        <div style={styles.errorBanner}>
          Connection lost. <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100dvh",
    width: "100%",
    background: "#202124",
    overflow: "hidden",
    position: "relative",
  },
  cameraPane: {
    flex: "0 0 30%",
    position: "relative",
    overflow: "hidden",
    background: "#18191a",
  },
  narrationPane: {
    flex: 1,
    overflow: "hidden",
    borderTop: "1px solid #3c3c3f",
    minHeight: 0,
  },
  wordmark: {
    position: "absolute",
    top: 16,
    left: 20,
    color: "rgba(255,255,255,0.92)",
    fontFamily: "'Georgia', serif",
    fontSize: 20,
    letterSpacing: 6,
    fontWeight: 300,
    textShadow: "0 1px 4px rgba(0,0,0,0.6)",
    zIndex: 10,
  },
  startOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.5)",
    gap: 14,
    zIndex: 20,
  },
  startBtn: {
    padding: "13px 34px",
    fontSize: 16,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontWeight: 500,
    background: "#1a73e8",
    color: "#fff",
    border: "none",
    borderRadius: 24,
    cursor: "pointer",
    boxShadow: "0 2px 10px rgba(26,115,232,0.4)",
    letterSpacing: 0.3,
  },
  startHint: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontFamily: "system-ui, -apple-system, sans-serif",
    letterSpacing: 0.2,
  },
  endBtn: {
    position: "absolute",
    top: 12,
    right: 14,
    padding: "5px 14px",
    fontSize: 12,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontWeight: 500,
    background: "rgba(32,33,36,0.72)",
    color: "rgba(255,255,255,0.72)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 20,
    cursor: "pointer",
    zIndex: 10,
    backdropFilter: "blur(8px)",
    letterSpacing: 0.2,
  },
  micBar: {
    flexShrink: 0,
    height: 96,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#292a2d",
    borderTop: "1px solid #3c3c3f",
    boxShadow: "0 -1px 0 rgba(0,0,0,0.2)",
  },
  errorBanner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    background: "#c5221f",
    color: "#fff",
    textAlign: "center",
    padding: "8px 16px",
    fontSize: 13,
    fontFamily: "system-ui, -apple-system, sans-serif",
    zIndex: 50,
  },
  summary: {
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    background: "#202124",
    color: "#e8eaed",
    padding: 32,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  summaryTitle: {
    fontSize: 26,
    letterSpacing: 0.5,
    fontWeight: 400,
    color: "#e8eaed",
  },
  summarySubtitle: {
    color: "#9aa0a6",
    fontSize: 14,
  },
  summaryCaption: {
    color: "#bdc1c6",
    fontSize: 13,
    maxWidth: 320,
    textAlign: "center",
    lineHeight: 1.5,
  },
  restartBtn: {
    marginTop: 20,
    padding: "12px 32px",
    fontSize: 15,
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontWeight: 500,
    background: "#1a73e8",
    color: "#fff",
    border: "none",
    borderRadius: 24,
    cursor: "pointer",
    boxShadow: "0 2px 10px rgba(26,115,232,0.35)",
  },
};
