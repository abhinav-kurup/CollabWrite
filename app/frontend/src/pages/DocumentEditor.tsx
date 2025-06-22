import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { documentService } from '../services/api';
import './DocumentEditor.css';
import {
  Box,
  Container,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
  Button,
  CircularProgress,
  Alert,
  Paper,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Save as SaveIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { TRANSFORMERS } from '@lexical/markdown';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $createParagraphNode, $createTextNode, EditorState, LexicalEditor } from 'lexical';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { LinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode } from '@lexical/code';

// Error boundary component for the editor
function EditorErrorBoundary({ children }: { children: React.ReactNode }) {
  return <div className="editor-error-boundary">{children}</div>;
}

// Custom plugin to handle CRDT operations
function CRDTPlugin({ onContentChange }: { onContentChange: (editorState: EditorState, editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      onContentChange(editorState, editor);
    });
  }, [editor, onContentChange]);

  return null;
}

// Custom plugin to handle WebSocket collaboration
function CollaborationPlugin({ 
  documentId, 
  userId, 
  wsUrl,
  initialCrdtState
}: { 
  documentId: number;
  userId: number;
  wsUrl: string;
  initialCrdtState: any;
}) {
  const [editor] = useLexicalComposerContext();
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const messageQueueRef = useRef<Array<{ type: string; data: any }>>([]);
  const isConnectingRef = useRef(false);
  const isClosingRef = useRef(false);
  const initialSyncDoneRef = useRef(false);
  const lastContentRef = useRef<string>('');

  const sendMessage = useCallback((type: string, data: any) => {
    if (ws && connected && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type, ...data }));
      } catch (error) {
        console.error('Error sending message:', error);
        // Queue the message if sending fails
        messageQueueRef.current.push({ type, data });
      }
    } else {
      messageQueueRef.current.push({ type, data });
    }
  }, [ws, connected]);

  const processMessageQueue = useCallback(() => {
    if (!ws || !connected || ws.readyState !== WebSocket.OPEN) return;

    while (messageQueueRef.current.length > 0) {
      const { type, data } = messageQueueRef.current.shift()!;
      try {
        ws.send(JSON.stringify({ type, ...data }));
      } catch (error) {
        console.error('Error processing message queue:', error);
        // Put the message back in the queue
        messageQueueRef.current.unshift({ type, data });
        break;
      }
    }
  }, [ws, connected]);

  const closeWebSocket = useCallback(() => {
    if (ws && !isClosingRef.current) {
      isClosingRef.current = true;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Normal closure');
        }
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
      setWs(null);
      setConnected(false);
      isClosingRef.current = false;
    }
  }, [ws]);

  const connectWebSocket = useCallback(() => {
    if (isConnectingRef.current || ws) return;
    isConnectingRef.current = true;

    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('No authentication token found');
      isConnectingRef.current = false;
      return;
    }

    const wsUrlWithToken = `${wsUrl}?token=${token}`;
    const socket = new WebSocket(wsUrlWithToken);
    
    socket.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
      setError(null);
      isConnectingRef.current = false;
      processMessageQueue();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'init':
          case 'sync_response':
            // Only update content if we haven't done initial sync
            if (!initialSyncDoneRef.current) {
              const newContent = data.state.text || '';
              if (newContent !== lastContentRef.current) {
                editor.update(() => {
                  const root = $getRoot();
                  root.clear();
                  const paragraph = $createParagraphNode();
                  paragraph.append($createTextNode(newContent));
                  root.append(paragraph);
                });
                lastContentRef.current = newContent;
              }
              initialSyncDoneRef.current = true;
            }
            break;
            
          case 'edit':
            // Only apply remote edits if they're from other users
            if (data.user_id !== userId) {
              const newContent = data.state.text || '';
              if (newContent !== lastContentRef.current) {
                editor.update(() => {
                  const root = $getRoot();
                  root.clear();
                  const paragraph = $createParagraphNode();
                  paragraph.append($createTextNode(newContent));
                  root.append(paragraph);
                });
                lastContentRef.current = newContent;
              }
            }
            break;
            
          case 'cursor':
            // Handle cursor updates
            break;

          case 'error':
            setError(data.message || 'An error occurred');
            break;
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    };

    socket.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      setConnected(false);
      isConnectingRef.current = false;
      setWs(null);

      // Only attempt reconnect for unexpected closures
      if (event.code !== 1000 && event.code !== 1001) {
        if (event.code === 4001) {
          setError('Authentication failed');
        } else if (event.code === 4002) {
          setError('Invalid token');
        } else if (event.code === 4003) {
          setError('Access denied');
        } else if (event.code === 4004) {
          setError('Document not found');
        } else {
          setError('Connection closed unexpectedly');
        }

        // Attempt to reconnect after a delay
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 5000);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('Connection error');
      isConnectingRef.current = false;
    };

    setWs(socket);
  }, [documentId, userId, wsUrl, editor]);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws) {
        ws.close(1000, 'Component unmounting');
      }
    };
  }, [connectWebSocket]);

  // Send local changes to server
  useEffect(() => {
    if (!ws || !connected) return;

    const removeUpdateListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();
        const content = root.getTextContent();
        
        // Only send if content has changed
        if (content !== lastContentRef.current) {
          lastContentRef.current = content;
          sendMessage('edit', {
            document_id: documentId,
            user_id: userId,
            content: content
          });
        }
      });
    });

    return () => {
      removeUpdateListener();
    };
  }, [ws, connected, editor, documentId, userId, sendMessage]);

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  return null;
}

const DocumentEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [content, setContent] = useState('');
  const [crdtState, setCrdtState] = useState<any>(null);

  // Load document data
  useEffect(() => {
    const loadDocument = async () => {
      try {
        if (!id) return;
        const doc = await documentService.getDocument(parseInt(id));
        setDocument(doc);
        
        // Handle content initialization
        if (doc.content) {
          if (typeof doc.content === 'string') {
            setContent(doc.content);
            setCrdtState({
              text: doc.content,
              characters: [],
              version: doc.version
            });
          } else if (doc.content.text) {
            setContent(doc.content.text);
            setCrdtState(doc.content);
          }
        } else {
          setContent('');
          setCrdtState({
            text: '',
            characters: [],
            version: doc.version
          });
        }
      } catch (err) {
        console.error('Error loading document:', err);
        setError('Failed to load document');
      } finally {
        setLoading(false);
      }
    };

    loadDocument();
  }, [id]);

  // Handle content changes
  const handleContentChange = useCallback(async (editorState: EditorState, editor: LexicalEditor) => {
    if (!id || !document) return;

    setSaveStatus('saving');
    try {
      const content = editorState.read(() => {
        const root = $getRoot();
        return root.getTextContent();
      });

      // Get user ID - try from context first, then localStorage as fallback
      const userId = user?.id || parseInt(localStorage.getItem('user_id') || '0');

      // Create CRDT characters for new content
      const newCharacters = Array.from(content).map((char, index) => ({
        value: char,
        position: {
          site_id: userId.toString(),
          counter: index,
          timestamp: Date.now()
        },
        deleted: false
      }));

      // Update content with new CRDT state
      const updatedContent = {
        text: content,
        characters: newCharacters,
        version: (crdtState?.version || 0) + 1
      };

      const response = await documentService.updateDocument(parseInt(id), {
        content: updatedContent
      });
      
      // Update local state with response from server
      if (response.content) {
        setCrdtState(response.content);
      }
      setSaveStatus('saved');
    } catch (err) {
      console.error('Error saving document:', err);
      setSaveStatus('error');
    }
  }, [id, document, crdtState, user?.id]);

  // Initialize editor with content
  const initialConfig = {
    namespace: 'DocumentEditor',
    onError: (error: Error) => {
      console.error('Editor error:', error);
      setError('An error occurred in the editor');
    },
    editorState: () => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(content));
      root.append(paragraph);
    },
    theme: {
      paragraph: 'editor-paragraph',
      text: {
        base: 'editor-text',
        bold: 'editor-text-bold',
        italic: 'editor-text-italic',
        underline: 'editor-text-underline',
      },
    },
    nodes: [
      HeadingNode,
      QuoteNode,
      ListItemNode,
      ListNode,
      LinkNode,
      CodeNode,
      CodeHighlightNode
    ],
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Alert severity="error">{error}</Alert>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/dashboard')}
          sx={{ mt: 2 }}
        >
          Back to Dashboard
        </Button>
      </Container>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => navigate('/dashboard')}
            sx={{ mr: 2 }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {document?.title || 'Untitled Document'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {saveStatus === 'saving' && (
              <CircularProgress size={20} color="inherit" />
            )}
            {saveStatus === 'saved' && (
              <Typography variant="body2" color="inherit">
                Saved
              </Typography>
            )}
            {saveStatus === 'error' && (
              <Typography variant="body2" color="error">
                Error saving
              </Typography>
            )}
            <IconButton color="inherit">
              <PersonIcon />
            </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      <Box sx={{ flexGrow: 1, overflow: 'hidden', p: 2 }}>
        <Paper sx={{ height: '100%', p: 2 }}>
          <LexicalComposer initialConfig={initialConfig}>
            <div className="editor-container">
              <RichTextPlugin
                contentEditable={<ContentEditable className="editor-input" />}
                placeholder={<div className="editor-placeholder">Start typing...</div>}
                ErrorBoundary={EditorErrorBoundary}
              />
              <HistoryPlugin />
              <AutoFocusPlugin />
              <LinkPlugin />
              <ListPlugin />
              <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
              <OnChangePlugin onChange={handleContentChange} />
              {user && (
                <CollaborationPlugin
                  documentId={parseInt(id!)}
                  userId={user.id || parseInt(localStorage.getItem('user_id') || '0')}
                  wsUrl={`ws://localhost:8000/api/v1/ws/${id}`}
                  initialCrdtState={crdtState}
                />
              )}
            </div>
          </LexicalComposer>
        </Paper>
      </Box>
    </Box>
  );
};

export default DocumentEditor;
