from pydantic import BaseModel, Field
from typing import Optional

class AITextRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Text to process")
    language: Optional[str] = Field("en-US", description="Language code (e.g., 'en-US')")

class ParaphraseRequest(AITextRequest):
    num_alternatives: int = Field(3, gt=0, le=5, description="Number of alternatives to generate")
    context: Optional[str] = None

class SummarizeRequest(AITextRequest):
    include_headline: bool = Field(True, description="Whether to include a headline in the summary")

class AIResponse(BaseModel):
    success: bool = True
    data: dict 