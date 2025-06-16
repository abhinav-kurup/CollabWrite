from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from sqlalchemy.orm import Session
from app.backend.api.deps import get_db, get_current_user_ws
from app.backend.models.user import User
from app.backend.models.document import Document, DocumentCollaborator
from app.backend.core.crdt import CRDT, Character, Position
from app.backend.core.broadcast import manager
from app.backend.core.exceptions import AuthenticationError
from datetime import datetime
import json
import asyncio
from jose import JWTError

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
        # Store user cursors: {document_id: {user_id: cursor_position}}
        self.user_cursors: Dict[int, Dict[int, int]] = {}
        # Store message queues: {document_id: asyncio.Queue}
        self.message_queues: Dict[int, asyncio.Queue] = {}

    async def connect(self, websocket: WebSocket, document_id: int, user_id: int, crdt: CRDT):
        await websocket.accept()
        if document_id not in self.active_connections:
            self.active_connections[document_id] = {}
            self.user_cursors[document_id] = {}  # Initialize user_cursors for this document
            self.message_queues[document_id] = asyncio.Queue()  # Initialize message queue
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
                self.user_cursors.pop(document_id, None)
                self.message_queues.pop(document_id, None)
        
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

    async def queue_message(self, document_id: int, message: dict):
        """Queue a message for processing"""
        if document_id in self.message_queues:
            await self.message_queues[document_id].put(message)

    async def _process_messages(self, document_id: int):
        """Process messages from the queue"""
        while True:
            try:
                message = await self.message_queues[document_id].get()
                message_type = message.get("type")
                
                if message_type == "edit":
                    await self._handle_edit(document_id, message)
                elif message_type == "delete":
                    await self._handle_delete(document_id, message)
                elif message_type == "paste":
                    await self._handle_paste(document_id, message)
                elif message_type == "cut":
                    await self._handle_cut(document_id, message)
                elif message_type == "cursor":
                    await self._handle_cursor(document_id, message)
                
                self.message_queues[document_id].task_done()
            except Exception as e:
                print(f"Error processing message: {str(e)}")
                continue

    async def _handle_edit(self, document_id: int, message: dict):
        """Handle edit operations"""
        user_id = message.get("user_id")
        value = message.get("value")
        index = message.get("index")
        
        if not all([user_id, value, index is not None]):
            return
        
        # Get the CRDT instance for this document
        if document_id not in self.crdt_instances:
            return
            
        crdt = self.crdt_instances[document_id]
        
        # Insert the character using CRDT
        char = crdt.insert(index, value)
        
        # Broadcast the updated state to all users
        await self.broadcast_to_document(
            document_id,
            {
                "type": "edit",
                "state": crdt.to_dict(),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    async def _handle_delete(self, document_id: int, message: dict):
        """Handle delete operations"""
        user_id = message.get("user_id")
        index = message.get("index")
        
        if not all([user_id, index is not None]):
            return
            
        if document_id not in self.crdt_instances:
            return
            
        crdt = self.crdt_instances[document_id]
        
        # Delete the character using CRDT
        crdt.delete(index)
        
        # Broadcast the updated state
        await self.broadcast_to_document(
            document_id,
            {
                "type": "edit",
                "state": crdt.to_dict(),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    async def _handle_paste(self, document_id: int, message: dict):
        """Handle paste operations"""
        user_id = message.get("user_id")
        text = message.get("text")
        index = message.get("index")
        
        if not all([user_id, text, index is not None]):
            return
            
        if document_id not in self.crdt_instances:
            return
            
        crdt = self.crdt_instances[document_id]
        
        # Insert each character using CRDT
        for char in text:
            crdt.insert(index, char)
            index += 1
        
        # Broadcast the updated state
        await self.broadcast_to_document(
            document_id,
            {
                "type": "edit",
                "state": crdt.to_dict(),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    async def _handle_cut(self, document_id: int, message: dict):
        """Handle cut operations"""
        user_id = message.get("user_id")
        start_index = message.get("startIndex")
        end_index = message.get("endIndex")
        
        if not all([user_id, start_index is not None, end_index is not None]):
            return
            
        if document_id not in self.crdt_instances:
            return
            
        crdt = self.crdt_instances[document_id]
        
        # Delete characters in range using CRDT
        for i in range(start_index, end_index):
            crdt.delete(start_index)  # Always delete at start_index as it shifts
        
        # Broadcast the updated state
        await self.broadcast_to_document(
            document_id,
            {
                "type": "edit",
                "state": crdt.to_dict(),
                "timestamp": datetime.utcnow().isoformat()
            }
        )

    async def _handle_cursor(self, document_id: int, message: dict):
        """Handle cursor position updates"""
        user_id = message.get("user_id")
        position = message.get("position")
        
        if not all([user_id, position]):
            return
        
        # Update cursor position
        if document_id in self.user_cursors:
            self.user_cursors[document_id][user_id] = position
        
        # Broadcast to other users
        await self.broadcast_to_document(
            document_id,
            {
                "type": "cursor",
                "user_id": user_id,
                "position": position,
                "timestamp": datetime.utcnow().isoformat()
            },
            exclude_user=user_id
        )

    async def _handle_sync_request(self, document_id: int, message: dict):
        """Handle sync requests"""
        user_id = message.get("user_id")
        
        if not user_id or document_id not in self.crdt_instances:
            return
        
        # Send current document state
        if document_id in self.active_connections and user_id in self.active_connections[document_id]:
            connection = self.active_connections[document_id][user_id]
            await connection.send_json({
                "type": "sync_response",
                "document_id": document_id,
                "state": self.crdt_instances[document_id].to_dict(),
                "cursors": self.user_cursors.get(document_id, {}),
                "timestamp": datetime.utcnow().isoformat()
            })

manager = ConnectionManager()

@router.websocket("/ws/{document_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    document_id: int,
    current_user: User = Depends(get_current_user_ws),
    db: Session = Depends(get_db)
):
    try:
        # Verify document access
        if current_user is None:
            await websocket.close(code=4001, reason="No user found")
            return

        document = db.query(Document).filter(Document.id == document_id).first()
        if not document:
            await websocket.close(code=4004, reason="Document not found")
            return
        
        # Check if user has access to the document
        if not document.is_public and current_user.id != document.owner_id:
            collaborator = db.query(DocumentCollaborator).filter(
                DocumentCollaborator.document_id == document_id,
                DocumentCollaborator.user_id == current_user.id
            ).first()
            if not collaborator:
                await websocket.close(code=4003, reason="Access denied: You don't have permission to access this document")
                return
    except JWTError:
        await websocket.close(code=4002, reason="Invalid token: Authentication failed")
        return
    except AuthenticationError:
        await websocket.close(code=4002, reason="token not found")
        return
    except Exception as e:
        await websocket.close(code=4000, reason=f"Server error: {str(e)}")
        return
    
    # Initialize CRDT instance with user's site_id
    crdt = CRDT(site_id=str(current_user.id))
    if document.content and isinstance(document.content, dict):
        if 'characters' in document.content:
            crdt.from_dict(document.content, site_id=str(current_user.id))
        else:
            # If content is just text, initialize CRDT with the text
            text = document.content.get('text', '')
            for i, char in enumerate(text):
                crdt.insert(i, char)
    else:
        # If no content or invalid format, start with empty document
        crdt = CRDT(site_id=str(current_user.id))
    
    # Connect to WebSocket
    await manager.connect(websocket, document_id, current_user.id, crdt)
    
    try:
        # Start message processing task
        message_processor = asyncio.create_task(
            manager._process_messages(document_id)
        )
        
        # Send initial state
        await websocket.send_json({
            "type": "init",
            "document_id": document_id,
            "state": crdt.to_dict(),
            "cursors": manager.user_cursors.get(document_id, {}),
            "timestamp": datetime.utcnow().isoformat()
        })
        
        # Handle incoming messages
        while True:
            try:
                data = await websocket.receive_json()
                data["user_id"] = current_user.id
                await manager.queue_message(document_id, data)
            except WebSocketDisconnect:
                break
            except Exception as e:
                continue
    finally:
        # Clean up
        message_processor.cancel()
        manager.disconnect(document_id, current_user.id)
        await websocket.close() 