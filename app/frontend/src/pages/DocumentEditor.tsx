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
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $createParagraphNode, $createTextNode, EditorState, LexicalEditor, $isRangeSelection } from 'lexical';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { ListItemNode, ListNode } from '@lexical/list';
import { LinkNode } from '@lexical/link';
import { CodeNode, CodeHighlightNode } from '@lexical/code';
import { debounce } from 'lodash';

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

// --- Custom hook for remote cursors ---
function useRemoteCursors(editor: LexicalEditor | null, userId: number, remoteCursors: { [userId: number]: any }) {
  const [caretPositions, setCaretPositions] = useState<{ [userId: number]: { left: number, top: number } }>({});
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const colors = [
    '#e57373', '#64b5f6', '#81c784', '#ffd54f', '#ba68c8', '#4dd0e1', '#ff8a65', '#a1887f', '#90a4ae', '#f06292'
  ];
  function getColor(uid: number) {
    return colors[uid % colors.length];
  }

  // Calculate caret positions for remote cursors
  useEffect(() => {
    if (!editor) return;
    const updateCaretPositions = () => {
      editor.getEditorState().read(() => {
        const positions: { [userId: number]: { left: number, top: number } } = {};
        const dom = contentEditableRef.current;
        if (!dom) return;
        Object.entries(remoteCursors).forEach(([uid, cursor]) => {
          if (parseInt(uid) === userId) return;
          if (!cursor || typeof cursor.anchor !== 'number') return;
          // Find all text nodes
          const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT, null);
          let total = 0;
          let found = false;
          let left = 0, top = 0;
          while (walker.nextNode()) {
            const node = walker.currentNode as Text;
            const len = node.textContent?.length || 0;
            if (total + len >= cursor.anchor) {
              // Found the text node containing the anchor
              const range = document.createRange();
              range.setStart(node, cursor.anchor - total);
              range.setEnd(node, cursor.anchor - total);
              const rect = range.getBoundingClientRect();
              const parentRect = dom.getBoundingClientRect();
              left = rect.left - parentRect.left;
              top = rect.top - parentRect.top;
              found = true;
              break;
            }
            total += len;
          }
          if (found) {
            positions[parseInt(uid)] = { left, top };
          }
        });
        setCaretPositions(positions);
      });
    };
    updateCaretPositions();
    // Recalculate on every remoteCursors change and every editor update
    const removeListener = editor.registerUpdateListener(() => {
      updateCaretPositions();
    });
    window.addEventListener('resize', updateCaretPositions);
    return () => {
      removeListener();
      window.removeEventListener('resize', updateCaretPositions);
    };
  }, [editor, remoteCursors, userId]);

  // Render overlays for remote cursors
  const RemoteCursorsOverlay = () => {
    if (!editor) return null;
    return (
      <>
        {Object.entries(remoteCursors).map(([uid, cursor]) => {
          if (parseInt(uid) === userId) return null;
          if (!cursor || cursor.anchor == null) return null;
          const pos = caretPositions[parseInt(uid)];
          if (!pos) return null;
          const username = cursor.username || `User ${uid}`;
          return (
            <div
              key={uid}
              className="remote-cursor-wrapper"
              style={{ position: 'absolute', left: pos.left, top: pos.top, zIndex: 20 }}
            >
              <div
                className="remote-cursor"
                style={{
                  width: 2,
                  height: 20,
                  background: getColor(Number(uid)),
                  pointerEvents: 'auto',
                  opacity: 0.8,
                  position: 'relative',
                  display: 'inline-block',
                }}
              >
                <div className="remote-cursor-tooltip">{username}</div>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  return { RemoteCursorsOverlay, contentEditableRef };
}

// Custom plugin to handle WebSocket collaboration
function CollaborationPlugin({ 
  documentId, 
  userId, 
  wsUrl,
  initialCrdtState,
  onSave,
  setRemoteCursors,
}: { 
  documentId: number;
  userId: number;
  wsUrl: string;
  initialCrdtState: any;
  onSave: (content: any) => Promise<void>;
  setRemoteCursors: React.Dispatch<React.SetStateAction<{ [userId: number]: any }>>;
}) {
  const [editor] = useLexicalComposerContext();
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const isConnectingRef = useRef(false);
  const isClosingRef = useRef(false);
  const initialSyncDoneRef = useRef(false);
  const lastTextRef = useRef<string>('');
  const lastSelectionRef = useRef<any>(null);
  const suppressLocalChangeRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const colors = [
    '#e57373', '#64b5f6', '#81c784', '#ffd54f', '#ba68c8', '#4dd0e1', '#ff8a65', '#a1887f', '#90a4ae', '#f06292'
  ];
  function getColor(uid: number) {
    return colors[uid % colors.length];
  }

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
      setConnected(true);
      setError(null);
      isConnectingRef.current = false;
      console.log('WebSocket connected');
    };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Received WebSocket message:', data);
        
        if (data.type === 'init' || data.type === 'sync_response') {
          // Initial sync: set the editor content
          if (!initialSyncDoneRef.current) {
            suppressLocalChangeRef.current = true;
            editor.update(() => {
              const root = $getRoot();
              root.clear();
              const paragraph = $createParagraphNode();
              const text = data.state.text || data.content?.text || '';
              paragraph.append($createTextNode(text));
              root.append(paragraph);
            });
            lastTextRef.current = data.state.text || data.content?.text || '';
            suppressLocalChangeRef.current = false;
            initialSyncDoneRef.current = true;
          }
        } else if (data.type === 'update' && data.content) {
          // Remote content update: apply to editor
          if (data.user_id !== userId) {
            suppressLocalChangeRef.current = true;
            editor.update(() => {
              const root = $getRoot();
              root.clear();
              const paragraph = $createParagraphNode();
              const text = data.content.text || '';
              paragraph.append($createTextNode(text));
              root.append(paragraph);
            });
            lastTextRef.current = data.content.text || '';
            suppressLocalChangeRef.current = false;
          }
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    };
    socket.onclose = (event) => {
      setConnected(false);
      isConnectingRef.current = false;
      setWs(null);
      console.log('WebSocket disconnected:', event.code, event.reason);
      if (event.code !== 1000 && event.code !== 1001) {
        setError('Connection closed unexpectedly');
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => { connectWebSocket(); }, 5000);
      }
    };
    socket.onerror = (error) => {
      setError('Connection error');
      isConnectingRef.current = false;
      console.error('WebSocket error:', error);
    };
    setWs(socket);
  }, [ws, wsUrl, userId, editor]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (ws) ws.close(1000, 'Component unmounting');
    };
  }, [connectWebSocket]);

  // --- Detect and send content updates ---
  useEffect(() => {
    if (!ws || !connected) return;
    
    const removeUpdateListener = editor.registerUpdateListener(({ editorState }) => {
      if (suppressLocalChangeRef.current) return;
      
      editorState.read(() => {
        const root = $getRoot();
        const newText = root.getTextContent();
        const oldText = lastTextRef.current;
        
        if (newText !== oldText) {
          console.log('Content changed, sending update:', { oldText, newText });
          
          // Create character array for CRDT
          const characters = Array.from(newText).map((char, index) => ({
            value: char,
            position: {
              site_id: userId.toString(),
              counter: index,
              timestamp: Date.now()
            },
            deleted: false
          }));
          
          // Send update to WebSocket
          const updateContent = {
            text: newText,
            characters: characters,
            version: Date.now()
          };
          
          try {
            ws.send(JSON.stringify({
              type: 'update',
              content: updateContent,
              user_id: userId,
              document_id: documentId
            }));
            console.log('Sent update to WebSocket:', updateContent);
            
            // Debounced save to database
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = setTimeout(async () => {
              try {
                await onSave(updateContent);
                console.log('Content saved to database:', updateContent);
              } catch (error) {
                console.error('Error saving content:', error);
              }
            }, 2000); // Save after 2 seconds of no changes
          } catch (error) {
            console.error('Error sending update:', error);
          }
          
          lastTextRef.current = newText;
        }
      });
    });

    return () => {
      removeUpdateListener();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [ws, connected, editor, userId, documentId, onSave]);

  // --- Send local cursor/selection to backend ---
  useEffect(() => {
    if (!ws || !connected) return;
    const sendCursor = () => {
      const selection = editor.getEditorState()._selection;
      if (!$isRangeSelection(selection)) return;
      const anchor = selection.anchor.offset;
      const focus = selection.focus.offset;
      ws.send(
        JSON.stringify({
          type: 'cursor',
          user_id: userId,
          document_id: documentId,
          data: { anchor, focus },
        })
      );
    };
    // Listen for selection changes
    const removeListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        sendCursor();
      });
    });
    return () => {
      removeListener();
    };
  }, [ws, connected, editor, userId, documentId]);

  // --- Listen for remote cursor updates ---
  useEffect(() => {
    if (!ws) return;
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'cursor' && data.user_id !== userId) {
          setRemoteCursors((prev) => ({ ...prev, [data.user_id]: data.data }));
        }
        if (data.type === 'init' && data.cursors) {
          setRemoteCursors(data.cursors);
        }
        if (data.type === 'user_disconnected' && data.user_id) {
          setRemoteCursors((prev) => {
            const copy = { ...prev };
            delete copy[data.user_id];
            return copy;
          });
        }
      } catch (e) {}
    };
    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, userId, setRemoteCursors]);

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
    );
  }
  return null;
}

