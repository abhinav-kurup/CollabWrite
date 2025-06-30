"""
Test script for AI services

This script tests the AI writing assistance services to ensure they are
working correctly before integrating with the main application.
"""

import asyncio
import sys
import os

# Add the backend directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app', 'backend'))

from core.ai import ai_service_manager


async def test_grammar_service():
    """Test the grammar checking service."""
    print("Testing Grammar Service...")
    
    test_text = "This is a test sentence with some grammer errors. I am going to the store to buy some apple."
    
    try:
        result = await ai_service_manager.check_grammar(test_text)
        print(f"✅ Grammar check successful")
        print(f"Found {result['summary']['total_issues']} issues")
        for issue in result['issues'][:3]:  # Show first 3 issues
            print(f"  - {issue['message']} (at position {issue['offset']})")
    except Exception as e:
        print(f"❌ Grammar check failed: {e}")


async def test_paraphrase_service():
    """Test the paraphrasing service."""
    print("\nTesting Paraphrase Service...")
    
    test_text = "The quick brown fox jumps over the lazy dog."
    
    try:
        result = await ai_service_manager.paraphrase_text(test_text, num_alternatives=2)
        print(f"✅ Paraphrase successful")
        print(f"Generated {result['summary']['total_alternatives']} alternatives")
        for i, paraphrase in enumerate(result['paraphrases'], 1):
            print(f"  {i}. {paraphrase['text']}")
    except Exception as e:
        print(f"❌ Paraphrase failed: {e}")


async def test_summarize_service():
    """Test the summarization service."""
    print("\nTesting Summarize Service...")
    
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
        result = await ai_service_manager.summarize_text(test_text)
        print(f"✅ Summarization successful")
        print(f"Summary: {result['summary']}")
        if 'headline' in result:
            print(f"Headline: {result['headline']}")
    except Exception as e:
        print(f"❌ Summarization failed: {e}")


async def test_headline_generation():
    """Test headline generation."""
    print("\nTesting Headline Generation...")
    
    test_text = "Scientists discover new species of deep-sea creatures in the Pacific Ocean."
    
    try:
        headline = await ai_service_manager.generate_headline(test_text)
        print(f"✅ Headline generation successful")
        print(f"Generated headline: {headline}")
    except Exception as e:
        print(f"❌ Headline generation failed: {e}")


async def test_health_check():
    """Test the health check functionality."""
    print("\nTesting Health Check...")
    
    try:
        health = await ai_service_manager.get_health_status()
        print(f"✅ Health check successful")
        print(f"Overall status: {health['status']}")
        for service, status in health['services'].items():
            print(f"  {service}: {status['status']}")
            if status.get('error'):
                print(f"    Error: {status['error']}")
    except Exception as e:
        print(f"❌ Health check failed: {e}")


async def main():
    """Run all tests."""
    print("🚀 Starting AI Services Tests\n")
    
    # Test health check first
    await test_health_check()
    
    # Test individual services
    await test_grammar_service()
    await test_paraphrase_service()
    await test_summarize_service()
    await test_headline_generation()
    
    print("\n✨ AI Services Tests Complete!")


if __name__ == "__main__":
    asyncio.run(main()) 