"""
AI Writing Assistant Services

This module provides AI-powered writing assistance features including:
- Grammar and style checking via LanguageTool
- Text paraphrasing via Hugging Face models
- Text summarization via BART/T5 models
- Context-aware AI prompts
"""

from .grammar_service import GrammarService
from .paraphrase_service import ParaphraseService
from .summarize_service import SummarizeService
from .service_manager import AIServiceManager, ai_service_manager
from .config import AIServiceConfig, ai_config, get_model_config, get_service_config

__all__ = [
    "GrammarService",
    "ParaphraseService", 
    "SummarizeService",
    "AIServiceManager",
    "ai_service_manager",
    "AIServiceConfig",
    "ai_config",
    "get_model_config",
    "get_service_config"
] 