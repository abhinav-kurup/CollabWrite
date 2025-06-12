from fastapi import APIRouter
from app.backend.api.v1.endpoints import auth, documents, websocket

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
# api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(websocket.router, tags=["websocket"]) 