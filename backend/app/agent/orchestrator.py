"""Agent orchestrator: calls OpenAI, validates ops, returns reply + optional signed proposal."""

from __future__ import annotations

import json
import secrets
from typing import Any

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from app.agent.prompts import SYSTEM_PROMPT
from app.agent.tools import TOOLS
from app.domain.apply import apply_ops
from app.domain.catalog import load_catalog
from app.domain.errors import DomainError
from app.services.signing import design_hash, sign_proposal

MAX_RETRIES = 2


async def run_agent(
    messages: list[dict],
    design: dict,
    revision: int,
    openai_api_key: str,
    chat_model: str,
    signing_key: str,
) -> dict:
    """Run one agent turn. Returns {reply, proposal?}."""
    client = AsyncOpenAI(api_key=openai_api_key)
    catalog = load_catalog()
    base_hash = design_hash(design)

    history: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": SYSTEM_PROMPT + "\n\nCurrent design:\n" + json.dumps(design, ensure_ascii=False)},
        *[{"role": m["role"], "content": m["content"]} for m in messages],
    ]

    for attempt in range(MAX_RETRIES + 1):
        response = await client.chat.completions.create(
            model=chat_model,
            messages=history,
            tools=TOOLS,
            tool_choice="auto",
        )

        choice = response.choices[0]
        msg = choice.message

        # No tool call → plain reply
        if not msg.tool_calls:
            return {"reply": msg.content or ""}

        tool_call = msg.tool_calls[0]
        fn_name = tool_call.function.name

        try:
            args: dict[str, Any] = json.loads(tool_call.function.arguments)
        except json.JSONDecodeError:
            return {"reply": "I encountered an error processing the request. Please try again."}

        if fn_name == "ask_clarification":
            return {"reply": args.get("message", "")}

        if fn_name == "submit_ops":
            ops_raw = args.get("ops", [])
            summary = args.get("summary", "")

            try:
                apply_ops(design, ops_raw, catalog)
            except DomainError as err:
                if attempt < MAX_RETRIES:
                    # Feed the error back to the model for a retry
                    history.append({"role": "assistant", "content": None, "tool_calls": msg.tool_calls})
                    history.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": f"Validation failed: {err}. Please correct the ops and try again.",
                    })
                    continue
                return {"reply": f"I couldn't produce a valid proposal: {err.message}. Could you clarify your request?"}

            proposal = {
                "proposalId": secrets.token_hex(16),
                "baseRevision": revision,
                "baseHash": base_hash,
                "ops": ops_raw,
                "summary": summary,
                "signature": sign_proposal(ops_raw, revision, base_hash, signing_key),
            }
            return {"reply": summary, "proposal": proposal}

        return {"reply": "Unexpected tool call. Please try again."}

    return {"reply": "I couldn't produce a valid proposal after several attempts. Could you clarify your request?"}
