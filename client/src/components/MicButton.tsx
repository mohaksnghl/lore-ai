interface Props {
  isActive: boolean;
  isSpeaking: boolean;
  onPress: () => void;
}

export function MicButton({ isActive, isSpeaking, onPress }: Props) {
  return (
    <button onClick={onPress} style={styles.button} aria-label="Microphone">
      <span style={{ ...styles.ring, animation: isActive ? "pulse 1.5s infinite" : "none" }} />
      <span style={styles.icon}>{isSpeaking ? "🔊" : "🎙️"}</span>
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.4); opacity: 0.2; }
        }
      `}</style>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    position: "relative",
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "rgba(200,144,42,0.85)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 20px rgba(200,144,42,0.5)",
    flexShrink: 0,
  },
  ring: {
    position: "absolute",
    inset: -8,
    borderRadius: "50%",
    border: "2px solid rgba(200,144,42,0.5)",
  },
  icon: {
    fontSize: 26,
  },
};
