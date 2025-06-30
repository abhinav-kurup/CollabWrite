"""
Text Summarization Service

This service uses Hugging Face models to generate summaries and headlines
for text content in the collaborative editor.
"""

import asyncio
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from fastapi import HTTPException
import logging
import torch
from transformers import (
    AutoTokenizer,
    AutoModelForSeq2SeqLM,
    pipeline
)

logger = logging.getLogger(__name__)


@dataclass
class SummaryResult:
    """Represents a summarized version of text."""
    summary: str
    headline: str
    confidence: float
    compression_ratio: float


class SummarizeService:
    """Service for text summarization using Hugging Face models."""
    
    def __init__(self, model_name: str = "facebook/bart-large-cnn"):
        """
        Initialize the summarize service.
        
        Args:
            model_name: Hugging Face model name for summarization
        """
        self.model_name = model_name
        self.tokenizer: Optional[AutoTokenizer] = None
        self.model: Optional[AutoModelForSeq2SeqLM] = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self._initialized = False
    
    async def _initialize_model(self):
        """Initialize the model and tokenizer asynchronously."""
        if self._initialized:
            return
        
        try:
            logger.info(f"Loading summarization model: {self.model_name}")
            
            # Run model loading in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            
            def load_model():
                tokenizer = AutoTokenizer.from_pretrained(self.model_name)
                model = AutoModelForSeq2SeqLM.from_pretrained(self.model_name)
                model.to(self.device)
                return tokenizer, model
            
            self.tokenizer, self.model = await loop.run_in_executor(None, load_model)
            self._initialized = True
            
            logger.info("Summarization model loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load summarization model: {e}")
            raise HTTPException(
                status_code=500,
                detail="Failed to initialize summarization model"
            )
    
    async def summarize_text(
        self, 
        text: str, 
        max_length: int = 130,
        min_length: int = 30,
        do_sample: bool = False
    ) -> SummaryResult:
        """
        Generate a summary for the given text.
        
        Args:
            text: The text to summarize
            max_length: Maximum length of the summary
            min_length: Minimum length of the summary
            do_sample: Whether to use sampling for generation
            
        Returns:
            Summary result with summary and headline
            
        Raises:
            HTTPException: If summarization fails
        """
        if not text.strip():
            raise HTTPException(
                status_code=400,
                detail="Text cannot be empty"
            )
        
        await self._initialize_model()
        
        try:
            # Run inference in thread pool
            loop = asyncio.get_event_loop()
            
            def generate_summary():
                # Tokenize input
                inputs = self.tokenizer(
                    text,
                    return_tensors="pt",
                    max_length=1024,
                    truncation=True,
                    padding=True
                ).to(self.device)
                
                # Generate summary
                summary_ids = self.model.generate(
                    **inputs,
                    max_length=max_length,
                    min_length=min_length,
                    do_sample=do_sample,
                    num_beams=4,
                    early_stopping=True,
                    pad_token_id=self.tokenizer.eos_token_id
                )
                
                # Decode summary
                summary = self.tokenizer.decode(
                    summary_ids[0], 
                    skip_special_tokens=True
                )
                
                # Generate headline (shorter version)
                headline_ids = self.model.generate(
                    **inputs,
                    max_length=50,
                    min_length=10,
                    do_sample=do_sample,
                    num_beams=4,
                    early_stopping=True,
                    pad_token_id=self.tokenizer.eos_token_id
                )
                
                headline = self.tokenizer.decode(
                    headline_ids[0], 
                    skip_special_tokens=True
                )
                
                # Calculate compression ratio
                compression_ratio = len(summary) / len(text) if text else 0
                
                # Calculate confidence (simplified)
                confidence = 0.85  # Placeholder - could be improved with model confidence
                
                return SummaryResult(
                    summary=summary,
                    headline=headline,
                    confidence=confidence,
                    compression_ratio=compression_ratio
                )
            
            result = await loop.run_in_executor(None, generate_summary)
            return result
            
        except Exception as e:
            logger.error(f"Summarization failed: {e}")
            raise HTTPException(
                status_code=500,
                detail="Failed to generate summary"
            )
    
    async def summarize_section(
        self, 
        text: str, 
        section_type: str = "general"
    ) -> Dict[str, Any]:
        """
        Generate a summary optimized for a specific section type.
        
        Args:
            text: The text to summarize
            section_type: Type of section (e.g., "introduction", "conclusion", "general")
            
        Returns:
            Dictionary with summary and metadata
        """
        # Adjust parameters based on section type
        if section_type == "introduction":
            max_length = 100
            min_length = 20
        elif section_type == "conclusion":
            max_length = 120
            min_length = 30
        else:
            max_length = 130
            min_length = 30
        
        result = await self.summarize_text(text, max_length, min_length)
        
        return {
            "original_text": text,
            "section_type": section_type,
            "summary": result.summary,
            "headline": result.headline,
            "confidence": result.confidence,
            "compression_ratio": result.compression_ratio,
            "metadata": {
                "max_length": max_length,
                "min_length": min_length,
                "word_count": len(text.split()),
                "summary_word_count": len(result.summary.split())
            }
        }
    
    async def generate_headline(self, text: str) -> str:
        """
        Generate a headline for the given text.
        
        Args:
            text: The text to generate a headline for
            
        Returns:
            Generated headline
            
        Raises:
            HTTPException: If headline generation fails
        """
        if not text.strip():
            raise HTTPException(
                status_code=400,
                detail="Text cannot be empty"
            )
        
        await self._initialize_model()
        
        try:
            # Run inference in thread pool
            loop = asyncio.get_event_loop()
            
            def generate_headline():
                # Tokenize input
                inputs = self.tokenizer(
                    text,
                    return_tensors="pt",
                    max_length=1024,
                    truncation=True,
                    padding=True
                ).to(self.device)
                
                # Generate headline
                headline_ids = self.model.generate(
                    **inputs,
                    max_length=50,
                    min_length=10,
                    num_beams=4,
                    early_stopping=True,
                    pad_token_id=self.tokenizer.eos_token_id
                )
                
                # Decode headline
                headline = self.tokenizer.decode(
                    headline_ids[0], 
                    skip_special_tokens=True
                )
                
                return headline
            
            headline = await loop.run_in_executor(None, generate_headline)
            return headline
            
        except Exception as e:
            logger.error(f"Headline generation failed: {e}")
            raise HTTPException(
                status_code=500,
                detail="Failed to generate headline"
            )
    
    async def get_summary_suggestions(
        self, 
        text: str, 
        include_headline: bool = True
    ) -> Dict[str, Any]:
        """
        Get summarization suggestions with additional context.
        
        Args:
            text: The text to summarize
            include_headline: Whether to include headline generation
            
        Returns:
            Dictionary with summary and metadata
        """
        summary_result = await self.summarize_text(text)
        
        result = {
            "original_text": text,
            "summary": summary_result.summary,
            "confidence": summary_result.confidence,
            "compression_ratio": summary_result.compression_ratio,
            "metadata": {
                "word_count": len(text.split()),
                "summary_word_count": len(summary_result.summary.split()),
                "model_used": self.model_name
            }
        }
        
        if include_headline:
            result["headline"] = summary_result.headline
        
        return result
    
    def _result_to_dict(self, result: SummaryResult) -> Dict[str, Any]:
        """Convert SummaryResult to dictionary for JSON serialization."""
        return {
            "summary": result.summary,
            "headline": result.headline,
            "confidence": result.confidence,
            "compression_ratio": result.compression_ratio
        }
    
    async def health_check(self) -> bool:
        """
        Check if summarize service is healthy.
        
        Returns:
            True if service is available, False otherwise
        """
        try:
            await self._initialize_model()
            return self._initialized and self.model is not None
        except Exception as e:
            logger.error(f"Summarize service health check failed: {e}")
            return False 