from typing import Dict, Set, Optional, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from sqlalchemy.orm import Session
from api.deps import get_db, get_current_user_ws
from models.user import User
from models.document import Document, DocumentCollaborator
from core.crdt import CRDT
from core.exceptions import AuthenticationError
from datetime import datetime, timedelta
import asyncio
from jose import JWTError
from db.session import SessionLocal

router = APIRouter()

# Enhanced connection manager with presence tracking
class ConnectionManager:
    def __init__(self):
        # document_id -> {user_id -> WebSocket}
        self.active_connections: Dict[int, Dict[int, WebSocket]] = {}
        # document_id -> {user_id -> cursor_position}
        self.user_cursors: Dict[int, Dict[int, dict]] = {}
        # document_id -> document_state
        self.document_states: Dict[int, dict] = {}
        # Enhanced presence tracking
        self.user_sessions: Dict[int, Dict[str, Any]] = {}
        self.heartbeat_timestamps: Dict[int, Dict[int, float]] = {}
        self.user_colors: Dict[int, str] = {}
        
        # Colors for user cursors
        self.colors = [
            '#e57373', '#64b5f6', '#81c784', '#ffd54f', '#ba68c8', 
            '#4dd0e1', '#ff8a65', '#a1887f', '#90a4ae', '#f06292'
        ]

    def get_user_color(self, user_id: int) -> str:
        """Get a consistent color for a user"""
        if user_id not in self.user_colors:
            self.user_colors[user_id] = self.colors[user_id % len(self.colors)]
        return self.user_colors[user_id]

    async def connect(self, websocket: WebSocket, document_id: int, user_id: int, username: str):
        await websocket.accept()
        
        if document_id not in self.active_connections:
            self.active_connections[document_id] = {}
            self.user_cursors[document_id] = {}
            self.heartbeat_timestamps[document_id] = {}
            
            # Initialize document state from database
            db = SessionLocal()
            try:
                document = db.query(Document).filter(Document.id == document_id).first()
                if document and document.content:
                    self.document_states[document_id] = document.content
                else:
                    self.document_states[document_id] = {"text": "", "characters": [], "version": 0}
            finally:
                db.close()
        
        # Store connection and user session
        self.active_connections[document_id][user_id] = websocket
        self.user_sessions[user_id] = {
            'document_id': document_id,
            'username': username,
            'connection_id': f"{user_id}-{datetime.utcnow().timestamp()}",
            'joined_at': datetime.utcnow(),
            'last_activity': datetime.utcnow(),
            'color': self.get_user_color(user_id)
        }
        self.heartbeat_timestamps[document_id][user_id] = datetime.utcnow().timestamp()
        
        # Send initial state to the new connection
        await websocket.send_json({
            "type": "init",
            "state": self.document_states[document_id],
            "cursors": self.user_cursors[document_id],
            "session_id": self.user_sessions[user_id]['connection_id']
        })
        
        # Notify other users about the new connection
        await self.broadcast_message(
            document_id,
            {
                "type": "presence_join",
                "user_id": user_id,
                "data": {
                    "username": username,
                    "connectionId": self.user_sessions[user_id]['connection_id'],
                    "timestamp": datetime.utcnow().timestamp(),
                    "color": self.get_user_color(user_id)
                }
            },
            exclude_user=user_id
        )

    def disconnect(self, document_id: int, user_id: int):
        if document_id in self.active_connections:
            self.active_connections[document_id].pop(user_id, None)
            self.user_cursors[document_id].pop(user_id, None)
            self.heartbeat_timestamps[document_id].pop(user_id, None)
            
            # Clean up user session
            if user_id in self.user_sessions:
                del self.user_sessions[user_id]
            
            # Clean up empty document entries
            if not self.active_connections[document_id]:
                self.active_connections.pop(document_id, None)
                self.user_cursors.pop(document_id, None)
                self.document_states.pop(document_id, None)
                self.heartbeat_timestamps.pop(document_id, None)

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
        
        # Enhanced cursor data with presence information
        enhanced_cursor = {
            **cursor_data,
            'username': self.user_sessions.get(user_id, {}).get('username', f'User {user_id}'),
            'color': self.get_user_color(user_id),
            'lastUpdated': datetime.utcnow().timestamp()
        }
        
        self.user_cursors[document_id][user_id] = enhanced_cursor
        
        # Update last activity
        if user_id in self.user_sessions:
            self.user_sessions[user_id]['last_activity'] = datetime.utcnow()

    def get_cursors(self, document_id: int) -> dict:
        return self.user_cursors.get(document_id, {})

    def update_document_state(self, document_id: int, state: dict):
        self.document_states[document_id] = state

    def get_document_state(self, document_id: int) -> dict:
        return self.document_states.get(document_id, {})

    def update_heartbeat(self, document_id: int, user_id: int):
        """Update heartbeat timestamp for a user"""
        if document_id in self.heartbeat_timestamps:
            self.heartbeat_timestamps[document_id][user_id] = datetime.utcnow().timestamp()
            if user_id in self.user_sessions:
                self.user_sessions[user_id]['last_activity'] = datetime.utcnow()

    def get_user_status(self, user_id: int) -> str:
        """Get user status based on last activity"""
        if user_id not in self.user_sessions:
            return 'offline'
        
        last_activity = self.user_sessions[user_id]['last_activity']
        if datetime.utcnow() - last_activity < timedelta(minutes=1):
            return 'online'
        elif datetime.utcnow() - last_activity < timedelta(minutes=5):
            return 'away'
        else:
            return 'offline'

    def cleanup_inactive_users(self):
        """Clean up users who haven't sent heartbeat in a while"""
        current_time = datetime.utcnow()
        inactive_users = []
        
        for user_id, session in self.user_sessions.items():
            if current_time - session['last_activity'] > timedelta(minutes=5):
                inactive_users.append((session['document_id'], user_id))
        
        for document_id, user_id in inactive_users:
            self.disconnect(document_id, user_id)

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

