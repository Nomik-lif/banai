"""Phase 7: voice endpoints — transcription and TTS."""

import io
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client():
    app = create_app()
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Transcribe
# ---------------------------------------------------------------------------


def test_transcribe_returns_text(client):
    mock_transcript = MagicMock()
    mock_transcript.text = "Make the wardrobe wider"
    with patch("app.api.voice.AsyncOpenAI") as mock_cls:
        mock_openai = AsyncMock()
        mock_cls.return_value = mock_openai
        mock_openai.audio.transcriptions.create = AsyncMock(return_value=mock_transcript)

        resp = client.post(
            "/api/transcribe",
            files={"audio": ("audio.webm", io.BytesIO(b"fake_audio_bytes"), "audio/webm")},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["text"] == "Make the wardrobe wider"


def test_transcribe_no_api_key(client):
    with patch("app.api.voice.get_settings") as mock_get:
        s = MagicMock()
        s.openai_api_key = ""
        mock_get.return_value = s
        resp = client.post(
            "/api/transcribe",
            files={"audio": ("audio.webm", io.BytesIO(b"x"), "audio/webm")},
        )
    assert resp.status_code == 503


def test_transcribe_file_too_large(client):
    big = b"x" * (26 * 1024 * 1024)
    resp = client.post(
        "/api/transcribe",
        files={"audio": ("audio.webm", io.BytesIO(big), "audio/webm")},
    )
    assert resp.status_code == 413


# ---------------------------------------------------------------------------
# TTS
# ---------------------------------------------------------------------------


def _mock_speech(content: bytes = b"fake_mp3"):
    mock_speech = MagicMock()
    mock_speech.content = content
    return mock_speech


def test_tts_returns_audio(client):
    with patch("app.api.voice.AsyncOpenAI") as mock_cls:
        mock_openai = AsyncMock()
        mock_cls.return_value = mock_openai
        mock_openai.audio.speech.create = AsyncMock(return_value=_mock_speech())

        resp = client.post("/api/tts", json={"text": "Your wardrobe is ready."})

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("audio/mpeg")
    assert resp.content == b"fake_mp3"


def test_tts_empty_text_rejected(client):
    resp = client.post("/api/tts", json={"text": ""})
    assert resp.status_code == 422


def test_tts_text_too_long(client):
    resp = client.post("/api/tts", json={"text": "a" * 4097})
    assert resp.status_code == 422


def test_tts_invalid_voice_defaults_to_alloy(client):
    with patch("app.api.voice.AsyncOpenAI") as mock_cls:
        mock_openai = AsyncMock()
        mock_cls.return_value = mock_openai
        mock_openai.audio.speech.create = AsyncMock(return_value=_mock_speech())

        resp = client.post("/api/tts", json={"text": "Hello", "voice": "not_a_voice"})

    assert resp.status_code == 200
    call_kwargs = mock_openai.audio.speech.create.call_args.kwargs
    assert call_kwargs["voice"] == "alloy"


def test_tts_no_api_key(client):
    with patch("app.api.voice.get_settings") as mock_get:
        s = MagicMock()
        s.openai_api_key = ""
        mock_get.return_value = s
        resp = client.post("/api/tts", json={"text": "Hello"})
    assert resp.status_code == 503


def test_tts_valid_voice_used(client):
    with patch("app.api.voice.AsyncOpenAI") as mock_cls:
        mock_openai = AsyncMock()
        mock_cls.return_value = mock_openai
        mock_openai.audio.speech.create = AsyncMock(return_value=_mock_speech())

        resp = client.post("/api/tts", json={"text": "Hello", "voice": "nova"})

    assert resp.status_code == 200
    call_kwargs = mock_openai.audio.speech.create.call_args.kwargs
    assert call_kwargs["voice"] == "nova"
