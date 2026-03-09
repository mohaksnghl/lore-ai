export type MessageRole = "assistant" | "user";

export interface TranscriptLine {
  id: string;
  role: MessageRole;
  text: string;
  timestamp: number;
  partial?: boolean;
}

export interface GeneratedImage {
  id: string;
  image_url: string;
  caption: string;
  timestamp: number;
}

export interface SessionSummary {
  topics: Topic[];
  transcript: string[];
  images: { caption: string }[];
}

export interface Topic {
  name?: string;
  description?: string;
  timestamp?: number;
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

// Wire protocol message types from server
export type ServerMessage =
  | { type: "transcript"; text: string; role: MessageRole; partial?: boolean }
  | { type: "image"; image_url: string; caption: string }
  | { type: "turn_complete" }
  | { type: "interrupted" }
  | { type: "error"; message: string }
  | { type: "session_summary"; topics: Topic[]; transcript: string[]; images: { caption: string }[] };
