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
        # Store message queues: {document_id: asyncio.Queue}
        self.message_queues: Dict[int, asyncio.Queue] = {}
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
            self.message_queues[document_id] = asyncio.Queue()
            self.user_cursors[document_id] = {}
            self.document_states[document_id] = crdt
            
        # Add connection
        self.active_connections[document_id][user_id] = websocket
        
        # Track user's document sessions
        if user_id not in self.user_sessions:
            self.user_sessions[user_id] = set()
        self.user_sessions[user_id].add(document_id)
        
        # Start message processing for this document if not already running
        if document_id not in self.message_queues:
            asyncio.create_task(self._process_messages(document_id))
        
        # Notify others that user joined
        await self.broadcast_to_document(
            document_id,
            {
                "type": "user_joined",
                "user_id": user_id,
                "timestamp": datetime.utcnow().isoformat()
            },
            exclude_user=user_id
        )

    def disconnect(self, document_id: int, user_id: int):
        """Disconnect a user from a document session"""
        if document_id in self.active_connections:
            self.active_connections[document_id].pop(user_id, None)
            if not self.active_connections[document_id]:
                del self.active_connections[document_id]
                del self.message_queues[document_id]
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
                    except Exception as e:
                        print(f"Error broadcasting to user {user_id}: {str(e)}")
                        self.disconnect(document_id, user_id)

    async def _process_messages(self, document_id: int):
        """Process messages in the queue for a document"""
        while document_id in self.message_queues:
            try:
                message = await self.message_queues[document_id].get()
                await self._handle_message(document_id, message)
                self.message_queues[document_id].task_done()
            except Exception as e:
                print(f"Error processing message for document {document_id}: {str(e)}")

    async def _handle_message(self, document_id: int, message: dict):
        """Handle different types of messages"""
        message_type = message.get("type")
        
        if message_type == "edit":
            await self._handle_edit(document_id, message)
        elif message_type == "cursor":
            await self._handle_cursor(document_id, message)
        elif message_type == "sync_request":
            await self._handle_sync_request(document_id, message)

    async def _handle_edit(self, document_id: int, message: dict):
        """Handle edit operations"""
        user_id = message.get("user_id")
        operation = message.get("operation")
        char_data = message.get("char")
        
        if not all([user_id, operation, char_data]):
            return
        
        # Create character from message
        char = Character(
            value=char_data["value"],
            position=char_data["position"],
            deleted=char_data.get("deleted", False)
        )
        
        # Apply to document state
        if document_id in self.document_states:
            self.document_states[document_id].apply_remote_operation(char)
        
        # Broadcast to other users
        await self.broadcast_to_document(
            document_id,
            {
                "type": "edit",
                "user_id": user_id,
                "operation": operation,
                "char": char_data,
                "timestamp": datetime.utcnow().isoformat()
            },
            exclude_user=user_id
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
        
        if not user_id or document_id not in self.document_states:
            return
        
        # Send current document state
        if document_id in self.active_connections and user_id in self.active_connections[document_id]:
            connection = self.active_connections[document_id][user_id]
            await connection.send_json({
                "type": "sync_response",
                "document_id": document_id,
                "state": self.document_states[document_id].to_dict(),
                "cursors": self.user_cursors.get(document_id, {}),
                "timestamp": datetime.utcnow().isoformat()
            })

    async def queue_message(self, document_id: int, message: dict):
        """Queue a message for processing"""
        if document_id in self.message_queues:
            await self.message_queues[document_id].put(message)

# Global connection manager instance
manager = ConnectionManager() 