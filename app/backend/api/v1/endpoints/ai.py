from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api import deps
from core.ai.service_manager import ai_service_manager
from models.user import User
from schemas.ai import AITextRequest, ParaphraseRequest, SummarizeRequest, AIResponse

router = APIRouter()

@router.on_event("startup")
async def startup_event():
    await ai_service_manager.initialize()

@router.post("/grammar", response_model=AIResponse)
async def check_grammar(
    request: AITextRequest,
    current_user: User = Depends(deps.get_current_user),
):
    """
    Check grammar for the given text.
    """
    try:
        result = await ai_service_manager.check_grammar(request.text, request.language or "en")
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/paraphrase", response_model=AIResponse)
async def paraphrase_text(
    request: ParaphraseRequest,
    current_user: User = Depends(deps.get_current_user),
):
    """
    Paraphrase the given text.
    """
    try:
        result = await ai_service_manager.paraphrase_text(
            request.text, request.num_alternatives, request.context
        )
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/summarize", response_model=AIResponse)
async def summarize_text(
    request: SummarizeRequest,
    current_user: User = Depends(deps.get_current_user),
):
    """
    Summarize the given text.
    """
    try:
        result = await ai_service_manager.summarize_text(
            request.text, request.include_headline
        )
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/prompt", response_model=AIResponse)
async def handle_prompt(
    request: AITextRequest,
    current_user: User = Depends(deps.get_current_user),
):
    """
    Handle a context-aware AI prompt.
    NOTE: This is a placeholder and needs to be implemented.
    """
    # Placeholder implementation
    raise HTTPException(status_code=501, detail="Not Implemented") 