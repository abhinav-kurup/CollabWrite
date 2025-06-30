"""
Local AI Services Test (No Docker Required)

This script tests the AI services locally without requiring Docker.
It uses mock services and simplified tests to verify the code structure.
"""

import asyncio
import sys
import os
from unittest.mock import AsyncMock, MagicMock

# Add the backend directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app', 'backend'))

from core.ai.grammar_service import GrammarService, GrammarIssue
from core.ai.paraphrase_service import ParaphraseService, ParaphraseResult
from core.ai.summarize_service import SummarizeService, SummaryResult


class MockGrammarService(GrammarService):
    """Mock grammar service for local testing."""
    
    async def check_text(self, text: str, language: str = "en-US"):
        """Mock grammar checking that returns sample issues."""
        if not text.strip():
            return []
        
        # Simulate grammar issues
        issues = []
        if "grammer" in text.lower():
            issues.append(GrammarIssue(
                message="Possible spelling mistake found",
                short_message="Spelling",
                offset=text.lower().find("grammer"),
                length=7,
                replacements=["grammar"],
                rule_id="MORFOLOGIK_RULE_EN_US",
                rule_category="Spelling",
                confidence=0.9
            ))
        
        if text.count(".") > 0 and not text.endswith("."):
            issues.append(GrammarIssue(
                message="This sentence does not start with a capital letter",
                short_message="Capitalization",
                offset=0,
                length=1,
                replacements=[text[0].upper()],
                rule_id="UPPERCASE_SENTENCE_START",
                rule_category="Capitalization",
                confidence=0.8
            ))
        
        return issues
    
    async def health_check(self) -> bool:
        """Mock health check."""
        return True


class MockParaphraseService(ParaphraseService):
    """Mock paraphrase service for local testing."""
    
    async def paraphrase_text(self, text: str, num_alternatives: int = 3, max_length: int = 128):
        """Mock paraphrasing that returns sample alternatives."""
        if not text.strip():
            return []
        
        # Simple paraphrasing simulation
        paraphrases = []
        alternatives = [
            f"Alternative version 1: {text}",
            f"Here's another way to say it: {text}",
            f"Rephrased as: {text}"
        ]
        
        for i, alt in enumerate(alternatives[:num_alternatives]):
            paraphrases.append(ParaphraseResult(
                text=alt,
                confidence=0.8 - (i * 0.1),
                similarity_score=0.9 - (i * 0.05)
            ))
        
        return paraphrases
    
    async def health_check(self) -> bool:
        """Mock health check."""
        return True


class MockSummarizeService(SummarizeService):
    """Mock summarize service for local testing."""
    
    async def summarize_text(self, text: str, max_length: int = 130, min_length: int = 30, do_sample: bool = False):
        """Mock summarization that returns sample summary."""
        if not text.strip():
            raise ValueError("Text cannot be empty")
        
        # Simple summarization simulation
        words = text.split()
        if len(words) <= 10:
            summary_text = text
        else:
            summary_text = " ".join(words[:10]) + "..."
        
        headline = f"Summary: {words[0].title()} {words[1] if len(words) > 1 else ''}"
        
        return SummaryResult(
            summary=summary_text,
            headline=headline,
            confidence=0.85,
            compression_ratio=len(summary_text) / len(text) if text else 0
        )
    
    async def health_check(self) -> bool:
        """Mock health check."""
        return True


async def test_grammar_service():
    """Test the mock grammar checking service."""
    print("Testing Grammar Service (Mock)...")
    
    service = MockGrammarService()
    test_text = "This is a test sentence with some grammer errors. i am going to the store."
    
    try:
        issues = await service.check_text(test_text)
        print(f"✅ Grammar check successful")
        print(f"Found {len(issues)} issues")
        for issue in issues:
            print(f"  - {issue.message} (at position {issue.offset})")
            print(f"    Suggestion: {issue.replacements[0] if issue.replacements else 'None'}")
        
        # Test suggestions method
        suggestions = await service.get_suggestions(test_text)
        print(f"Summary: {suggestions['summary']['total_issues']} total issues")
        
    except Exception as e:
        print(f"❌ Grammar check failed: {e}")


