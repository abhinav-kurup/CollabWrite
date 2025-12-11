from fastapi import APIRouter, Depends, HTTPException

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
    Check grammar for the given text with real-time suggestions.
    """
    try:
        if not request.text or len(request.text.strip()) < 3:
            return {"success": True, "data": {"issues": [], "summary": {"total_issues": 0, "categories": {}, "text_length": 0}}}
        
        result = await ai_service_manager.check_grammar(request.text, request.language)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Grammar check failed: {str(e)}")

@router.post("/paraphrase", response_model=AIResponse)
async def paraphrase_text(
    request: ParaphraseRequest,
    current_user: User = Depends(deps.get_current_user),
):
    """
    Generate paraphrased alternatives for the given text.
    """
    try:
        if not request.text or len(request.text.strip()) < 5:
            raise HTTPException(status_code=400, detail="Text must be at least 5 characters long")
        
        result = await ai_service_manager.paraphrase_text(
            request.text, request.num_alternatives, request.context
        )
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Paraphrasing failed: {str(e)}")

@router.post("/summarize", response_model=AIResponse)
async def summarize_text(
    request: SummarizeRequest,
    current_user: User = Depends(deps.get_current_user),
):
    """
    Generate a summary and optional headline for the given text.
    """
    try:
        if not request.text or len(request.text.strip()) < 20:
            raise HTTPException(status_code=400, detail="Text must be at least 20 characters long")
        
        result = await ai_service_manager.summarize_text(
            request.text, request.include_headline
        )
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summarization failed: {str(e)}")

@router.post("/suggest", response_model=AIResponse)
async def get_ai_suggestions(
    request: AITextRequest,
    current_user: User = Depends(deps.get_current_user),
):
    """
    Get AI-powered writing suggestions for the given text.
    """
    try:
        if not request.text or len(request.text.strip()) < 10:
            raise HTTPException(status_code=400, detail="Text must be at least 10 characters long")
        
        # Get both grammar and style suggestions
        grammar_result = await ai_service_manager.check_grammar(request.text, request.language)
        
        # Get paraphrasing suggestions for improvement
        paraphrase_result = await ai_service_manager.paraphrase_text(request.text, 2, "Improve writing style")
        
        # Combine results
        suggestions = {
            "grammar": grammar_result,
            "style_improvements": paraphrase_result,
            "summary": {
                "total_suggestions": grammar_result["summary"]["total_issues"] + len(paraphrase_result["paraphrases"]),
                "grammar_issues": grammar_result["summary"]["total_issues"],
                "style_alternatives": len(paraphrase_result["paraphrases"])
            }
        }
        
        return {"success": True, "data": suggestions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI suggestions failed: {str(e)}")

@router.get("/health")
async def ai_health_check():
    """
    Check the health status of all AI services.
    Returns 503 if any service is unhealthy.
    """
    try:
        health_status = await ai_service_manager.get_health_status()
        
        # Return 503 Service Unavailable if any service is unhealthy
        if health_status.get("status") in ["degraded", "error", "not_initialized"]:
            raise HTTPException(
                status_code=503,
                detail={"success": False, "data": health_status}
            )
        
        return {"success": True, "data": health_status}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Health check failed: {str(e)}") 