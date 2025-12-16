"""
Text Paraphrasing Service

This service uses Hugging Face models to generate alternative versions of text
while maintaining the original meaning and context.
"""

import asyncio
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from fastapi import HTTPException
import logging
import torch
from transformers import (
    T5Tokenizer, 
    T5ForConditionalGeneration,
    pipeline,
    AutoTokenizer,
    AutoModelForSeq2SeqLM
)

logger = logging.getLogger(__name__)


@dataclass
class ParaphraseResult:
    """Represents a paraphrased version of text."""
    text: str
    confidence: float
    similarity_score: float


class ParaphraseService:
    """Service for text paraphrasing using Hugging Face models."""
    
    def __init__(self, model_name: str = "humarin/chatgpt_paraphraser_on_T5_base"):
        """
        Initialize the paraphrase service.
        
        Args:
            model_name: Hugging Face model name for paraphrasing
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
            logger.info(f"Loading paraphrase model: {self.model_name}")
            
            # Run model loading in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            
            def load_model():
                tokenizer = AutoTokenizer.from_pretrained(self.model_name)
                model = AutoModelForSeq2SeqLM.from_pretrained(self.model_name)
                model.to(self.device)
                return tokenizer, model
            
            self.tokenizer, self.model = await loop.run_in_executor(None, load_model)
            self._initialized = True
            
            logger.info("Paraphrase model loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load paraphrase model: {e}")
            raise HTTPException(
                status_code=500,
                detail="Failed to initialize paraphrase model"
            )
    
    async def paraphrase_text(
        self, 
        text: str, 
        num_alternatives: int = 3,
        max_length: int = 128
    ) -> List[ParaphraseResult]:
        """
        Generate paraphrased alternatives for the given text.
        
        Args:
            text: The text to paraphrase
            num_alternatives: Number of alternative versions to generate
            max_length: Maximum length of generated text
            
        Returns:
            List of paraphrased alternatives
            
        Raises:
            HTTPException: If paraphrasing fails
        """
        if not text.strip():
            return []
        
        await self._initialize_model()
        
        try:
            # Run inference in thread pool
            loop = asyncio.get_event_loop()
            
            def generate_paraphrases():
                # For T5, we usually need a prefix
                input_text = f"paraphrase: {text}"
                
                # Tokenize input
                inputs = self.tokenizer(
                    input_text,
                    return_tensors="pt",
                    max_length=max_length,
                    truncation=True,
                    padding=True
                ).to(self.device)
                
                # Generate paraphrases with optimized parameters for variety
                outputs = self.model.generate(
                    **inputs,
                    num_return_sequences=num_alternatives,
                    num_beams=5,
                    do_sample=True,
                    temperature=0.90,     # Higher temperature for more variety
                    top_k=50,
                    top_p=0.95,          # Nucleus sampling
                    repetition_penalty=1.2, # Penalize repetition
                    max_length=max_length,
                    early_stopping=True
                )
                
                # Decode outputs
                paraphrases = []
                for output in outputs:
                    paraphrase_text = self.tokenizer.decode(
                        output, 
                        skip_special_tokens=True
                    )
                    
                    # Calculate confidence (simplified)
                    confidence = 0.85  # Placeholder
                    
                    # Calculate similarity 
                    similarity = self._calculate_similarity(text, paraphrase_text)
                    
                    paraphrases.append(ParaphraseResult(
                        text=paraphrase_text,
                        confidence=confidence,
                        similarity_score=similarity
                    ))
                
                return paraphrases
            
            results = await loop.run_in_executor(None, generate_paraphrases)
            
            # Sort by confidence and similarity
            results.sort(key=lambda x: (x.confidence, x.similarity_score), reverse=True)
            
            return results
            
        except Exception as e:
            logger.error(f"Paraphrasing failed: {e}")
            raise HTTPException(
                status_code=500,
                detail="Failed to generate paraphrases"
            )
    
    def _calculate_similarity(self, original: str, paraphrase: str) -> float:
        """
        Calculate similarity between original and paraphrased text.
        
        Args:
            original: Original text
            paraphrase: Paraphrased text
            
        Returns:
            Similarity score between 0 and 1
        """
        # Simple word overlap similarity (could be improved with embeddings)
        original_words = set(original.lower().split())
        paraphrase_words = set(paraphrase.lower().split())
        
        if not original_words or not paraphrase_words:
            return 0.0
        
        intersection = original_words.intersection(paraphrase_words)
        union = original_words.union(paraphrase_words)
        
        return len(intersection) / len(union) if union else 0.0
    
    async def get_paraphrase_suggestions(
        self, 
        text: str, 
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get paraphrasing suggestions with additional context.
        
        Args:
            text: The text to paraphrase
            context: Optional context to consider
            
        Returns:
            Dictionary with paraphrases and metadata
        """
        paraphrases = await self.paraphrase_text(text)
        
        return {
            "original_text": text,
            "context": context,
            "paraphrases": [self._result_to_dict(p) for p in paraphrases],
            "summary": {
                "total_alternatives": len(paraphrases),
                "average_confidence": sum(p.confidence for p in paraphrases) / len(paraphrases) if paraphrases else 0,
                "average_similarity": sum(p.similarity_score for p in paraphrases) / len(paraphrases) if paraphrases else 0
            }
        }
    
    def _result_to_dict(self, result: ParaphraseResult) -> Dict[str, Any]:
        """Convert ParaphraseResult to dictionary for JSON serialization."""
        return {
            "text": result.text,
            "confidence": result.confidence,
            "similarity_score": result.similarity_score
        }
    
    async def health_check(self) -> bool:
        """
        Check if paraphrase service is healthy.
        
        Returns:
            True if service is available, False otherwise
        """
        try:
            await self._initialize_model()
            return self._initialized and self.model is not None
        except Exception as e:
            logger.error(f"Paraphrase service health check failed: {e}")
            return False 