async def cleanup_task():
    """Periodic cleanup of inactive users"""
    while True:
        try:
            await asyncio.sleep(60)  # Check every minute
            manager.cleanup_inactive_users()
        except asyncio.CancelledError:
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
                await manager.broadcast_message(
                    document_id,
                    {
                        "type": "cursor",
                        "user_id": user_id,
                        "data": message.get("data", {})
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
                    
            elif message_type == "heartbeat":
                # Update heartbeat timestamp
                manager.update_heartbeat(document_id, user_id)
                # Send heartbeat response
                await websocket.send_json({
                    "type": "heartbeat_response",
                    "timestamp": datetime.utcnow().timestamp()
                })
                
            elif message_type == "presence_join":
                # Handle explicit presence join (already handled in connect)
                pass
                
            elif message_type == "presence_leave":
                # Handle explicit presence leave
                await manager.broadcast_message(
                    document_id,
                    {
                        "type": "presence_leave",
                        "user_id": user_id,
                        "data": {
                            "username": manager.user_sessions.get(user_id, {}).get('username', f'User {user_id}'),
                            "timestamp": datetime.utcnow().timestamp()
                        }
                    },
                    exclude_user=user_id
                )
                
    except WebSocketDisconnect:
        manager.disconnect(document_id, user_id)
        await manager.broadcast_message(
            document_id,
            {
                "type": "presence_leave",
                "user_id": user_id,
                "data": {
                    "username": manager.user_sessions.get(user_id, {}).get('username', f'User {user_id}'),
                    "timestamp": datetime.utcnow().timestamp()
                }
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
    
    # Initialize CRDT
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
    
    # Connect with enhanced presence tracking
    await manager.connect(websocket, document_id, current_user.id, current_user.username)
    
    try:
        save_task = asyncio.create_task(periodic_save(document_id))
        cleanup_task_instance = asyncio.create_task(cleanup_task())
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
        if cleanup_task_instance:
            cleanup_task_instance.cancel()
            try:
                await cleanup_task_instance
            except asyncio.CancelledError:
                pass
        manager.disconnect(document_id, current_user.id)
        try:
            await websocket.close()
        except RuntimeError:
            pass  # Already closed 