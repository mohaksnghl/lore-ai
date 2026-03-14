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
    background: "#0a0a0a",
    overflow: "hidden",
    position: "relative",
  },
  cameraPane: {
    flex: "0 0 30%",
    position: "relative",
    overflow: "hidden",
    background: "#111",
  },
  narrationPane: {
    flex: 1,
    overflow: "hidden",
    borderTop: "1px solid #222",
    minHeight: 0,
  },
  wordmark: {
    position: "absolute",
    top: 16,
    left: 20,
    color: "rgba(255,255,255,0.8)",
    fontFamily: "'Georgia', serif",
    fontSize: 22,
    letterSpacing: 6,
    fontWeight: 300,
    textShadow: "0 2px 8px rgba(0,0,0,0.8)",
    zIndex: 10,
  },
  startOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.55)",
    gap: 12,
    zIndex: 20,
  },
  startBtn: {
    padding: "14px 36px",
    fontSize: 18,
    fontFamily: "'Georgia', serif",
    background: "rgba(200,144,42,0.9)",
    color: "#fff",
    border: "none",
    borderRadius: 50,
    cursor: "pointer",
    boxShadow: "0 4px 24px rgba(200,144,42,0.4)",
    letterSpacing: 1,
  },
  startHint: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontStyle: "italic",
  },
  endBtn: {
    position: "absolute",
    top: 14,
    right: 16,
    padding: "6px 14px",
    fontSize: 12,
    background: "rgba(0,0,0,0.5)",
    color: "rgba(255,255,255,0.7)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 20,
    cursor: "pointer",
    zIndex: 10,
    backdropFilter: "blur(6px)",
  },
  micBar: {
    flexShrink: 0,
    height: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0a0a0a",
    borderTop: "1px solid #1a1a1a",
  },
  errorBanner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    background: "#7f1d1d",
    color: "#fca5a5",
    textAlign: "center",
    padding: "8px 16px",
    fontSize: 14,
    zIndex: 50,
  },
  summary: {
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    background: "#0a0a0a",
    color: "#f0e8d8",
    padding: 32,
    fontFamily: "'Georgia', serif",
  },
  summaryTitle: {
    fontSize: 28,
    letterSpacing: 3,
    fontWeight: 300,
  },
  summarySubtitle: {
    color: "#888",
    fontSize: 14,
  },
  summaryCaption: {
    color: "#aaa",
    fontSize: 13,
    maxWidth: 320,
    textAlign: "center",
  },
  restartBtn: {
    marginTop: 20,
    padding: "12px 32px",
    fontSize: 16,
    background: "rgba(200,144,42,0.85)",
    color: "#fff",
    border: "none",
    borderRadius: 50,
    cursor: "pointer",
  },
};
