/**
 * useLoreSession — central hook managing the WebSocket connection,
 * camera frame capture, microphone PCM streaming, and audio playback.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUDIO_WORKLET_PROCESSOR_SRC,
  AUDIO_PLAYBACK_PROCESSOR_SRC,
  createBlobUrl,
} from "../lib/audioWorkletProcessor";
import type {
  ConnectionStatus,
  TranscriptLine,
  GeneratedImage,
  SessionSummary,
  ServerMessage,
} from "../types";

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) || "ws://localhost:8080";

const FRAME_INTERVAL_MS = 1000; // 1 FPS
const GEMINI_OUTPUT_SAMPLE_RATE = 24000; // Gemini outputs 24kHz PCM
const MIC_SAMPLE_RATE = 16000;           // Gemini expects 16kHz input

function makeId() {
  return Math.random().toString(36).slice(2);
}

export function useLoreSession() {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string>(makeId());

  // Camera
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Separate contexts: capture at 16kHz, playback at 24kHz
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const captureWorkletRef = useRef<AudioWorkletNode | null>(null);
  const playbackWorkletRef = useRef<AudioWorkletNode | null>(null);
  const captureUrlRef = useRef<string | null>(null);
  const playbackUrlRef = useRef<string | null>(null);

  // Client-side interruption detection — tracks whether narrator audio is playing
  const isSpeakingRef = useRef(false);
  const micVadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Throttled text queue for assistant narration — text arrives faster than
  // audio plays, so we drip-feed chunks to keep them roughly in sync.
  const assistantQueueRef = useRef<string[]>([]);
  const drainTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const DRAIN_INTERVAL_MS = 300;

  function drainOneChunk() {
    const chunk = assistantQueueRef.current.shift();
    if (chunk === undefined) {
      if (drainTimerRef.current) {
        clearInterval(drainTimerRef.current);
        drainTimerRef.current = null;
      }
      return;
    }
    setTranscript((prev) => {
      const idx = prev.findLastIndex((l) => l.partial && l.role === "assistant");
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          text: updated[idx].text + chunk,
          timestamp: Date.now(),
        };
        return updated;
      }
      return [
        ...prev,
        { id: makeId(), role: "assistant", text: chunk, timestamp: Date.now(), partial: true },
      ];
    });
  }

  function enqueueAssistantPartial(text: string) {
    assistantQueueRef.current.push(text);
    if (!drainTimerRef.current) {
      drainOneChunk(); // show the first chunk immediately
      drainTimerRef.current = setInterval(drainOneChunk, DRAIN_INTERVAL_MS);
    }
  }

  function flushAssistantQueue(finalText: string) {
    assistantQueueRef.current = [];
    if (drainTimerRef.current) {
      clearInterval(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    setTranscript((prev) => {
      const idx = prev.findLastIndex((l) => l.partial && l.role === "assistant");
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          text: finalText,
          partial: false,
          timestamp: Date.now(),
        };
        return updated;
      }
      return [
        ...prev,
        { id: makeId(), role: "assistant", text: finalText, timestamp: Date.now(), partial: false },
      ];
    });
  }

  // -----------------------------------------------------------------------
  // Connect
  // -----------------------------------------------------------------------

  const connect = useCallback(async (videoElement: HTMLVideoElement) => {
    if (status === "connected" || status === "connecting") return;
    setStatus("connecting");

    videoRef.current = videoElement;
    canvasRef.current = document.createElement("canvas");

    const sessionId = (sessionIdRef.current = makeId());
    const url = `${SERVER_URL.replace(/^http/, "ws")}/ws/${sessionId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = async () => {
      setStatus("connected");
      try {
        await startAudio(ws);
        startFrameCapture(ws);
      } catch (err) {
        console.error("Audio/camera setup failed:", err);
      }
    };

    ws.onmessage = (evt) => {
      if (typeof evt.data === "string") {
        handleTextMessage(evt.data);
      } else if (evt.data instanceof ArrayBuffer) {
        handleBinaryMessage(new Uint8Array(evt.data));
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      stopAll();
    };

    ws.onerror = () => {
      setStatus("error");
      stopAll();
    };
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // -----------------------------------------------------------------------
  // Disconnect / end session
  // -----------------------------------------------------------------------

  const disconnect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_session" }));
    }
    stopAll();
  }, []);

  // -----------------------------------------------------------------------
  // Audio setup — two separate AudioContexts for capture vs playback
  // -----------------------------------------------------------------------

  async function startAudio(ws: WebSocket) {
    // --- Capture context (16kHz for mic → server) ---
    const captureCtx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    captureCtxRef.current = captureCtx;
    await captureCtx.resume();

    const captureUrl = createBlobUrl(AUDIO_WORKLET_PROCESSOR_SRC);
    captureUrlRef.current = captureUrl;
    await captureCtx.audioWorklet.addModule(captureUrl);
    const captureNode = new AudioWorkletNode(captureCtx, "pcm-capture-processor");
    captureWorkletRef.current = captureNode;

    captureNode.port.onmessage = (e) => {
      if (e.data.type === "pcm" && ws.readyState === WebSocket.OPEN) {
        const tagged = new Uint8Array(e.data.chunk.byteLength + 1);
        tagged[0] = 0x01; // audio tag
        tagged.set(new Uint8Array(e.data.chunk.buffer), 1);
        ws.send(tagged);
      }
    };

    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: MIC_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const micSource = captureCtx.createMediaStreamSource(micStream);
    micSource.connect(captureNode);

    // AnalyserNode for client-side voice activity detection
    const analyser = captureCtx.createAnalyser();
    analyser.fftSize = 512;
    analyserRef.current = analyser;
    micSource.connect(analyser);

    const vadBuffer = new Float32Array(analyser.fftSize);
    const MIC_RMS_THRESHOLD = 0.015;
    const CONSECUTIVE_FRAMES_NEEDED = 2;
    let consecutiveLoudFrames = 0;

    micVadIntervalRef.current = setInterval(() => {
      if (!isSpeakingRef.current) {
        consecutiveLoudFrames = 0;
        return;
      }
      analyser.getFloatTimeDomainData(vadBuffer);
      let sum = 0;
      for (let i = 0; i < vadBuffer.length; i++) sum += vadBuffer[i] * vadBuffer[i];
      const rms = Math.sqrt(sum / vadBuffer.length);

      if (rms > MIC_RMS_THRESHOLD) {
        consecutiveLoudFrames++;
        if (consecutiveLoudFrames >= CONSECUTIVE_FRAMES_NEEDED && playbackWorkletRef.current) {
          playbackWorkletRef.current.port.postMessage({ type: "flush" });
          consecutiveLoudFrames = 0;
        }
      } else {
        consecutiveLoudFrames = 0;
      }
    }, 80);

    // --- Playback context (24kHz for Gemini audio output) ---
    const playbackCtx = new AudioContext({ sampleRate: GEMINI_OUTPUT_SAMPLE_RATE });
    playbackCtxRef.current = playbackCtx;
    await playbackCtx.resume(); // Required: browsers suspend AudioContext until user gesture

    const playbackUrl = createBlobUrl(AUDIO_PLAYBACK_PROCESSOR_SRC);
    playbackUrlRef.current = playbackUrl;
    await playbackCtx.audioWorklet.addModule(playbackUrl);
    const playbackNode = new AudioWorkletNode(playbackCtx, "pcm-playback-processor");
    playbackWorkletRef.current = playbackNode;
    playbackNode.connect(playbackCtx.destination);
  }

  // -----------------------------------------------------------------------
  // Camera frame capture
  // -----------------------------------------------------------------------

  function startFrameCapture(ws: WebSocket) {
    const canvas = canvasRef.current!;
    canvas.width = 640;
    canvas.height = 480;
    const ctx2d = canvas.getContext("2d")!;

    frameIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || ws.readyState !== WebSocket.OPEN) return;

      ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          blob.arrayBuffer().then((buf) => {
            const tagged = new Uint8Array(buf.byteLength + 1);
            tagged[0] = 0x02; // video tag
            tagged.set(new Uint8Array(buf), 1);
            ws.send(tagged);
          });
        },
        "image/jpeg",
        0.7
      );
    }, FRAME_INTERVAL_MS);
  }

  // -----------------------------------------------------------------------
  // Incoming message handlers
  // -----------------------------------------------------------------------

  function handleTextMessage(raw: string) {
    try {
      const msg = JSON.parse(raw) as ServerMessage;

      if (msg.type === "transcript") {
        const isPartial = !!msg.partial;

        if (msg.role === "assistant") {
          // Throttle assistant text to match audio playback pace
          if (isPartial) {
            enqueueAssistantPartial(msg.text);
          } else {
            flushAssistantQueue(msg.text);
          }
          setIsSpeaking(true);
          isSpeakingRef.current = true;
        } else {
          // User text: show immediately (it's their own speech)
          setTranscript((prev) => {
            const idx = prev.findLastIndex((l) => l.partial && l.role === "user");
            if (isPartial) {
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  text: updated[idx].text + msg.text,
                  timestamp: Date.now(),
                };
                return updated;
              }
              return [
                ...prev,
                { id: makeId(), role: "user", text: msg.text, timestamp: Date.now(), partial: true },
              ];
            }
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                text: msg.text,
                partial: false,
                timestamp: Date.now(),
              };
              return updated;
            }
            return [
              ...prev,
              { id: makeId(), role: "user", text: msg.text, timestamp: Date.now(), partial: false },
            ];
          });
        }
      } else if (msg.type === "interrupted") {
        // User barged in — immediately flush stale audio and pending text
        if (playbackWorkletRef.current) {
          playbackWorkletRef.current.port.postMessage({ type: "flush" });
        }
        assistantQueueRef.current = [];
        if (drainTimerRef.current) {
          clearInterval(drainTimerRef.current);
          drainTimerRef.current = null;
        }
        // Finalize any in-progress assistant partial line
        setTranscript((prev) => {
          const idx = prev.findLastIndex((l) => l.partial && l.role === "assistant");
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], partial: false };
            return updated;
          }
          return prev;
        });
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      } else if (msg.type === "turn_complete") {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
      } else if (msg.type === "image") {
        setImages((prev) => [
          ...prev,
          {
            id: makeId(),
            image_url: msg.image_url,
            caption: msg.caption,
            timestamp: Date.now(),
          },
        ]);
      } else if (msg.type === "session_summary") {
        setSummary({ topics: msg.topics, transcript: msg.transcript, images: msg.images });
      }
    } catch {
      // Ignore malformed messages
    }
  }

  function handleBinaryMessage(data: Uint8Array) {
    // 0x01 = audio PCM from Gemini (24kHz, 16-bit signed)
    if (data[0] === 0x01 && playbackWorkletRef.current) {
      if (playbackCtxRef.current?.state === "suspended") {
        playbackCtxRef.current.resume();
      }
      // slice(1) creates a new aligned buffer — Int16Array requires even byte offset
      const payload = data.slice(1);
      const pcm = new Int16Array(payload.buffer);
      playbackWorkletRef.current.port.postMessage({ type: "pcm", chunk: pcm }, [pcm.buffer]);
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  function stopAll() {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (drainTimerRef.current) {
      clearInterval(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    if (micVadIntervalRef.current) {
      clearInterval(micVadIntervalRef.current);
      micVadIntervalRef.current = null;
    }
    assistantQueueRef.current = [];
    isSpeakingRef.current = false;
    captureCtxRef.current?.close();
    captureCtxRef.current = null;
    playbackCtxRef.current?.close();
    playbackCtxRef.current = null;
    if (captureUrlRef.current) URL.revokeObjectURL(captureUrlRef.current);
    if (playbackUrlRef.current) URL.revokeObjectURL(playbackUrlRef.current);
    wsRef.current?.close();
    wsRef.current = null;
  }

  useEffect(() => () => stopAll(), []); // Cleanup on unmount

  return {
    status,
    transcript,
    images,
    isSpeaking,
    summary,
    connect,
    disconnect,
  };
}
