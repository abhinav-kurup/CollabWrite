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
from ...deps import get_current_user_ws
from ....models.document import Document
from sqlalchemy.orm import Session
from ....db.session import SessionLocal

router = APIRouter()

# Store active connections and document sessions
class ConnectionManager:
    def __init__(self):
        # document_id -> {user_id -> WebSocket}
        self.active_connections: Dict[int, Dict[int, WebSocket]] = {}
        # document_id -> {user_id -> cursor_position}
        self.user_cursors: Dict[int, Dict[int, dict]] = {}
        # document_id -> document_state
        self.document_states: Dict[int, dict] = {}
        
        self.users : Dict[int,str] = {}

    async def connect(self, websocket: WebSocket, document_id: int, user_id: int):
        await websocket.accept()
        
        if document_id not in self.active_connections:
            self.active_connections[document_id] = {}
            self.user_cursors[document_id] = {}
            
            # Initialize document state from database
            db = SessionLocal()
            # user = db.query(User).filter(User.id == user_id).first()
            # if 
            try:
                document = db.query(Document).filter(Document.id == document_id).first()
                if document and document.content:
                    self.document_states[document_id] = document.content
                else:
                    self.document_states[document_id] = {"text": "", "characters": [], "version": 0}
            finally:
                db.close()
        
        self.active_connections[document_id][user_id] = websocket
        # Send initial state to the new connection
        await websocket.send_json({
            "type": "init",
            "state": self.document_states[document_id],
            "cursors": self.user_cursors[document_id]
        })

    def disconnect(self, document_id: int, user_id: int):
        if document_id in self.active_connections:
            self.active_connections[document_id].pop(user_id, None)
            self.user_cursors[document_id].pop(user_id, None)
            
            # Clean up empty document entries
            if not self.active_connections[document_id]:
                self.active_connections.pop(document_id, None)
                self.user_cursors.pop(document_id, None)
                self.document_states.pop(document_id, None)

    async def broadcast_message(self, document_id: int, message: dict, exclude_user: int = None):
        if document_id in self.active_connections:
            for user_id, connection in self.active_connections[document_id].items():
                if user_id != exclude_user:  # Don't send back to the sender
                    try:
                        await connection.send_json(message)
                    except Exception as e:
                        # Handle disconnection
                        self.disconnect(document_id, user_id)

    def update_cursor(self, document_id: int, user_id: int, cursor_data: dict):
        if document_id not in self.user_cursors:
            self.user_cursors[document_id] = {}
        self.user_cursors[document_id][user_id] = cursor_data

    def get_cursors(self, document_id: int) -> dict:
        return self.user_cursors.get(document_id, {})

    def update_document_state(self, document_id: int, state: dict):
        self.document_states[document_id] = state

    def get_document_state(self, document_id: int) -> dict:
        return self.document_states.get(document_id, {})

manager = ConnectionManager()

async def save_document_state(document_id: int, state: dict):
    try:
        db = SessionLocal()
        document = db.query(Document).filter(Document.id == document_id).first()
        if document:
            # Ensure we have all required fields
            if not isinstance(state, dict):
                return
            if 'text' not in state:
                return
            # Update the document content
            document.content = state
            document.version += 1
            db.commit()
            db.refresh(document)
    except Exception as e:
        # Rollback on error
        try:
            db.rollback()
        except:
            pass
    finally:
        db.close()

async def periodic_save(document_id: int, save_interval: int = 10):
    while True:
        try:
            await asyncio.sleep(save_interval)
            state = manager.get_document_state(document_id)
            if state:
                await save_document_state(document_id, state)
        except asyncio.CancelledError:
            try:
                state = manager.get_document_state(document_id)
                if state:
                    await save_document_state(document_id, state)
            except Exception as e:
                pass
            break
        except Exception as e:
            pass

async def process_messages(websocket: WebSocket, document_id: int, user_id: int):
    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            if message_type == "cursor":
                manager.update_cursor(document_id, user_id, message.get("data", {}))
                username = manager.users.get(user_id,None)
                cursor_data = message.get("data", {})
                cursor_data["username"] = username
                await manager.broadcast_message(
                    document_id,
                    {
                        "type": "cursor",
                        "user_id": user_id,
                        "username":username,
                        "data": cursor_data
                    },
                    exclude_user=user_id
                )
            elif message_type == "update":
                content = message.get("content")
                if content and isinstance(content, dict) and 'text' in content:
                    # Update in-memory state
                    manager.update_document_state(document_id, content)
                    # Immediately save to database
                    try:
                        await save_document_state(document_id, content)
                    except Exception as e:
                        pass
                    # Broadcast to other users
                    await manager.broadcast_message(
                        document_id,
                        {
                            "type": "update",
                            "user_id": user_id,
                            "content": content
                        },
                        exclude_user=user_id
                    )
            elif message_type == "sync_request":
                state = manager.get_document_state(document_id)
                if state:
                    await websocket.send_json({
                        "type": "sync_response",
                        "content": state
                    })
    except WebSocketDisconnect:
        manager.disconnect(document_id, user_id)
        await manager.broadcast_message(
            document_id,
            {
                "type": "user_disconnected",
                "user_id": user_id
            }
        )
    except Exception as e:
        manager.disconnect(document_id, user_id)

@router.websocket("/ws/{document_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    document_id: int,
    current_user: User = Depends(get_current_user_ws),
    db: Session = Depends(get_db)
):
    try:
        if current_user is None:
            await websocket.close(code=4001, reason="No user found")
            return
        document = db.query(Document).filter(Document.id == document_id).first()
        if not document:
            await websocket.close(code=4004, reason="Document not found")
            return
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
    crdt = CRDT(site_id=str(current_user.id))
    if document.content and isinstance(document.content, dict):
        if 'characters' in document.content:
            crdt.from_dict(document.content, site_id=str(current_user.id))
        else:
            text = document.content.get('text', '')
            for i, char in enumerate(text):
                crdt.insert(i, char)
    else:
        crdt = CRDT(site_id=str(current_user.id))
    await manager.connect(websocket, document_id, current_user.id)
    manager.users[current_user.id] = current_user.username
    try:
        save_task = asyncio.create_task(periodic_save(document_id))
        message_processor = asyncio.create_task(
            process_messages(websocket, document_id, current_user.id)
        )
        await websocket.send_json({
            "type": "init",
            "document_id": document_id,
            "state": crdt.to_dict(),
            "cursors": manager.get_cursors(document_id),
            "timestamp": datetime.utcnow().isoformat()
        })
        await message_processor
    except WebSocketDisconnect:
        pass
    except Exception as e:
        pass
    finally:
        if message_processor:
            message_processor.cancel()
            try:
                await message_processor
            except asyncio.CancelledError:
                pass
        if save_task:
            save_task.cancel()
            try:
                await save_task
            except asyncio.CancelledError:
                pass
        manager.disconnect(document_id, current_user.id)
        try:
            await websocket.close()
        except RuntimeError:
            pass  # Already closed 