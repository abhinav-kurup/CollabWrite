from typing import Dict, Set, Optional, Any
from fastapi import WebSocket, WebSocketDisconnect
from datetime import datetime
import json
import asyncio
from app.backend.core.crdt import CRDT, Character

class ConnectionManager:
    def __init__(self):
        # Store active connections: {document_id: {user_id: WebSocket}}
        self.active_connections: Dict[int, Dict[int, WebSocket]] = {}
        # Store user sessions: {user_id: Set[document_id]}
        self.user_sessions: Dict[int, Set[int]] = {}
        # Store document states: {document_id: CRDT}
        self.document_states: Dict[int, CRDT] = {}
        # Store user cursors: {document_id: {user_id: cursor_position}}
        self.user_cursors: Dict[int, Dict[int, int]] = {}

    async def connect(self, websocket: WebSocket, document_id: int, user_id: int, crdt: CRDT):
        """Connect a user to a document session"""
        await websocket.accept()
        
        # Initialize document session if it doesn't exist
        if document_id not in self.active_connections:
            self.active_connections[document_id] = {}
            self.user_cursors[document_id] = {}
            self.document_states[document_id] = crdt
        else:
            # If document exists, merge the new CRDT with existing one
            existing_crdt = self.document_states[document_id]
            # Apply all characters from new CRDT to existing one
            for char in crdt.characters:
                existing_crdt.apply_remote_operation(char)
            # Update the document state with merged CRDT
            self.document_states[document_id] = existing_crdt
            
        # Add connection
        self.active_connections[document_id][user_id] = websocket
        
        # Track user's document sessions
        if user_id not in self.user_sessions:
            self.user_sessions[user_id] = set()
        self.user_sessions[user_id].add(document_id)
        
        # Send current document state to the new user
        await websocket.send_json({
            "type": "init",
            "document_id": document_id,
            "content": self.document_states[document_id].get_text(),
            "crdt_state": self.document_states[document_id].to_dict(),
            "cursors": self.user_cursors.get(document_id, {}),
            "timestamp": datetime.utcnow().isoformat()
        })

    def disconnect(self, document_id: int, user_id: int):
        """Disconnect a user from a document session"""
        if document_id in self.active_connections:
            self.active_connections[document_id].pop(user_id, None)
            if not self.active_connections[document_id]:
                del self.active_connections[document_id]
                del self.user_cursors[document_id]
                del self.document_states[document_id]
        
        if user_id in self.user_sessions:
            self.user_sessions[user_id].discard(document_id)
            if not self.user_sessions[user_id]:
                del self.user_sessions[user_id]

    async def broadcast_to_document(self, document_id: int, message: dict, exclude_user: Optional[int] = None):
        """Broadcast a message to all users in a document session"""
        if document_id in self.active_connections:
            for user_id, connection in self.active_connections[document_id].items():
                if user_id != exclude_user:
                    try:
                        await connection.send_json(message)
                    except WebSocketDisconnect:
                        self.disconnect(document_id, user_id)
                    except Exception:
                        self.disconnect(document_id, user_id)

# Global connection manager instance
manager = ConnectionManager() 