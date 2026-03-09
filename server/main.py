"""Lore FastAPI WebSocket server.

Bridges the React client and the Gemini Live API via Google ADK.
Each WebSocket connection spawns an ADK agent session with bidirectional
audio + video streaming.

Architecture:
  [Browser] <--WS--> [This server] <--bidi--> [Gemini Live API]
                          |
                     [Firestore]  [Nano Banana / Image Gen]
"""

import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()  # Load .env before ADK/genai clients initialize


import firebase_admin
from firebase_admin import credentials, firestore_async
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.genai import types as genai_types
from google.genai.types import SessionResumptionConfig

from agent import root_agent
from agent.tools import _image_store

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Suppress verbose tracebacks from the Gemini Live API for known transient
# errors (1007/1008/1011) — our own retry logic handles them.
logging.getLogger("google_adk.google.adk.flows.llm_flows.base_llm_flow").setLevel(logging.CRITICAL)
logging.getLogger("google.genai.live").setLevel(logging.WARNING)

# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

db = None  # Firestore async client


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db
    # Initialize Firebase only if credentials are provided
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if cred_path and os.path.exists(cred_path) and project_id and not firebase_admin._apps:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred, {"projectId": project_id})
        db = firestore_async.client()
        logger.info("Firestore initialized for project %s", project_id)
    else:
        logger.warning("Firestore not configured — session data will not be persisted")
    yield


