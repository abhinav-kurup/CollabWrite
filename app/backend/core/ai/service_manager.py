"""
AI Service Manager

This module provides a unified interface for all AI writing assistance services,
managing their lifecycle and providing coordinated access to grammar checking,
paraphrasing, and summarization features.
"""

import asyncio
from typing import Dict, Any, Optional
from fastapi import HTTPException
import logging

from .grammar_service import GrammarService
from .paraphrase_service import ParaphraseService
from .summarize_service import SummarizeService

logger = logging.getLogger(__name__)


class AIServiceManager:
    """Manages all AI writing assistance services."""
    
    def __init__(self):
        """Initialize the AI service manager."""
        self.grammar_service: Optional[GrammarService] = None
        self.paraphrase_service: Optional[ParaphraseService] = None
        self.summarize_service: Optional[SummarizeService] = None
        self._initialized = False
    
    async def initialize(self):
        """Initialize all AI services."""
        if self._initialized:
            return
        
        try:
            logger.info("Initializing AI services...")
            
            # Initialize services
            self.grammar_service = GrammarService()
            self.paraphrase_service = ParaphraseService()
            self.summarize_service = SummarizeService()
            
            # Check service health
            health_checks = await asyncio.gather(
                self.grammar_service.health_check(),
                self.paraphrase_service.health_check(),
                self.summarize_service.health_check(),
                return_exceptions=True
            )
            
            # Log health status
            services = ["Grammar", "Paraphrase", "Summarize"]
            for service, health in zip(services, health_checks):
                if isinstance(health, Exception):
                    logger.warning(f"{service} service health check failed: {health}")
                else:
                    logger.info(f"{service} service: {'Healthy' if health else 'Unhealthy'}")
            
            self._initialized = True
            logger.info("AI services initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize AI services: {e}")
            raise HTTPException(
                status_code=500,
                detail="Failed to initialize AI services"
            )
    
    async def check_grammar(self, text: str, language: str = "en-US") -> Dict[str, Any]:
        """
        Check text for grammar and style issues.
        
        Args:
            text: Text to check
            language: Language code
            
        Returns:
            Grammar checking results
        """
        await self.initialize()
        if not self.grammar_service:
            raise HTTPException(
                status_code=503,
                detail="Grammar service not available"
            )
        
        return await self.grammar_service.get_suggestions(text, language)
    
    async def paraphrase_text(
        self, 
        text: str, 
        num_alternatives: int = 3,
        context: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate paraphrased alternatives for text.
        
        Args:
            text: Text to paraphrase
            num_alternatives: Number of alternatives to generate
            context: Optional context
            
        Returns:
            Paraphrasing results
        """
        await self.initialize()
        if not self.paraphrase_service:
            raise HTTPException(
                status_code=503,
                detail="Paraphrase service not available"
            )
        
        paraphrases = await self.paraphrase_service.paraphrase_text(text, num_alternatives)
        return await self.paraphrase_service.get_paraphrase_suggestions(text, context)
    
    async def summarize_text(
        self, 
        text: str, 
        include_headline: bool = True
    ) -> Dict[str, Any]:
        """
        Generate summary for text.
        
        Args:
            text: Text to summarize
            include_headline: Whether to include headline
            
        Returns:
            Summarization results
        """
        await self.initialize()
        if not self.summarize_service:
            raise HTTPException(
                status_code=503,
                detail="Summarize service not available"
            )
        
        return await self.summarize_service.get_summary_suggestions(text, include_headline)
    
    async def generate_headline(self, text: str) -> str:
        """
        Generate a headline for text.
        
        Args:
            text: Text to generate headline for
            
        Returns:
            Generated headline
        """
        await self.initialize()
        if not self.summarize_service:
            raise HTTPException(
                status_code=503,
                detail="Summarize service not available"
            )
        
        return await self.summarize_service.generate_headline(text)
    
    async def get_health_status(self) -> Dict[str, Any]:
        """
        Get health status of all AI services.
        
        Returns:
            Dictionary with health status of each service
        """
        if not self._initialized:
            return {
                "status": "not_initialized",
                "services": {}
            }
        
        try:
            health_checks = await asyncio.gather(
                self.grammar_service.health_check() if self.grammar_service else asyncio.sleep(0),
                self.paraphrase_service.health_check() if self.paraphrase_service else asyncio.sleep(0),
                self.summarize_service.health_check() if self.summarize_service else asyncio.sleep(0),
                return_exceptions=True
            )
            
            services = {
                "grammar": {
                    "status": "healthy" if health_checks[0] is True else "unhealthy",
                    "error": str(health_checks[0]) if isinstance(health_checks[0], Exception) else None
                },
                "paraphrase": {
                    "status": "healthy" if health_checks[1] is True else "unhealthy",
                    "error": str(health_checks[1]) if isinstance(health_checks[1], Exception) else None
                },
                "summarize": {
                    "status": "healthy" if health_checks[2] is True else "unhealthy",
                    "error": str(health_checks[2]) if isinstance(health_checks[2], Exception) else None
                }
            }
            
            overall_status = "healthy" if all(
                s["status"] == "healthy" for s in services.values()
            ) else "degraded"
            
            return {
                "status": overall_status,
                "services": services
            }
            
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return {
                "status": "error",
                "error": str(e),
                "services": {}
            }
    
    async def close(self):
        """Close all AI services."""
        try:
            if self.grammar_service:
                await self.grammar_service.close()
            # Note: Paraphrase and Summarize services don't have close methods
            # as they use transformers models that don't require explicit cleanup
            self._initialized = False
            logger.info("AI services closed")
        except Exception as e:
            logger.error(f"Error closing AI services: {e}")


# Global service manager instance
ai_service_manager = AIServiceManager() 