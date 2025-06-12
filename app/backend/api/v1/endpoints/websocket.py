from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from sqlalchemy.orm import Session
from app.backend.api.deps import get_db, get_current_user_ws
from app.backend.models.user import User
from app.backend.models.document import Document, DocumentCollaborator
from app.backend.core.crdt import CRDT, Character, Position
from app.backend.core.broadcast import manager
from datetime import datetime
import json

router = APIRouter()

# Store active connections and document sessions
class ConnectionManager:
    def __init__(self):
        # Store active connections: {document_id: {user_id: WebSocket}}
        self.active_connections: Dict[int, Dict[int, WebSocket]] = {}
        # Store user sessions: {user_id: Set[document_id]}
        self.user_sessions: Dict[int, Set[int]] = {}
        # Store CRDT instances: {document_id: CRDT}
        self.crdt_instances: Dict[int, CRDT] = {}

    async def connect(self, websocket: WebSocket, document_id: int, user_id: int, crdt: CRDT):
        await websocket.accept()
        if document_id not in self.active_connections:
            self.active_connections[document_id] = {}
        self.active_connections[document_id][user_id] = websocket
        
        if user_id not in self.user_sessions:
            self.user_sessions[user_id] = set()
        self.user_sessions[user_id].add(document_id)

        # Initialize or load CRDT instance
        if document_id not in self.crdt_instances:
            self.crdt_instances[document_id] = crdt

    def disconnect(self, document_id: int, user_id: int):
        if document_id in self.active_connections:
            self.active_connections[document_id].pop(user_id, None)
            if not self.active_connections[document_id]:
                del self.active_connections[document_id]
                # Clean up CRDT instance when no users are connected
                self.crdt_instances.pop(document_id, None)
        
        if user_id in self.user_sessions:
            self.user_sessions[user_id].discard(document_id)
            if not self.user_sessions[user_id]:
                del self.user_sessions[user_id]

    async def broadcast_to_document(self, document_id: int, message: dict, exclude_user: int = None):
        if document_id in self.active_connections:
            for user_id, connection in self.active_connections[document_id].items():
                if user_id != exclude_user:
                    try:
                        await connection.send_json(message)
                    except RuntimeError:
                        # If connection is closed, remove it
                        self.disconnect(document_id, user_id)

manager = ConnectionManager()

@router.websocket("/ws/documents/{document_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    document_id: int,
    db: Session = Depends(get_db)
):
    try:
        # Get current user from WebSocket connection
        current_user = await get_current_user_ws(websocket)
        
        # Verify document exists and user has access
        document = db.query(Document).filter(
            Document.id == document_id,
            Document.is_deleted == False
        ).first()
        
        if not document:
            await websocket.close(code=4004, reason="Document not found")
            return
            
        # Check if user has access to the document
        is_collaborator = db.query(DocumentCollaborator).filter(
            DocumentCollaborator.document_id == document_id,
            DocumentCollaborator.user_id == current_user.id
        ).first() is not None
            
        if (
            document.owner_id != current_user.id and
            not document.is_public and
            not is_collaborator
        ):
            await websocket.close(code=4003, reason="Not enough permissions")
            return

        # Initialize or load CRDT instance
        crdt = CRDT(str(current_user.id))
        if document.content:
            crdt = CRDT.from_dict(document.content, str(current_user.id))

        # Connect to WebSocket
        await manager.connect(websocket, document_id, current_user.id, crdt)
        
        # Send initial document state
        await websocket.send_json({
            "type": "init",
            "document_id": document_id,
            "content": crdt.get_text(),
            "crdt_state": crdt.to_dict(),
            "cursors": manager.user_cursors.get(document_id, {}),
            "timestamp": datetime.utcnow().isoformat()
        })

        try:
            while True:
                # Receive and process messages
                data = await websocket.receive_json()
                
                # Add user_id to message
                data["user_id"] = current_user.id
                
                # Queue message for processing
                await manager.queue_message(document_id, data)
                
        except WebSocketDisconnect:
            manager.disconnect(document_id, current_user.id)
            # Notify others that user left
            await manager.broadcast_to_document(
                document_id,
                {
                    "type": "user_left",
                    "user_id": current_user.id,
                    "timestamp": datetime.utcnow().isoformat()
                }
            )
            
    except Exception as e:
        print(f"WebSocket error: {str(e)}")
        await websocket.close(code=4000, reason=str(e)) 