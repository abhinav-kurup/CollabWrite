"""
Test script to verify that all backend modules can be imported correctly
with the updated import paths.
"""

import sys
import os

# Add the backend directory to the Python path
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_dir)

def test_imports():
    """Test that all modules can be imported without errors."""
    try:
        # Test core modules
        from core.config import settings
        print("✓ core.config imported successfully")
        
        from core.security import verify_password, get_password_hash, create_tokens
        print("✓ core.security imported successfully")
        
        from core.crdt import CRDT, Character, Position
        print("✓ core.crdt imported successfully")
        
        from core.broadcast import manager
        print("✓ core.broadcast imported successfully")
        
        # Test database modules
        from db.session import engine, SessionLocal, Base
        print("✓ db.session imported successfully")
        
        # Test models
        from models.user import User
        from models.document import Document, DocumentCollaborator
        print("✓ models imported successfully")
        
        # Test schemas
        from schemas.user import UserCreate, User, Token
        from schemas.document import DocumentCreate, Document
        print("✓ schemas imported successfully")
        
        # Test API dependencies
        from api.deps import get_db, get_current_user
        print("✓ api.deps imported successfully")
        
        # Test API endpoints
        from api.v1.endpoints import auth, documents, websocket, ai
        print("✓ api.v1.endpoints imported successfully")
        
        # Test API router
        from api.v1.api import api_router
        print("✓ api.v1.api imported successfully")
        
        # Test AI services
        from core.ai.service_manager import ai_service_manager
        print("✓ core.ai.service_manager imported successfully")
        
        print("\n✅ All imports successful! The backend should now run correctly.")
        return True
        
    except Exception as e:
        print(f"❌ Import failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    test_imports()