app = FastAPI(title="Lore API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared session service (in-memory for hackathon; swap for DB-backed in prod)
session_service = InMemorySessionService()

APP_NAME = "lore"

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {"status": "ok", "app": APP_NAME}


# ---------------------------------------------------------------------------
# WebSocket session handler
# ---------------------------------------------------------------------------


@app.websocket("/ws/{client_session_id}")
async def websocket_endpoint(websocket: WebSocket, client_session_id: str):
    """One WebSocket connection = one Lore documentary session."""
    await websocket.accept()
    logger.info("Client connected: %s", client_session_id)

    # Create ADK session
    session = await session_service.create_session(
        app_name=APP_NAME,
        user_id=client_session_id,
    )

    # Mutable containers so retry logic can swap in fresh instances
    # and client_to_agent always references the current ones
    queue_holder: dict[str, LiveRequestQueue] = {"q": LiveRequestQueue()}
    session_holder: dict[str, str] = {"id": session.id}

    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=["AUDIO"],
        output_audio_transcription=genai_types.AudioTranscriptionConfig(),
        input_audio_transcription=genai_types.AudioTranscriptionConfig(),
        speech_config=genai_types.SpeechConfig(
            voice_config=genai_types.VoiceConfig(
                prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                    voice_name="Charon",
                )
            )
        ),
        realtime_input_config=genai_types.RealtimeInputConfig(
            automatic_activity_detection=genai_types.AutomaticActivityDetection(
                start_of_speech_sensitivity=genai_types.StartSensitivity.START_SENSITIVITY_HIGH,
                end_of_speech_sensitivity=genai_types.EndSensitivity.END_SENSITIVITY_HIGH,
                prefix_padding_ms=100,
                silence_duration_ms=500,
            ),
            activity_handling=genai_types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
            turn_coverage=genai_types.TurnCoverage.TURN_INCLUDES_ALL_INPUT,
        ),
        session_resumption=SessionResumptionConfig(handle=None),
    )

    runner = Runner(
        agent=root_agent,
        app_name=APP_NAME,
        session_service=session_service,
    )

    # Track session data for Firestore
    session_topics: list[dict] = []
    session_transcript: list[str] = []
    generated_images: list[dict] = []

    async def agent_to_client():
        """Forward ADK agent events → WebSocket client."""
        MAX_RETRIES = 3
        RETRYABLE_CODES = ("1000", "1007", "1008", "1011")
        retry_count = 0

        while retry_count <= MAX_RETRIES:
            try:
                async for event in runner.run_live(
                    user_id=client_session_id,
                    session_id=session_holder["id"],
                    live_request_queue=queue_holder["q"],
                    run_config=run_config,
                ):
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if part.inline_data and part.inline_data.data:
                                await websocket.send_bytes(
                                    _pack_audio(part.inline_data.data)
                                )

                            if part.function_call:
                                logger.info("Tool call: %s(%s)",
                                    part.function_call.name,
                                    str(part.function_call.args)[:120])

                            if part.function_response:
                                logger.info("Tool result: %s -> %s",
                                    part.function_response.name,
                                    str(part.function_response.response)[:120])

                            if part.function_response and part.function_response.name == "generate_image":
                                resp = part.function_response.response or {}
                                try:
                                    image_id = resp.get("image_id")
                                except AttributeError:
                                    image_id = None
                                if image_id and image_id in _image_store:
                                    image_data = _image_store.pop(image_id)
                                    generated_images.append(image_data)
                                    logger.info("Sending image to client, caption=%s", image_data.get("caption", "")[:60])
                                    await websocket.send_text(
                                        json.dumps({"type": "image", **image_data})
                                    )

                    if event.output_transcription and event.output_transcription.text:
                        text = event.output_transcription.text
                        is_partial = bool(event.partial)
                        if not is_partial:
                            session_transcript.append(text)
                        await websocket.send_text(
                            json.dumps({
                                "type": "transcript",
                                "text": text,
                                "role": "assistant",
                                "partial": is_partial,
                            })
                        )

                    if event.input_transcription and event.input_transcription.text:
                        text = event.input_transcription.text
                        is_partial = bool(event.partial)
                        await websocket.send_text(
                            json.dumps({
                                "type": "transcript",
                                "text": text,
                                "role": "user",
                                "partial": is_partial,
                            })
                        )

                    if event.grounding_metadata:
                        chunks = getattr(event.grounding_metadata, 'grounding_chunks', None) or []
                        if chunks:
                            sources = [getattr(c, 'web', None) for c in chunks if getattr(c, 'web', None)]
                            logger.info("Grounded via %d sources: %s",
                                len(sources),
                                [getattr(s, 'uri', '')[:60] for s in sources[:3]])

                    if event.interrupted:
                        logger.info("User interrupted — flushing client audio")
                        await websocket.send_text(json.dumps({"type": "interrupted"}))

                    if event.turn_complete:
                        await websocket.send_text(json.dumps({"type": "turn_complete"}))

                break

            except Exception as exc:
                error_msg = str(exc)
                is_retryable = any(code in error_msg for code in RETRYABLE_CODES)
                retry_count += 1

                if is_retryable and retry_count <= MAX_RETRIES:
                    backoff = min(2 ** retry_count, 8)
                    logger.warning(
                        "Live API session dropped (%s), reconnecting in %.1fs (attempt %d/%d)...",
                        error_msg[:80], backoff, retry_count, MAX_RETRIES,
                    )
                    queue_holder["q"].close()
                    queue_holder["q"] = LiveRequestQueue()
                    try:
                        new_session = await session_service.create_session(
                            app_name=APP_NAME,
                            user_id=client_session_id,
                        )
                        session_holder["id"] = new_session.id
                        logger.info("Created fresh session: %s", new_session.id)
                    except Exception as session_exc:
                        logger.error("Failed to create new session: %s", session_exc)
                    await asyncio.sleep(backoff)
                    continue
                else:
                    logger.error("agent_to_client error: %s", exc, exc_info=True)
                    try:
                        await websocket.send_text(
                            json.dumps({"type": "error", "message": "Session dropped — please reconnect"})
                        )
                    except Exception:
                        pass
                    break

        queue_holder["q"].close()

    async def client_to_agent():
        """Forward WebSocket client messages → ADK LiveRequestQueue."""
        try:
            while True:
                message = await websocket.receive()

                if "bytes" in message and message["bytes"]:
                    # Raw bytes: audio PCM or video frame
                    data = message["bytes"]
                    # First byte is a type tag we set on the client:
                    # 0x01 = audio, 0x02 = video frame
                    if len(data) < 2:
                        continue
                    msg_type = data[0]
                    payload = data[1:]

                    if msg_type == 0x01:
                        # Audio PCM (16-bit, 16kHz, mono)
                        try:
                            queue_holder["q"].send_realtime(
                                genai_types.Blob(
                                    data=payload,
                                    mime_type="audio/pcm;rate=16000",
                                )
                            )
                        except Exception:
                            pass
                    elif msg_type == 0x02:
                        # Video frame (JPEG)
                        try:
                            queue_holder["q"].send_realtime(
                                genai_types.Blob(
                                    data=payload,
                                    mime_type="image/jpeg",
                                )
                            )
                        except Exception:
                            pass

                elif "text" in message and message["text"]:
                    msg = json.loads(message["text"])
                    msg_type = msg.get("type")

                    if msg_type == "end_session":
                        logger.info("Client ended session: %s", client_session_id)
                        await _save_session(
                            client_session_id,
                            session_topics,
                            session_transcript,
                            generated_images,
                        )
                        # Send session summary back
                        await websocket.send_text(
                            json.dumps({
                                "type": "session_summary",
                                "topics": session_topics,
                                "transcript": session_transcript[-50:],  # last 50 lines
                                "images": [
                                    {"caption": img["caption"]}
                                    for img in generated_images
                                ],
                            })
                        )
                        break

                    elif msg_type == "topic":
                        # Client tells us what was identified
                        session_topics.append(msg.get("data", {}))

        except WebSocketDisconnect:
            logger.info("Client disconnected: %s", client_session_id)
        except Exception as exc:
            logger.error("client_to_agent error: %s", exc, exc_info=True)
        finally:
            queue_holder["q"].close()

    # Run both directions concurrently
    await asyncio.gather(
        agent_to_client(),
        client_to_agent(),
        return_exceptions=True,
    )

    logger.info("Session closed: %s", client_session_id)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _pack_audio(pcm_data: bytes) -> bytes:
    """Prefix audio bytes with type tag 0x01 so client knows it's audio."""
    return bytes([0x01]) + pcm_data


async def _save_session(
    session_id: str,
    topics: list,
    transcript: list,
    images: list,
) -> None:
    """Persist session data to Firestore."""
    if db is None:
        return
    try:
        import datetime
        doc_ref = db.collection("sessions").document(session_id)
        await doc_ref.set(
            {
                "session_id": session_id,
                "topics": topics,
                "transcript": transcript,
                "image_count": len(images),
                "image_captions": [img.get("caption", "") for img in images],
                "created_at": datetime.datetime.utcnow(),
            }
        )
        logger.info("Session %s saved to Firestore", session_id)
    except Exception as exc:
        logger.error("Failed to save session to Firestore: %s", exc)


# ---------------------------------------------------------------------------
# Serve React frontend (static files built into ./static by Dockerfile)
# ---------------------------------------------------------------------------

_static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
    logger.info("Serving React frontend from %s", _static_dir)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8080)),
        reload=False,
    )
