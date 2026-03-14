# Lore — Point Your Camera. Get a Documentary.

> A real-time AI documentary agent powered by Gemini Live API + Google ADK.
> Built for the **Gemini Live Agent Challenge** · Track: The Live Agent · Deadline: March 16, 2026

**Live Demo:** https://lore-server-bfnrkmdtyq-uc.a.run.app

---

## What Is Lore?

Point your phone camera at anything — a building, a tree, a painting, a street sign — and Lore instantly becomes your personal documentary narrator. It sees what you see, grounds facts via Google Search, and delivers captivating spoken narration with contextual images woven in. All in real-time, hands-free, interruptable.

**Core loop:**
`Camera → Gemini Live API (vision + voice) → Google Search grounding → Audio narration → Gemini image generation`

**Key features:**
- Real-time spoken narration via Gemini Live API (bidirectional audio + video)
- Google Search grounding — no hallucinated dates, names, or statistics
- Contextual image generation woven into the narration
- Voice interruption — ask questions mid-narration, Lore answers and resumes
- Tap-to-mute mic button (Google Meet-style) for noisy environments
- Session summary screen at the end with images and topics explored

---

## Architecture

```
[Mobile Browser]  ←── WebSocket ──→  [FastAPI on Cloud Run]  ←── bidi ──→  [Gemini Live API]
  Camera + Mic                          ADK Agent                            Vision + Audio
                                                               [Gemini Flash Image]
                                                               Contextual Images
```

**Stack:**

| Layer | Technology |
|-------|-----------|
| AI Model | Gemini Live API (`gemini-2.5-flash-native-audio-latest`) |
| Agent Framework | Google ADK (Python) ≥ 0.6 |
| Image Generation | Gemini Image (`gemini-2.5-flash-image`) |
| Search Grounding | ADK built-in `google_search` tool |
| Backend | FastAPI + uvicorn |
| Frontend | React 18 + Vite (TypeScript) |
| Hosting | Cloud Run |
| CI/CD | Cloud Build (`cloudbuild.yaml`) |

---

## Quick Start (Local)

### Prerequisites

- Python 3.11+
- Node.js 20+
- A Google API key with Gemini API enabled ([get one](https://aistudio.google.com/app/apikey))
- *(Optional)* A Google Cloud project for Cloud Run deployment

### 1. Clone & configure

```bash
git clone https://github.com/mohaksnghl/lore-ai.git
cd lore-ai
cp .env.example .env
# Edit .env — fill in GOOGLE_API_KEY at minimum
```

### 2. Start the server

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # or: python -m venv .venv && .venv\Scripts\activate on Windows
pip install -r requirements.txt
python main.py
# Server runs on http://localhost:8080
```

### 3. Start the client

```bash
cd client
npm install
npm run dev
# Client runs on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) on your phone (or use a browser with camera access), tap **Start Exploring**, and point the camera at something interesting.

---

## Deployment (Cloud Run)

### One-shot deploy

```bash
# Set your project
export GOOGLE_CLOUD_PROJECT=your-gcp-project-id

# Run the deploy script
./deploy.sh
```

This builds the Docker image via Cloud Build, pushes to Artifact Registry, and deploys to Cloud Run with WebSocket support (`--session-affinity`, 5-min timeout).

### Automated CI/CD

Connect `cloudbuild.yaml` to a Cloud Build trigger on your repo's `main` branch:

```bash
gcloud builds triggers create github \
  --repo-name=lore-ai \
  --repo-owner=<your-github-org> \
  --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --project=$GOOGLE_CLOUD_PROJECT
```

Every push to `main` will automatically build and deploy.

### Set secrets on Cloud Run

After deploying, add your API key as a secret:

```bash
echo -n "your-api-key" | gcloud secrets create GOOGLE_API_KEY --data-file=-

gcloud run services update lore-server \
  --update-secrets=GOOGLE_API_KEY=GOOGLE_API_KEY:latest \
  --region=us-central1
```

---

## Project Structure

```
lore-ai/
├── server/
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── lore_agent.py     # ADK Agent + system prompt
│   │   └── tools.py          # generate_image tool (Gemini Flash Image)
│   ├── main.py               # FastAPI WebSocket server
│   ├── requirements.txt
│   └── Dockerfile
├── client/
│   ├── src/
│   │   ├── App.tsx           # Root layout (camera 30% / narration flex / mic bar)
│   │   ├── components/
│   │   │   ├── CameraFeed.tsx
│   │   │   ├── NarrationPanel.tsx
│   │   │   └── MicButton.tsx
│   │   ├── hooks/
│   │   │   └── useLoreSession.ts  # WebSocket + audio + camera
│   │   ├── lib/
│   │   │   └── audioWorkletProcessor.ts
│   │   └── types/index.ts
│   ├── package.json
│   └── vite.config.ts
├── .env.example
├── .gitignore
├── cloudbuild.yaml           # Automated Cloud Build CI/CD
├── deploy.sh                 # Manual deploy script
└── README.md
```

---

## Wire Protocol

The WebSocket between client and server uses a simple binary framing:

**Client → Server (binary):**
- Byte `0x01` + raw PCM (16-bit, 16kHz, mono) = microphone audio
- Byte `0x02` + JPEG bytes = camera frame

**Server → Client (binary):**
- Byte `0x01` + raw PCM (24kHz) = Gemini's voice response

**Server → Client (text JSON):**
```jsonc
{ "type": "transcript", "text": "...", "role": "assistant" | "user" }
{ "type": "image", "image_url": "data:image/png;base64,...", "caption": "..." }
{ "type": "turn_complete" }
{ "type": "session_summary", "topics": [...], "transcript": [...], "images": [...] }
```

---

## Key Design Decisions

**Why ADK?**
Google ADK's `Runner.run_live()` with `StreamingMode.BIDI` handles the full bidirectional Gemini Live API session lifecycle, including tool calls, audio transcription, and VAD — so we don't have to manage WebSocket handshakes to Gemini directly.

**Why `--session-affinity` on Cloud Run?**
WebSocket connections must stick to the same instance. Without affinity, Cloud Run's load balancer can route mid-session requests to a different container.

**Why 1 FPS for camera?**
Gemini's vision identifies static subjects (buildings, plants, art) accurately at 1 FPS. Higher frame rates increase cost and bandwidth with no perceptual improvement for the documentary use case.

**Why Charon voice?**
Charon is Gemini's deepest, most cinematic voice — closest to the documentary narrator persona. See [Gemini voice options](https://cloud.google.com/vertex-ai/generative-ai/docs/speech/voice-options).

---

## References

- [multimodal-live-api-web-console](https://github.com/google-gemini/multimodal-live-api-web-console) — React client starter
- [adk-samples / bidi-demo](https://github.com/google/adk-samples/tree/main/python/agents/bidi-demo) — FastAPI + ADK streaming server
- [ADK Streaming Quickstart](https://google.github.io/adk-docs/get-started/streaming/quickstart-streaming/)
- [Gemini Live API Toolkit Dev Guide](https://google.github.io/adk-docs/streaming/dev-guide/part1/)

---

*Built for the Gemini Live Agent Challenge · March 2026*