// --- SavePlugin to expose editor instance ---
function SavePlugin({ setEditor }: { setEditor: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    setEditor(editor);
  }, [editor, setEditor]);
  return null;
}

const DocumentEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [crdtState, setCrdtState] = useState<any>(null);
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<{ [userId: number]: any }>({});

  // Auto-save handler
  const handleAutoSave = async (content: any) => {
    if (!id) return;
    setSaveStatus('saving');
    try {
      console.log('Auto-saving document with content:', content);
      const response = await documentService.updateDocument(parseInt(id), {
        content: content,
      });
      console.log('Auto-save response:', response);
      setDocument(response);
      setSaveStatus('saved');
      // Reset status after 3 seconds
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error('Error auto-saving document:', err);
      setSaveStatus('error');
      setError('Failed to auto-save document. Please try again.');
    }
  };

  // Load document
  const loadDocument = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const doc = await documentService.getDocument(parseInt(id));
      setDocument(doc);
      setCrdtState(doc.content || { text: '', characters: [], version: 0 });
      setError(null);
    } catch (err) {
      console.error('Error loading document:', err);
      setError('Failed to load document');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocument();
  }, [id]);

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
      paragraph.append($createTextNode(document?.content?.text || ''));
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

  const { RemoteCursorsOverlay, contentEditableRef } = useRemoteCursors(editor, user?.id || 0, remoteCursors);

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
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={20} color="inherit" />
                <Typography variant="body2" color="inherit">
                  Saving...
                </Typography>
              </Box>
            )}
            {saveStatus === 'saved' && (
              <Typography variant="body2" color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                ✓ Saved
              </Typography>
            )}
            {saveStatus === 'error' && (
              <Typography variant="body2" color="error" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                ✗ Save failed
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
            <SavePlugin setEditor={setEditor} />
            <div className="editor-container" style={{ position: 'relative' }}>
              <RichTextPlugin
                contentEditable={<ContentEditable className="editor-input" ref={contentEditableRef} />}
                placeholder={<div className="editor-placeholder">Start typing...</div>}
                ErrorBoundary={EditorErrorBoundary}
              />
              <HistoryPlugin />
              <AutoFocusPlugin />
              <LinkPlugin />
              <ListPlugin />
              <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
              {document && (
                <CollaborationPlugin
                  documentId={parseInt(id!)}
                  userId={user?.id || 0}
                  wsUrl={`ws://localhost:8000/api/v1/ws/${id}`}
                  initialCrdtState={crdtState}
                  onSave={handleAutoSave}
                  setRemoteCursors={setRemoteCursors}
                />
              )}
              <RemoteCursorsOverlay />
            </div>
          </LexicalComposer>
        </Paper>
      </Box>
    </Box>
  );
};

export default DocumentEditor;
