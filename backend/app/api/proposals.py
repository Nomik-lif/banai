"""POST /api/proposals/apply — verify signature, check staleness, apply ops."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.domain.apply import apply_ops
from app.domain.catalog import load_catalog
from app.domain.errors import DomainError
from app.services.signing import design_hash, verify_proposal

router = APIRouter(prefix="/api")


class ProposalBody(BaseModel):
    proposal_id: str = Field(alias="proposalId")
    base_revision: int = Field(alias="baseRevision", ge=1)
    base_hash: str = Field(alias="baseHash")
    ops: list
    summary: str = Field(max_length=400)
    signature: str

    model_config = {"populate_by_name": True}


class ApplyRequest(BaseModel):
    design: dict
    revision: int = Field(ge=1)
    proposal: ProposalBody


@router.post("/proposals/apply")
async def apply_proposal(body: ApplyRequest, settings: Settings = Depends(get_settings)):
    p = body.proposal

    # Verify HMAC signature
    if not verify_proposal(p.ops, p.base_revision, p.base_hash, p.signature, settings.proposal_signing_key):
        return JSONResponse(status_code=400, content={"success": False, "error": {"code": "INVALID_SIGNATURE", "message": "Proposal signature is invalid."}})

    # Staleness check
    if body.revision != p.base_revision or design_hash(body.design) != p.base_hash:
        return JSONResponse(status_code=409, content={"success": False, "error": {"code": "STALE", "message": "Design has changed since this proposal was created."}})

    # Apply
    catalog = load_catalog()
    try:
        new_design = apply_ops(body.design, p.ops, catalog)
    except DomainError as err:
        return JSONResponse(status_code=422, content={"success": False, "error": err.to_dict()})

    return {"success": True, "data": {"design": new_design, "revision": body.revision + 1}}
