"""
Grammar and Style Checking Service

This service interfaces with LanguageTool to provide grammar, spelling, and style checking
for text content in the collaborative editor.
"""

import aiohttp
import asyncio
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from fastapi import HTTPException
import logging
from .config import ai_config

logger = logging.getLogger(__name__)


@dataclass
class GrammarIssue:
    """Represents a grammar, spelling, or style issue found by LanguageTool."""
    message: str
    short_message: str
    offset: int
    length: int
    replacements: List[str]
    rule_id: str
    rule_category: str
    confidence: float


class GrammarService:
    """Service for grammar and style checking using LanguageTool."""
    
    def __init__(self, language_tool_url: str = None):
        """
        Initialize the grammar service.
        
        Args:
            language_tool_url: URL of the LanguageTool service
        """
        if language_tool_url is None:
            language_tool_url = ai_config.language_tool_url
        self.language_tool_url = language_tool_url.rstrip('/')
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create an aiohttp session."""
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession()
        return self.session
    
    async def check_text(self, text: str, language: str = "en-US") -> List[GrammarIssue]:
        """
        Check text for grammar, spelling, and style issues.
        
        Args:
            text: The text to check
            language: Language code (default: en-US)
            
        Returns:
            List of grammar issues found
            
        Raises:
            HTTPException: If LanguageTool service is unavailable
        """
        if not text.strip():
            return []
        
        try:
            session = await self._get_session()
            
            # Prepare request payload
            payload = {
                "text": text,
                "language": language,
                "enabledOnly": False
            }
            
            # Make request to LanguageTool
            async with session.post(
                f"{self.language_tool_url}/v2/check",
                data=payload,
                timeout=aiohttp.ClientTimeout(total=20)
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    print("LanguageTool error response:", error_text)
                    logger.error(f"LanguageTool API error: {response.status} - {error_text}")
                    raise HTTPException(
                        status_code=503,
                        detail="Grammar checking service is temporarily unavailable"
                    )
                
                data = await response.json()
                
                # Parse LanguageTool response
                issues = []
                for match in data.get("matches", []):
                    issue = GrammarIssue(
                        message=match.get("message", ""),
                        short_message=match.get("shortMessage", ""),
                        offset=match.get("offset", 0),
                        length=match.get("length", 0),
                        replacements=[r.get("value", "") for r in match.get("replacements", [])],
                        rule_id=match.get("rule", {}).get("id", ""),
                        rule_category=match.get("rule", {}).get("category", {}).get("name", ""),
                        confidence=match.get("confidence", {}).get("value", 0.0)
                    )
                    issues.append(issue)
                
                return issues
                
        except asyncio.TimeoutError:
            logger.error("LanguageTool request timed out")
            raise HTTPException(
                status_code=503,
                detail="Grammar checking service request timed out"
            )
        except aiohttp.ClientError as e:
            logger.error(f"LanguageTool connection error: {e}")
            raise HTTPException(
                status_code=503,
                detail="Grammar checking service is unavailable"
            )
        except Exception as e:
            logger.error(f"Unexpected error in grammar checking: {e}")
            raise HTTPException(
                status_code=500,
                detail="Internal error during grammar checking"
            )
    
    async def get_suggestions(self, text: str, language: str = "en-US") -> Dict[str, Any]:
        """
        Get grammar suggestions with additional context.
        
        Args:
            text: The text to check
            language: Language code
            
        Returns:
            Dictionary with issues and summary statistics
        """
        issues = await self.check_text(text, language)
        
        # Calculate statistics
        total_issues = len(issues)
        categories = {}
        for issue in issues:
            category = issue.rule_category
            categories[category] = categories.get(category, 0) + 1
        
        return {
            "issues": [self._issue_to_dict(issue) for issue in issues],
            "summary": {
                "total_issues": total_issues,
                "categories": categories,
                "text_length": len(text)
            }
        }
    
    def _issue_to_dict(self, issue: GrammarIssue) -> Dict[str, Any]:
        """Convert GrammarIssue to dictionary for JSON serialization."""
        return {
            "message": issue.message,
            "short_message": issue.short_message,
            "offset": issue.offset,
            "length": issue.length,
            "replacements": issue.replacements,
            "rule_id": issue.rule_id,
            "rule_category": issue.rule_category,
            "confidence": issue.confidence
        }
    
    async def close(self):
        """Close the aiohttp session."""
        if self.session and not self.session.closed:
            await self.session.close()
    
    async def health_check(self) -> bool:
        """
        Check if LanguageTool service is healthy.
        
        Returns:
            True if service is available, False otherwise
        """
        try:
            session = await self._get_session()
            async with session.get(
                f"{self.language_tool_url}/v2/languages",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                return response.status == 200
        except Exception as e:
            logger.error(f"LanguageTool health check failed: {e}")
            return False 