async def test_paraphrase_service():
    """Test the mock paraphrasing service."""
    print("\nTesting Paraphrase Service (Mock)...")
    
    service = MockParaphraseService()
    test_text = "The quick brown fox jumps over the lazy dog."
    
    try:
        paraphrases = await service.paraphrase_text(test_text, num_alternatives=2)
        print(f"✅ Paraphrase successful")
        print(f"Generated {len(paraphrases)} alternatives")
        for i, paraphrase in enumerate(paraphrases, 1):
            print(f"  {i}. {paraphrase.text}")
            print(f"     Confidence: {paraphrase.confidence:.2f}")
            print(f"     Similarity: {paraphrase.similarity_score:.2f}")
        
        # Test suggestions method
        suggestions = await service.get_paraphrase_suggestions(test_text)
        print(f"Summary: {suggestions['summary']['total_alternatives']} alternatives generated")
        
    except Exception as e:
        print(f"❌ Paraphrase failed: {e}")


async def test_summarize_service():
    """Test the mock summarization service."""
    print("\nTesting Summarize Service (Mock)...")
    
    service = MockSummarizeService()
    test_text = """
    Artificial intelligence has become an integral part of modern technology. 
    From virtual assistants to autonomous vehicles, AI is transforming how we 
    live and work. Machine learning algorithms can now process vast amounts of 
    data to identify patterns and make predictions. Natural language processing 
    enables computers to understand and generate human language. Computer vision 
    allows machines to interpret visual information. These advances are creating 
    new opportunities and challenges across various industries.
    """
    
    try:
        result = await service.summarize_text(test_text)
        print(f"✅ Summarization successful")
        print(f"Summary: {result.summary}")
        print(f"Headline: {result.headline}")
        print(f"Confidence: {result.confidence:.2f}")
        print(f"Compression ratio: {result.compression_ratio:.2f}")
        
        # Test suggestions method
        suggestions = await service.get_summary_suggestions(test_text)
        print(f"Word count: {suggestions['metadata']['word_count']} → {suggestions['metadata']['summary_word_count']}")
        
    except Exception as e:
        print(f"❌ Summarization failed: {e}")


async def test_headline_generation():
    """Test headline generation."""
    print("\nTesting Headline Generation (Mock)...")
    
    service = MockSummarizeService()
    test_text = "Scientists discover new species of deep-sea creatures in the Pacific Ocean."
    
    try:
        headline = await service.generate_headline(test_text)
        print(f"✅ Headline generation successful")
        print(f"Generated headline: {headline}")
    except Exception as e:
        print(f"❌ Headline generation failed: {e}")


async def test_service_integration():
    """Test how services work together."""
    print("\nTesting Service Integration...")
    
    grammar_service = MockGrammarService()
    paraphrase_service = MockParaphraseService()
    summarize_service = MockSummarizeService()
    
    test_text = "This is a sample text for testing multiple AI services. It contains some grammer issues and is long enough for summarization."
    
    try:
        # Test all services on the same text
        print("Processing text with all services...")
        
        grammar_result = await grammar_service.get_suggestions(test_text)
        paraphrase_result = await paraphrase_service.get_paraphrase_suggestions(test_text)
        summarize_result = await summarize_service.get_summary_suggestions(test_text)
        
        print(f"✅ Integration test successful")
        print(f"  Grammar issues: {grammar_result['summary']['total_issues']}")
        print(f"  Paraphrase alternatives: {paraphrase_result['summary']['total_alternatives']}")
        print(f"  Summary length: {len(summarize_result['summary'])} words")
        
    except Exception as e:
        print(f"❌ Integration test failed: {e}")


async def main():
    """Run all tests."""
    print("🚀 Starting Local AI Services Tests (No Docker Required)\n")
    
    # Test individual services
    await test_grammar_service()
    await test_paraphrase_service()
    await test_summarize_service()
    await test_headline_generation()
    await test_service_integration()
    
    print("\n✨ Local AI Services Tests Complete!")
    print("\n📝 Next Steps:")
    print("1. Install Python dependencies: pip install -r app/backend/requirements.txt")
    print("2. Start Docker services: docker-compose up -d")
    print("3. Run full tests: python app/backend/test_ai_services.py")


if __name__ == "__main__":
    asyncio.run(main()) 