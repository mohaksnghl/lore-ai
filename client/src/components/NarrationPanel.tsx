import { useEffect, useRef } from "react";
import type { TranscriptLine, GeneratedImage } from "../types";

interface Props {
  transcript: TranscriptLine[];
  images: GeneratedImage[];
  isSpeaking: boolean;
}

export function NarrationPanel({ transcript, images, isSpeaking }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestImageRef = useRef<HTMLDivElement>(null);
  const prevImagesLenRef = useRef(0);

  // Scroll within the container only — never scroll the window
  useEffect(() => {
    const newImageAdded = images.length > prevImagesLenRef.current;
    prevImagesLenRef.current = images.length;

    const el = scrollRef.current;
    if (!el) return;

    if (newImageAdded && latestImageRef.current) {
      // getBoundingClientRect gives viewport-relative coords; adjust for current scrollTop
      const imgRect = latestImageRef.current.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const relativeTop = imgRect.top - elRect.top + el.scrollTop;
      el.scrollTo({ top: relativeTop, behavior: "smooth" });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [transcript, images]);

  // Build a merged timeline of transcript lines + images, sorted by timestamp
  const timeline: Array<
    { kind: "line"; data: TranscriptLine } | { kind: "image"; data: GeneratedImage }
  > = [
    ...transcript.map((l) => ({ kind: "line" as const, data: l })),
    ...images.map((i) => ({ kind: "image" as const, data: i })),
  ].sort((a, b) => a.data.timestamp - b.data.timestamp);

  // ID of the most recently added image (last in insertion order)
  const latestImageId = images.length > 0 ? images[images.length - 1].id : null;

  return (
    <div style={styles.panel}>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
      {/* Status pill */}
      <div style={styles.statusRow}>
        <span style={{ ...styles.pill, background: isSpeaking ? "#c8902a" : "#444" }}>
          {isSpeaking ? "● Narrating" : "◌ Listening"}
        </span>
      </div>

      {/* Timeline */}
      <div ref={scrollRef} style={styles.scroll}>
        {timeline.length === 0 && (
          <p style={styles.placeholder}>Point your camera at anything to begin…</p>
        )}

        {timeline.map((item) => {
          if (item.kind === "line") {
            return (
              <div
                key={item.data.id}
                style={{
                  ...styles.line,
                  opacity: item.data.role === "user" ? 0.6 : 1,
                  fontStyle: item.data.role === "user" ? "italic" : "normal",
                }}
              >
                {item.data.role === "user" && (
                  <span style={styles.youLabel}>You: </span>
                )}
                {item.data.text}
                {item.data.partial && <span style={styles.cursor}>▍</span>}
              </div>
            );
          }

          return (
            <div
              key={item.data.id}
              ref={item.data.id === latestImageId ? latestImageRef : undefined}
              style={styles.imageCard}
            >
              <img src={item.data.image_url} alt={item.data.caption} style={styles.img} />
              {item.data.caption && (
                <p style={styles.caption}>{item.data.caption}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "rgba(10,10,10,0.92)",
    backdropFilter: "blur(12px)",
    color: "#f0e8d8",
    fontFamily: "'Georgia', serif",
  },
  statusRow: {
    padding: "10px 16px 6px",
    display: "flex",
    alignItems: "center",
  },
  pill: {
    fontSize: 11,
    fontFamily: "monospace",
    letterSpacing: 1,
    padding: "3px 10px",
    borderRadius: 20,
    color: "#fff",
    transition: "background 0.3s",
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "8px 16px 16px",
  },
  placeholder: {
    color: "#666",
    fontStyle: "italic",
    fontSize: 14,
    textAlign: "center",
    marginTop: 20,
  },
  line: {
    fontSize: 15,
    lineHeight: 1.5,
    color: "#f0e8d8",
    marginBottom: 8,
  },
  youLabel: {
    color: "#888",
    fontStyle: "normal",
  },
  imageCard: {
    borderRadius: 10,
    overflow: "hidden",
    background: "#1a1a1a",
    border: "1px solid #333",
    marginBottom: 8,
  },
  img: {
    width: "100%",
    display: "block",
    height: "auto",
  },
  caption: {
    fontSize: 11,
    color: "#888",
    padding: "6px 10px",
    fontStyle: "italic",
  },
  cursor: {
    color: "#c8902a",
    animation: "blink 0.8s step-end infinite",
    marginLeft: 2,
    fontWeight: "bold",
  },
};
