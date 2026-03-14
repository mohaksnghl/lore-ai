interface Props {
  isMuted: boolean;
  isSpeaking: boolean;
  onToggle: () => void;
}

function playMicSound(muting: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";

    const now = ctx.currentTime;
    if (muting) {
      // Descending chirp — mic off
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.09);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    } else {
      // Ascending chirp — mic on
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    }
    osc.start(now);
    osc.stop(now + 0.15);
    osc.onended = () => ctx.close();
  } catch {
    // ignore if audio context is unavailable
  }
}

// Mic-on SVG (Google style)
function MicIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
    </svg>
  );
}

// Mic-off SVG with diagonal slash (Google style)
function MicOffIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
      <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c.57-.08 1.12-.24 1.64-.46L19.73 21 21 19.73 4.27 3z" />
    </svg>
  );
}

export function MicButton({ isMuted, isSpeaking, onToggle }: Props) {
  const handleClick = () => {
    playMicSound(/* muting = */ !isMuted);
    onToggle();
  };

  return (
    <div style={styles.wrapper}>
      <button
        onClick={handleClick}
        style={{
          ...styles.button,
          background: isMuted ? "#3c3c3c" : "#1a73e8",
          boxShadow: isMuted
            ? "0 2px 8px rgba(0,0,0,0.5)"
            : "0 4px 20px rgba(26,115,232,0.55)",
          transform: isSpeaking && !isMuted ? "scale(1.06)" : "scale(1)",
        }}
        aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
      >
        {/* Outer pulse ring when active & speaking */}
        {!isMuted && isSpeaking && <span style={styles.pulse} />}
        {isMuted ? <MicOffIcon /> : <MicIcon />}
      </button>
      <span style={styles.label}>{isMuted ? "Tap to unmute" : "Tap to mute"}</span>
      <style>{`
        @keyframes ring-pulse {
          0%   { transform: scale(1);    opacity: 0.6; }
          100% { transform: scale(1.65); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  button: {
    position: "relative",
    width: 72,
    height: 72,
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "background 0.2s, box-shadow 0.2s, transform 0.15s",
  },
  pulse: {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    background: "rgba(26,115,232,0.35)",
    animation: "ring-pulse 1.1s ease-out infinite",
  },
  label: {
    fontSize: 11,
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 0.3,
    fontFamily: "sans-serif",
    userSelect: "none" as const,
  },
};
