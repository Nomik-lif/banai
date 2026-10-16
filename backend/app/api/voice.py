"""Voice endpoints: audio transcription (Whisper) and text-to-speech (TTS-1)."""

import io

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from openai import AsyncOpenAI
from pydantic import BaseModel, field_validator

from app.config import get_settings

router = APIRouter()

_MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB — Whisper's hard limit
_ALLOWED_VOICES = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}


@router.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail={"code": "NO_API_KEY", "message": "OpenAI API key not configured"},
        )

    data = await audio.read()
    if len(data) > _MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"code": "FILE_TOO_LARGE", "message": "Audio file exceeds 25 MB limit"},
        )

    filename = audio.filename or "recording.webm"
    content_type = audio.content_type or "audio/webm"

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    transcript = await client.audio.transcriptions.create(
        model="whisper-1",
        file=(filename, io.BytesIO(data), content_type),
    )
    return {"success": True, "data": {"text": transcript.text}}


class _TTSRequest(BaseModel):
    text: str
    voice: str = "alloy"

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text is required")
        if len(v) > 4096:
            raise ValueError("text exceeds 4096 characters")
        return v

    @field_validator("voice")
    @classmethod
    def coerce_voice(cls, v: str) -> str:
        return v if v in _ALLOWED_VOICES else "alloy"


@router.post("/api/tts")
async def tts(body: _TTSRequest):
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail={"code": "NO_API_KEY", "message": "OpenAI API key not configured"},
        )

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    speech = await client.audio.speech.create(
        model="tts-1",
        voice=body.voice,
        input=body.text,
        response_format="mp3",
    )
    return Response(
        content=speech.content,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )
