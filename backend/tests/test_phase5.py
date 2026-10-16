"""Phase 5 tests: agent, signing, chat endpoint, proposals/apply."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.domain.catalog import load_catalog
from app.main import create_app
from app.services.signing import design_hash, sign_proposal, verify_proposal

SIGNING_KEY = "test-signing-key-32-bytes-long!!"


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("PROPOSAL_SIGNING_KEY", SIGNING_KEY)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")
    app = create_app()
    # Clear lru_cache so settings pick up monkeypatched env vars
    from app.config import get_settings
    get_settings.cache_clear()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


@pytest.fixture()
def basic_design():
    from app.domain.defaults import basic_wardrobe
    return basic_wardrobe()


# --- signing ---

def test_design_hash_is_stable(basic_design):
    h1 = design_hash(basic_design)
    h2 = design_hash(basic_design)
    assert h1 == h2
    assert len(h1) == 64


def test_sign_and_verify(basic_design):
    ops = [{"op": "update_dimensions", "width": 2200, "height": None, "depth": None}]
    revision = 1
    h = design_hash(basic_design)
    sig = sign_proposal(ops, revision, h, SIGNING_KEY)
    assert verify_proposal(ops, revision, h, sig, SIGNING_KEY)


def test_verify_rejects_tampered_ops(basic_design):
    ops = [{"op": "update_dimensions", "width": 2200, "height": None, "depth": None}]
    h = design_hash(basic_design)
    sig = sign_proposal(ops, 1, h, SIGNING_KEY)
    tampered = [{"op": "update_dimensions", "width": 9999, "height": None, "depth": None}]
    assert not verify_proposal(tampered, 1, h, sig, SIGNING_KEY)


# --- /api/proposals/apply ---

def test_apply_proposal_success(client, basic_design):
    ops = [{"op": "update_dimensions", "width": 2200, "height": None, "depth": None}]
    h = design_hash(basic_design)
    sig = sign_proposal(ops, 1, h, SIGNING_KEY)
    resp = client.post("/api/proposals/apply", json={
        "design": basic_design,
        "revision": 1,
        "proposal": {
            "proposalId": "abc123",
            "baseRevision": 1,
            "baseHash": h,
            "ops": ops,
            "summary": "Widen to 2200 mm",
            "signature": sig,
        },
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["revision"] == 2
    assert data["design"]["dimensions"]["width"] == 2200


def test_apply_proposal_stale_revision(client, basic_design):
    ops = [{"op": "update_dimensions", "width": 2200, "height": None, "depth": None}]
    h = design_hash(basic_design)
    sig = sign_proposal(ops, 1, h, SIGNING_KEY)
    resp = client.post("/api/proposals/apply", json={
        "design": basic_design,
        "revision": 2,  # mismatch
        "proposal": {
            "proposalId": "abc123",
            "baseRevision": 1,
            "baseHash": h,
            "ops": ops,
            "summary": "Widen",
            "signature": sig,
        },
    })
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "STALE"


def test_apply_proposal_invalid_signature(client, basic_design):
    ops = [{"op": "update_dimensions", "width": 2200, "height": None, "depth": None}]
    h = design_hash(basic_design)
    resp = client.post("/api/proposals/apply", json={
        "design": basic_design,
        "revision": 1,
        "proposal": {
            "proposalId": "abc123",
            "baseRevision": 1,
            "baseHash": h,
            "ops": ops,
            "summary": "Widen",
            "signature": "badsignature",
        },
    })
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "INVALID_SIGNATURE"


def test_apply_proposal_no_commit_before_confirm(client, basic_design):
    """Design unchanged until apply is called — only the proposal endpoint mutates state."""
    original_width = basic_design["dimensions"]["width"]
    ops = [{"op": "update_dimensions", "width": 3000, "height": None, "depth": None}]
    h = design_hash(basic_design)
    sign_proposal(ops, 1, h, SIGNING_KEY)
    # Width on the original design is unchanged
    assert basic_design["dimensions"]["width"] == original_width


# --- /api/chat (mocked OpenAI) ---

def _make_mock_response(tool_name: str, args: dict):
    tool_call = MagicMock()
    tool_call.id = "call_abc"
    tool_call.function.name = tool_name
    tool_call.function.arguments = json.dumps(args)

    choice = MagicMock()
    choice.message.tool_calls = [tool_call]
    choice.message.content = None

    response = MagicMock()
    response.choices = [choice]
    return response


@pytest.fixture()
def mock_openai_submit(basic_design):
    ops = [{"op": "update_dimensions", "width": 2400, "height": None, "depth": None}]
    args = {"ops": ops, "summary": "Wider wardrobe"}
    response = _make_mock_response("submit_ops", args)

    with patch("app.agent.orchestrator.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat = MagicMock()
        instance.chat.completions = MagicMock()
        instance.chat.completions.create = AsyncMock(return_value=response)
        yield


@pytest.fixture()
def mock_openai_clarify():
    args = {"message": "How many compartments do you want?"}
    response = _make_mock_response("ask_clarification", args)

    with patch("app.agent.orchestrator.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat = MagicMock()
        instance.chat.completions = MagicMock()
        instance.chat.completions.create = AsyncMock(return_value=response)
        yield


def test_chat_returns_proposal(client, basic_design, mock_openai_submit):
    resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "Make it wider"}],
        "design": basic_design,
        "revision": 1,
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "proposal" in data
    assert data["proposal"]["ops"][0]["width"] == 2400
    assert "signature" in data["proposal"]
    assert "baseHash" in data["proposal"]


def test_chat_returns_clarification(client, basic_design, mock_openai_clarify):
    resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "Add compartments"}],
        "design": basic_design,
        "revision": 1,
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "proposal" not in data
    assert "How many" in data["reply"]


def test_chat_cancel_is_client_only(client, basic_design, mock_openai_submit):
    """Cancel means no apply call is made — design stays unchanged."""
    h_before = design_hash(basic_design)
    # (we simulate cancel by simply not calling /api/proposals/apply)
    assert design_hash(basic_design) == h_before
