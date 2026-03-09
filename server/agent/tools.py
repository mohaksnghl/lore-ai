"""Custom tools for the Lore agent."""

import os
import base64
import logging
import uuid
from typing import Optional

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

# Nano Banana — Gemini native image generation
IMAGE_GEN_MODEL = "gemini-2.0-flash-exp-image-generation"

# Out-of-band image store: image_id -> {image_url, caption}
_image_store: dict[str, dict] = {}

_image_client: genai.Client | None = None


def _get_image_client() -> genai.Client:
    global _image_client
    if _image_client is None:
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY not set")
        _image_client = genai.Client(api_key=api_key)
    return _image_client


def generate_image(prompt: str, style: Optional[str] = None) -> dict:
    """Generate a contextual image to enrich the narration.

    Use this tool when a historical photo, diagram, map, scientific illustration,
    or visual comparison would enrich the narration. Call it naturally during
    narration — the image will appear on the user's screen as a visual footnote.

    Args:
        prompt: Detailed description of the image to generate. Be specific about
                era, style, subject, and mood. Example: "A black and white
                photograph from the 1920s showing Art Deco skyscrapers under
                construction in New York City, scaffolding visible, workers in
                period clothing."
        style: Optional style hint. One of: "photograph", "illustration",
               "diagram", "map", "painting". Defaults to "photograph".

    Returns:
        A dict with "image_id" (reference for the server to forward to client)
        and "status", or "error" if generation failed.
    """
    full_prompt = prompt
    if style:
        full_prompt = f"Generate a {style}: {prompt}"

    try:
        client = _get_image_client()
        response = client.models.generate_content(
            model=IMAGE_GEN_MODEL,
            contents=full_prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            ),
        )

        if response.candidates and response.candidates[0].content:
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                    b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                    mime = part.inline_data.mime_type
                    data_uri = f"data:{mime};base64,{b64}"
                    caption = prompt[:120]

                    image_id = uuid.uuid4().hex[:12]
                    _image_store[image_id] = {"image_url": data_uri, "caption": caption}
                    logger.info("Image stored (id=%s) for prompt: %s", image_id, prompt[:60])
                    return {"status": "Image generated and is now displayed to the user", "image_id": image_id}

        return {"error": "No image returned from model"}

    except Exception as exc:
        logger.error("Image generation failed: %s", exc)
        return {"error": str(exc)}
