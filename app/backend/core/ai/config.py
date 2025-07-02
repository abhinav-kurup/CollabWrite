"""
AI Services Configuration

Configuration settings for AI writing assistance services including
model names, endpoints, and service parameters.
"""

from typing import Dict, Any
from pydantic_settings import BaseSettings


class AIServiceConfig(BaseSettings):
    """Configuration for AI services."""
    
    # LanguageTool Configuration
    language_tool_url: str = "http://localhost:8081"
    language_tool_timeout: int = 10
    
    # Hugging Face Models Configuration
    paraphrase_model: str = "tuner007/pegasus_paraphrase"
    summarize_model: str = "facebook/bart-large-cnn"
    
    # Model Parameters
    paraphrase_max_length: int = 128
    paraphrase_num_alternatives: int = 3
    paraphrase_temperature: float = 0.7
    
    summarize_max_length: int = 130
    summarize_min_length: int = 30
    summarize_do_sample: bool = False
    
    # Service Settings
    enable_grammar_checking: bool = True
    enable_paraphrasing: bool = True
    enable_summarization: bool = True
    
    # Performance Settings
    model_cache_dir: str = "./model_cache"
    use_gpu: bool = True
    max_concurrent_requests: int = 5
    
    # Health Check Settings
    health_check_timeout: int = 5
    health_check_interval: int = 300  # 5 minutes
    
    class Config:
        env_prefix = "AI_"
        case_sensitive = False
        model_config = {'protected_namespaces': ('settings_',)}


# Global configuration instance
ai_config = AIServiceConfig()


def get_model_config() -> Dict[str, Any]:
    """Get model configuration dictionary."""
    return {
        "paraphrase": {
            "model_name": ai_config.paraphrase_model,
            "max_length": ai_config.paraphrase_max_length,
            "num_alternatives": ai_config.paraphrase_num_alternatives,
            "temperature": ai_config.paraphrase_temperature
        },
        "summarize": {
            "model_name": ai_config.summarize_model,
            "max_length": ai_config.summarize_max_length,
            "min_length": ai_config.summarize_min_length,
            "do_sample": ai_config.summarize_do_sample
        }
    }


def get_service_config() -> Dict[str, Any]:
    """Get service configuration dictionary."""
    return {
        "language_tool": {
            "url": ai_config.language_tool_url,
            "timeout": ai_config.language_tool_timeout
        },
        "enabled_services": {
            "grammar": ai_config.enable_grammar_checking,
            "paraphrase": ai_config.enable_paraphrasing,
            "summarize": ai_config.enable_summarization
        },
        "performance": {
            "cache_dir": ai_config.model_cache_dir,
            "use_gpu": ai_config.use_gpu,
            "max_concurrent": ai_config.max_concurrent_requests
        },
        "health_check": {
            "timeout": ai_config.health_check_timeout,
            "interval": ai_config.health_check_interval
        }
    } 