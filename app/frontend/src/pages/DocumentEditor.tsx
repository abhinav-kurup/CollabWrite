import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Container, Typography, Button, Paper, Chip } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import * as monaco from 'monaco-editor';
import { documentService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface Document {
  id: number;
  title: string;
  content: any;
  owner_id: number;
  collaborators: number[];
}

const DocumentEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<Document | null>(null);
  const [activeUsers, setActiveUsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!id) return;

    const fetchDocument = async () => {
      try {
        const doc = await documentService.getDocument(parseInt(id));
        setDocument(doc);
      } catch (err) {
        setError('Failed to load document');
        console.error('Error fetching document:', err);
      }
    };

    fetchDocument();
  }, [id]);

  useEffect(() => {
    if (!containerRef.current || !document || !user) return;

    // Initialize Monaco editor
    const editor = monaco.editor.create(containerRef.current, {
      value: document.content || '',
      language: 'markdown',
      theme: 'vs-dark',
      automaticLayout: true,
    });
    editorRef.current = editor;

    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('Authentication token not found');
      return;
    }

    // Connect to WebSocket
    const ws = new WebSocket(`ws://localhost:8000/api/v1/ws/${id}?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('Received message:', data);

      switch (data.type) {
        case 'init':
          // Set initial document state
          if (data.state) {
            editor.setValue(data.state.text || '');
          }
          break;
        case 'edit':
          // Handle edit operations
          if (data.state) {
            editor.setValue(data.state.text || '');
          }
          break;
        case 'cursor':
          // Handle cursor updates
          if (data.user_id && data.position) {
            // Update cursor position for other users
            // This would require additional UI to show other users' cursors
          }
          break;
        case 'user_joined':
          // Handle user joined event
          if (data.user_id) {
            setActiveUsers(prev => new Set([...Array.from(prev), data.user_id.toString()]));
          }
          break;
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error');
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    // Handle editor changes
    editor.onDidChangeModelContent(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const value = editor.getValue();
        const position = editor.getPosition();
        
        ws.send(JSON.stringify({
          type: 'edit',
          value: value,
          index: position ? editor.getModel()?.getOffsetAt(position) : 0
        }));
      }
    });

    // Handle cursor position changes
    editor.onDidChangeCursorPosition(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const position = editor.getPosition();
        if (position) {
          const offset = editor.getModel()?.getOffsetAt(position);
          ws.send(JSON.stringify({
            type: 'cursor',
            position: offset
          }));
        }
      }
    });

    // Save document periodically
    const saveInterval = setInterval(async () => {
      try {
        await documentService.updateDocument(document.id, {
          content: editor.getValue(),
        });
      } catch (err) {
        console.error('Error saving document:', err);
      }
    }, 5000);

    return () => {
      clearInterval(saveInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
      editor.dispose();
    };
  }, [document, user, id]);

  const handleBack = () => {
    navigate('/dashboard');
  };

  if (error) {
    return (
      <Container>
        <Typography color="error">{error}</Typography>
        <Button onClick={handleBack}>Back to Dashboard</Button>
      </Container>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={handleBack}
          variant="outlined"
        >
          Back
        </Button>
        <Typography variant="h5" component="h1">
          {document?.title}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1 }}>
          {Array.from(activeUsers).map((userId) => (
            <Chip
              key={userId}
              label={`User ${userId}`}
              color="primary"
              variant="outlined"
            />
          ))}
        </Box>
      </Box>
      <Paper
        ref={containerRef}
        sx={{
          flexGrow: 1,
          m: 2,
          overflow: 'hidden',
        }}
      />
    </Box>
  );
};

export default DocumentEditor; 