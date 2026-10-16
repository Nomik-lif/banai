"""POST /api/chat — one agent turn."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.agent.orchestrator import run_agent
from app.config import Settings, get_settings

router = APIRouter(prefix="/api")

MAX_MESSAGES = 40
MAX_CONTENT = 4000


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_CONTENT)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=MAX_MESSAGES)
    design: dict
    revision: int = Field(ge=1)


@router.post("/chat")
async def chat(body: ChatRequest, settings: Settings = Depends(get_settings)):
    result = await run_agent(
        messages=[m.model_dump() for m in body.messages],
        design=body.design,
        revision=body.revision,
        openai_api_key=settings.openai_api_key,
        chat_model=settings.openai_chat_model,
        signing_key=settings.proposal_signing_key,
    )
    return {"success": True, "data": result}
