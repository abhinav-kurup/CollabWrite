import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { documentService, aiService } from '../services/api';
import { DISABLE_AI } from '../config';
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
  Chip,
  Avatar,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Badge,
  Snackbar,
  Menu,
  MenuItem,
  Fade,
  Zoom,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Save as SaveIcon,
  Person as PersonIcon,
  FiberManualRecord as OnlineIcon,
  RadioButtonUnchecked as OfflineIcon,
  Spellcheck as SpellcheckIcon,
  Error as ErrorIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
  AutoAwesome as AIIcon,
  Lightbulb as SuggestionIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  MoreVert as MoreVertIcon,
  Clear as ClearIcon,
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
import { $getRoot, $createParagraphNode, $createTextNode, EditorState, LexicalEditor, $isRangeSelection, $getSelection } from 'lexical';
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

// Enhanced user presence types
interface UserPresence {
  userId: number;
  username: string;
  connectionId: string;
  status: 'online' | 'away' | 'offline';
  lastSeen: number;
  cursor?: {
    anchor: number;
    focus: number;
    timestamp: number;
  };
  avatar?: string;
  color: string;
}

interface PresenceState {
  [userId: number]: UserPresence;
}

// AI Integration Interfaces
interface GrammarIssue {
  message: string;
  short_message: string;
  offset: number;
  length: number;
  replacements: string[];
  rule_id: string;
  rule_category: string;
  confidence: number;
}

interface GrammarResult {
  issues: GrammarIssue[];
  summary: {
    total_issues: number;
    categories: { [key: string]: number };
    text_length: number;
  };
}

interface AISuggestion {
  type: 'grammar' | 'style' | 'spelling';
  text: string;
  replacements: string[];
  confidence: number;
  offset: number;
  length: number;
}

interface AIState {
  grammarIssues: GrammarIssue[];
  suggestions: AISuggestion[];
  isChecking: boolean;
  lastCheckedText: string;
  error: string | null;
  healthStatus: 'healthy' | 'unhealthy' | 'unknown';
}

// AI Integration Plugin - Google Docs Style
function AIIntegrationPlugin({ 
  onAIStateChange,
  aiState,
  enabled = true
}: { 
  onAIStateChange: (state: Partial<AIState>) => void;
  aiState: AIState;
  enabled: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const [currentText, setCurrentText] = useState('');

  // Debounced AI check with smart throttling and error handling
  const debouncedAICheck = useCallback(
    debounce(async (text: string) => {
      if (!enabled || !text.trim() || text.length < 10 || text === aiState.lastCheckedText) {
        return;
      }

      try {
        onAIStateChange({ isChecking: true, error: null });
        
        // Get comprehensive AI suggestions
        const result = await aiService.getSuggestions(text);
        
        if (result.success && result.data) {
          const suggestions: AISuggestion[] = [];
          
          // Process grammar issues with proper error handling
          if (result.data.grammar && Array.isArray(result.data.grammar.issues)) {
            result.data.grammar.issues.forEach((issue: any) => {
              try {
                // Validate issue data structure
                if (issue && typeof issue.offset === 'number' && typeof issue.length === 'number') {
                  const issueText = text.substring(issue.offset, issue.offset + issue.length);
                  if (issueText.length > 0) {
                    suggestions.push({
                      type: (issue.rule_category || '').toLowerCase().includes('spelling') ? 'spelling' : 'grammar',
                      text: issueText,
                      replacements: Array.isArray(issue.replacements) ? issue.replacements : [],
                      confidence: typeof issue.confidence === 'number' ? issue.confidence : 0.8,
                      offset: issue.offset,
                      length: issue.length
                    });
                  }
                }
              } catch (issueError) {
                // ignore invalid issue entry
              }
            });
          }
          
          // Process style improvements with validation
          if (result.data.style_improvements && Array.isArray(result.data.style_improvements.paraphrases)) {
            result.data.style_improvements.paraphrases.forEach((paraphrase: any) => {
              try {
                if (paraphrase && typeof paraphrase.text === 'string' && paraphrase.text.trim()) {
                  suggestions.push({
                    type: 'style',
                    text: text.substring(0, Math.min(100, text.length)), // Limit text length for style suggestions
                    replacements: [paraphrase.text],
                    confidence: typeof paraphrase.confidence === 'number' ? paraphrase.confidence : 0.7,
                    offset: 0,
                    length: Math.min(100, text.length)
                  });
                }
              } catch (paraphraseError) {
                // ignore invalid paraphrase entry
              }
            });
          }
          
          // Update state with validated suggestions
          onAIStateChange({
            grammarIssues: result.data.grammar?.issues || [],
            suggestions,
            isChecking: false,
            lastCheckedText: text,
            error: null
          });
        } else {
          // Handle API response without success
          onAIStateChange({
            isChecking: false,
            error: 'AI service returned invalid response'
          });
        }
      } catch (error: any) {
        console.error('AI check failed:', error);
        onAIStateChange({
          isChecking: false,
          error: error.message || 'AI check failed'
        });
      }
    }, 1500), // 1.5 seconds debounce for better UX
    [enabled, aiState.lastCheckedText, onAIStateChange]
  );

  useEffect(() => {
    if (!enabled) return;

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();
        const text = root.getTextContent();
        setCurrentText(text);
        debouncedAICheck(text);
      });
    });
  }, [editor, debouncedAICheck, enabled]);

  return null;
}

// Inline AI Suggestions Overlay - Professional Grade Implementation
function InlineAISuggestions({ 
  suggestions, 
  onApplySuggestion,
  onDismissSuggestion
}: { 
  suggestions: AISuggestion[];
  onApplySuggestion: (suggestion: AISuggestion, replacement: string) => void;
  onDismissSuggestion: (suggestion: AISuggestion) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [markerPositions, setMarkerPositions] = useState<{[key: string]: {left: number, width: number, top: number}}>({});
  const [isCalculating, setIsCalculating] = useState(false);

  // Professional positioning calculation using DOM measurements with text validation
  const calculatePositions = useCallback(async () => {
    if (suggestions.length === 0 || isCalculating) return;
    
    setIsCalculating(true);
    const positions: {[key: string]: {left: number, width: number, top: number}} = {};
    
    try {
      // Get the editor element
      const editorElement = document.querySelector('[contenteditable="true"]') as HTMLElement;
      if (!editorElement) return;

      // Get computed styles for accurate measurements
      const computedStyle = window.getComputedStyle(editorElement);
      const fontSize = parseInt(computedStyle.fontSize) || 16;
      const lineHeight = parseInt(computedStyle.lineHeight) || fontSize * 1.6;
      const paddingLeft = parseInt(computedStyle.paddingLeft) || 0;
      const paddingTop = parseInt(computedStyle.paddingTop) || 0;
      const fontFamily = computedStyle.fontFamily;

      // Create a temporary element to measure actual character widths
      const tempElement = document.createElement('span');
      tempElement.style.position = 'absolute';
      tempElement.style.visibility = 'hidden';
      tempElement.style.whiteSpace = 'pre';
      tempElement.style.font = `${fontSize}px ${fontFamily}`;
      tempElement.style.lineHeight = `${lineHeight}px`;
      document.body.appendChild(tempElement);

      // Calculate character width using actual text measurement
      tempElement.textContent = 'M'; // Use 'M' as reference character
      const charWidth = tempElement.offsetWidth;
      
      // Calculate line width and characters per line
      const editorWidth = editorElement.offsetWidth - paddingLeft * 2;
      const charsPerLine = Math.floor(editorWidth / charWidth);

      // Get current text content to validate suggestions
      const currentText = editorElement.textContent || '';
      
      // Process each suggestion with text validation
      suggestions.forEach((suggestion, index) => {
        const key = `${suggestion.offset}-${suggestion.length}-${index}`;
        
        try {
          // Validate that the suggested text still exists at the specified offset
          const textAtOffset = currentText.substring(suggestion.offset, suggestion.offset + suggestion.length);
          
          // If the text doesn't match or is empty, skip this suggestion
          if (textAtOffset !== suggestion.text || textAtOffset.length === 0) {
            return; // Skip this suggestion
          }
          
          // Calculate line number based on character offset
          const lineNumber = Math.floor(suggestion.offset / charsPerLine);
          
          // Calculate horizontal position within the line
          const horizontalOffset = suggestion.offset % charsPerLine;
          
          // Calculate actual width of the suggested text
          tempElement.textContent = suggestion.text;
          const actualWidth = Math.min(tempElement.offsetWidth, suggestion.length * charWidth);
          
          positions[key] = {
            left: horizontalOffset * charWidth + paddingLeft,
            width: actualWidth,
            top: lineNumber * lineHeight + paddingTop + lineHeight * 0.9 // Position below text baseline
          };
        } catch (error) {
          // Skip invalid suggestions instead of using fallback
          return;
        }
      });

      // Clean up temporary element
      document.body.removeChild(tempElement);
      
      setMarkerPositions(positions);
    } catch (error) {
      // Don't set fallback positions for invalid suggestions
      setMarkerPositions({});
    } finally {
      setIsCalculating(false);
    }
  }, [suggestions, isCalculating]);

  // Debounced position calculation to prevent excessive updates
  useEffect(() => {
    if (suggestions.length === 0) return;

    const timeoutId = setTimeout(calculatePositions, 150);
    return () => clearTimeout(timeoutId);
  }, [suggestions, calculatePositions]);

  // Listen for text changes to clean up invalid markers
  useEffect(() => {
    if (!editor) return;

    const removeTextChangeListener = editor.registerUpdateListener(({ editorState }) => {
      // Debounce the text change listener to avoid excessive updates
      const timeoutId = setTimeout(() => {
        calculatePositions();
      }, 100);
      
      return () => clearTimeout(timeoutId);
    });

    return removeTextChangeListener;
  }, [editor, calculatePositions]);

  // Recalculate positions when window resizes
  useEffect(() => {
    const handleResize = debounce(calculatePositions, 250);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [calculatePositions]);

  if (suggestions.length === 0) return null;

  return (
    <div className="inline-ai-suggestions">
      {suggestions.map((suggestion, index) => {
        const key = `${suggestion.offset}-${suggestion.length}-${index}`;
        const position = markerPositions[key];
        
        if (!position) return null;

        return (
          <div
            key={key}
            className={`ai-suggestion-marker ${suggestion.type}`}
            data-suggestion-key={key}
            data-suggestion-type={suggestion.type}
            data-suggestion-text={suggestion.text}
            data-suggestion-replacements={JSON.stringify(suggestion.replacements)}
            data-suggestion-confidence={suggestion.confidence}
            style={{
              position: 'absolute',
              left: `${position.left}px`,
              top: `${position.top}px`,
              width: `${position.width}px`,
              height: '2px',
              backgroundColor: suggestion.type === 'spelling' ? '#dc3545' : 
                             suggestion.type === 'grammar' ? '#fd7e14' : 
                             '#007bff',
              cursor: 'pointer',
              zIndex: 10,
              borderRadius: '1px',
              transition: 'all 0.2s ease',
            }}
            onClick={() => {
              // Show tooltip on click for better mobile support
              const tooltip = document.querySelector(`[data-tooltip-for="${key}"]`);
              if (tooltip) {
                tooltip.classList.toggle('show');
              }
            }}
            onMouseEnter={(e) => {
              // Enhanced hover effect
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
            }}
            onMouseLeave={(e) => {
              // Reset hover effect
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 1px 0 currentColor';
            }}
          >
            <div className="ai-suggestion-tooltip" data-tooltip-for={key}>
              <div className="suggestion-header">
                <span className={`suggestion-type ${suggestion.type}`}>
                  {suggestion.type === 'spelling' ? 'Spelling' : 
                   suggestion.type === 'grammar' ? 'Grammar' : 'Style'}
                </span>
                <span className="suggestion-confidence">
                  {Math.round(suggestion.confidence * 100)}%
                </span>
              </div>
              <div className="suggestion-text">{suggestion.text}</div>
              {suggestion.replacements.length > 0 && (
                <div className="suggestion-replacements">
                  <div className="replacements-label">Suggestions:</div>
                  {suggestion.replacements.slice(0, 3).map((replacement, idx) => (
                    <button
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        onApplySuggestion(suggestion, replacement);
                      }}
                      className="replacement-button"
                    >
                      {replacement}
                    </button>
                  ))}
                </div>
              )}
              <div className="suggestion-actions">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismissSuggestion(suggestion);
                  }}
                  className="dismiss-button"
                >
                  Ignore
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// AI Suggestions Dialog - Comprehensive View
function AISuggestionsDialog({ 
  open, 
  onClose, 
  suggestions,
  onApplySuggestion,
  onDismissSuggestion
}: { 
  open: boolean;
  onClose: () => void;
  suggestions: AISuggestion[];
  onApplySuggestion: (suggestion: AISuggestion, replacement: string) => void;
  onDismissSuggestion: (suggestion: AISuggestion) => void;
}) {
  const getSuggestionIcon = (type: string) => {
    switch (type) {
      case 'spelling':
        return <ErrorIcon color="error" />;
      case 'grammar':
        return <ErrorIcon color="warning" />;
      case 'style':
        return <SuggestionIcon color="info" />;
      default:
        return <InfoIcon />;
    }
  };

  const getSuggestionColor = (type: string) => {
    switch (type) {
      case 'spelling':
        return 'error';
      case 'grammar':
        return 'warning';
      case 'style':
        return 'info';
      default:
        return 'default';
    }
  };

  const groupedSuggestions = suggestions.reduce((acc, suggestion) => {
    if (!acc[suggestion.type]) {
      acc[suggestion.type] = [];
    }
    acc[suggestion.type].push(suggestion);
    return acc;
  }, {} as Record<string, AISuggestion[]>);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AIIcon />
          AI Writing Suggestions
          {suggestions.length > 0 && (
            <Chip 
              label={suggestions.length} 
              color="primary" 
              size="small" 
            />
          )}
        </Box>
      </DialogTitle>
      <DialogContent>
        {suggestions.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2 }}>
            <CheckCircleIcon color="success" />
            <Typography>No suggestions found!</Typography>
          </Box>
        ) : (
          <Box>
            {Object.entries(groupedSuggestions).map(([type, typeSuggestions]) => (
              <Box key={type} sx={{ mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 1, textTransform: 'capitalize' }}>
                  {type} Suggestions ({typeSuggestions.length})
                </Typography>
                <List>
                  {typeSuggestions.map((suggestion, index) => (
                    <React.Fragment key={index}>
                      <ListItem>
                        <ListItemIcon>
                          {getSuggestionIcon(suggestion.type)}
                        </ListItemIcon>
                        <ListItemText
                          primary={suggestion.text}
                          secondary={
                            <Box>
                              <Chip 
                                label={suggestion.type} 
                                color={getSuggestionColor(suggestion.type) as any}
                                size="small" 
                                sx={{ mr: 1 }}
                              />
                              <Typography variant="body2" color="text.secondary">
                                Confidence: {Math.round(suggestion.confidence * 100)}%
                              </Typography>
                              {suggestion.replacements.length > 0 && (
                                <Box sx={{ mt: 1 }}>
                                  <Typography variant="body2" color="text.secondary">
                                    Suggestions:
                                  </Typography>
                                  <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                                    {suggestion.replacements.slice(0, 3).map((replacement, idx) => (
                                      <Button
                                        key={idx}
                                        variant="outlined"
                                        size="small"
                                        onClick={() => onApplySuggestion(suggestion, replacement)}
                                      >
                                        {replacement}
                                      </Button>
                                    ))}
                                  </Box>
                                </Box>
                              )}
                            </Box>
                          }
                        />
                        <IconButton
                          onClick={() => onDismissSuggestion(suggestion)}
                          size="small"
                        >
                          <MoreVertIcon />
                        </IconButton>
                      </ListItem>
                      {index < typeSuggestions.length - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                </List>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// AI Status Indicator
function AIStatusIndicator({ 
  aiState, 
  onRefresh 
}: { 
  aiState: AIState;
  onRefresh: () => void;
}) {
  const getStatusColor = () => {
    switch (aiState.healthStatus) {
      case 'healthy':
        return 'success';
      case 'unhealthy':
        return 'error';
      default:
        return 'warning';
    }
  };

  const getStatusIcon = () => {
    switch (aiState.healthStatus) {
      case 'healthy':
        return <CheckCircleIcon />;
      case 'unhealthy':
        return <ErrorIcon />;
      default:
        return <InfoIcon />;
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Chip
        icon={getStatusIcon()}
        label={`AI ${aiState.healthStatus}`}
        color={getStatusColor() as any}
        size="small"
        variant="outlined"
      />
      <IconButton size="small" onClick={onRefresh} disabled={aiState.isChecking}>
        <RefreshIcon />
      </IconButton>
    </Box>
  );
}

// Enhanced remote cursors hook with proper presence management
function useRemoteCursors(editor: LexicalEditor | null, userId: number, remoteCursors: { [userId: number]: any }) {
  const [caretPositions, setCaretPositions] = useState<{ [userId: number]: { left: number, top: number } }>({});
  const [presenceState, setPresenceState] = useState<PresenceState>({});
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const colors = [
    '#e57373', '#64b5f6', '#81c784', '#ffd54f', '#ba68c8', '#4dd0e1', '#ff8a65', '#a1887f', '#90a4ae', '#f06292'
  ];
  
  function getColor(uid: number) {
    return colors[uid % colors.length];
  }

  // Enhanced cursor position calculation using DOM ranges
  useEffect(() => {
    if (!editor) return;
    
    const updateCaretPositions = () => {
      const positions: { [userId: number]: { left: number, top: number } } = {};
      const dom = contentEditableRef.current;
      if (!dom) return;
      
      
      
      Object.entries(remoteCursors).forEach(([uid, cursor]) => {
        if (parseInt(uid) === userId) return;
        if (!cursor || cursor.anchor == null) return;
        
        try {
          // Enhanced approach: create temporary selection while preserving user selection
          const selection = window.getSelection();
          if (!selection) return;
          
          // Save current selection
          const currentRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
          
          // Create a new range at the remote cursor position
          const range = document.createRange();
          const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT, null);
          let totalOffset = 0;
          let found = false;
          
          while (walker.nextNode()) {
            const textNode = walker.currentNode as Text;
            const textLength = textNode.textContent?.length || 0;
            
            if (totalOffset + textLength >= cursor.anchor) {
              // Found the text node containing the cursor
              const localOffset = Math.min(cursor.anchor - totalOffset, textLength);
              range.setStart(textNode, localOffset);
              range.setEnd(textNode, localOffset);
              found = true;
              break;
            }
            totalOffset += textLength;
          }
          
          if (found) {
            // Temporarily set the selection to get accurate coordinates
            selection.removeAllRanges();
            selection.addRange(range);
            
            // Get the position with enhanced accuracy
            const rect = range.getBoundingClientRect();
            const parentRect = dom.getBoundingClientRect();
            
            positions[parseInt(uid)] = {
              left: rect.left - parentRect.left,
              top: rect.top - parentRect.top
            };
            
            // Restore original selection
            if (currentRange) {
              selection.removeAllRanges();
              selection.addRange(currentRange);
            }
            
            
          } else {
            
          }
        } catch (error) {
          console.error('Error calculating cursor position for user', uid, error);
        }
      });
      
      setCaretPositions(positions);
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

  // Enhanced presence state management
  useEffect(() => {
    const newPresenceState: PresenceState = {};
    const onlineUsersList: UserPresence[] = [];
    
    Object.entries(remoteCursors).forEach(([uid, cursor]) => {
      if (parseInt(uid) === userId) return;
      
      const userPresence: UserPresence = {
        userId: parseInt(uid),
        username: cursor.username || `User ${uid}`,
        connectionId: cursor.connectionId || Math.random().toString(36).substr(2, 9),
        status: cursor.lastUpdated && Date.now() - cursor.lastUpdated < 30000 ? 'online' : 'away',
        lastSeen: cursor.lastUpdated || Date.now(),
        cursor: cursor.anchor != null ? {
          anchor: cursor.anchor,
          focus: cursor.focus || cursor.anchor,
          timestamp: cursor.lastUpdated || Date.now()
        } : undefined,
        color: getColor(parseInt(uid))
      };
      
      newPresenceState[parseInt(uid)] = userPresence;
      if (userPresence.status === 'online') {
        onlineUsersList.push(userPresence);
      }
    });
    
    setPresenceState(newPresenceState);
    setOnlineUsers(onlineUsersList);
  }, [remoteCursors, userId]);

  // Enhanced remote cursors overlay with better visual feedback
  const RemoteCursorsOverlay = () => {
    if (!editor) return null;
    
    
    
    return (
      <>
        {Object.entries(remoteCursors).map(([uid, cursor]) => {
          if (parseInt(uid) === userId) return null;
          if (!cursor || cursor.anchor == null) return null;
          
          const pos = caretPositions[parseInt(uid)];
          const userPresence = presenceState[parseInt(uid)];
          
          if (!pos || !userPresence) {
            return null;
          }
          
          const isOnline = userPresence.status === 'online';
          const isAway = userPresence.status === 'away';
          
          
          
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
                  background: userPresence.color,
                  pointerEvents: 'auto',
                  opacity: isOnline ? 0.9 : isAway ? 0.5 : 0.3,
                  position: 'relative',
                  display: 'inline-block',
                  animation: isOnline ? 'cursor-blink 1s infinite' : 'none',
                  transition: 'opacity 0.3s ease'
                }}
              >
                <div className="remote-cursor-tooltip">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div 
                      style={{ 
                        width: 8, 
                        height: 8, 
                        borderRadius: '50%', 
                        background: isOnline ? '#4caf50' : isAway ? '#ff9800' : '#9e9e9e',
                        animation: isOnline ? 'pulse 2s infinite' : 'none'
                      }} 
                    />
                    {userPresence.username}
                  </div>
                  {!isOnline && userPresence.lastSeen && (
                    <div style={{ fontSize: '10px', opacity: 0.7, marginTop: '2px' }}>
                      Last seen: {new Date(userPresence.lastSeen).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  return { RemoteCursorsOverlay, contentEditableRef, presenceState, onlineUsers };
}

// Enhanced collaboration plugin with robust presence management
function CollaborationPlugin({ 
  documentId, 
  userId, 
  wsUrl,
  initialCrdtState,
  onSave,
  setRemoteCursors,
  user,
  setConnectionStatus,
}: { 
  documentId: number;
  userId: number;
  wsUrl: string;
  initialCrdtState: any;
  onSave: (content: any) => Promise<void>;
  setRemoteCursors: React.Dispatch<React.SetStateAction<{ [userId: number]: any }>>;
  user: any;
  setConnectionStatus: React.Dispatch<React.SetStateAction<'connecting' | 'connected' | 'disconnected' | 'reconnecting'>>;
}) {
  const [editor] = useLexicalComposerContext();
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const heartbeatIntervalRef = useRef<NodeJS.Timeout>();
  const isConnectingRef = useRef(false);
  const isClosingRef = useRef(false);
  const initialSyncDoneRef = useRef(false);
  const lastTextRef = useRef<string>('');
  const lastSelectionRef = useRef<any>(null);
  const suppressLocalChangeRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const sessionIdRef = useRef<string>(Math.random().toString(36).substr(2, 9));
  const lastActivityRef = useRef<number>(Date.now());
  const colors = [
    '#e57373', '#64b5f6', '#81c784', '#ffd54f', '#ba68c8', '#4dd0e1', '#ff8a65', '#a1887f', '#90a4ae', '#f06292'
  ];
  
  function getColor(uid: number) {
    return colors[uid % colors.length];
  }

  // Enhanced WebSocket connection with heartbeat and reconnection
  const connectWebSocket = useCallback(() => {
    if (isConnectingRef.current || ws) return;
    isConnectingRef.current = true;
    setConnectionStatus('connecting');
    
    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('No authentication token found');
      isConnectingRef.current = false;
      setConnectionStatus('disconnected');
      return;
    }
    
    const wsUrlWithToken = `${wsUrl}?token=${token}`;
    const socket = new WebSocket(wsUrlWithToken);
    
    socket.onopen = () => {
      setConnected(true);
      setError(null);
      isConnectingRef.current = false;
      setConnectionStatus('connected');
      
      
      // Send initial presence data
      socket.send(JSON.stringify({
        type: 'presence_join',
        user_id: userId,
        document_id: documentId,
        data: {
          username: user?.username || `User ${userId}`,
          connectionId: sessionIdRef.current,
          timestamp: Date.now(),
          color: getColor(userId)
        }
      }));
      
      // Start heartbeat
      heartbeatIntervalRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'heartbeat',
            user_id: userId,
            document_id: documentId,
            timestamp: Date.now()
          }));
        }
      }, 30000); // Send heartbeat every 30 seconds
    };
    
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Update last activity
        lastActivityRef.current = Date.now();
        
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
        } else if (data.type === 'presence_join') {
          // Handle user joining
          
          setRemoteCursors((prev) => ({
            ...prev,
            [data.user_id]: {
              anchor: 0,
              focus: 0,
              username: data.data.username || `User ${data.user_id}`,
              connectionId: data.data.connectionId,
              lastUpdated: Date.now(),
              color: data.data.color
            }
          }));
        } else if (data.type === 'presence_leave') {
          // Handle user leaving
          
          setRemoteCursors((prev) => {
            const newState = { ...prev };
            delete newState[data.user_id];
            return newState;
          });
        } else if (data.type === 'presence_update') {
          // Handle presence updates
          
          setRemoteCursors((prev) => ({
            ...prev,
            [data.user_id]: {
              ...prev[data.user_id],
              ...data.data,
              lastUpdated: Date.now()
            }
          }));
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    };
    
    socket.onclose = (event) => {
      setConnected(false);
      isConnectingRef.current = false;
      setWs(null);
      setConnectionStatus('disconnected');
      
      
      // Clear heartbeat
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      
      if (event.code !== 1000 && event.code !== 1001) {
        setError('Connection closed unexpectedly');
        setConnectionStatus('reconnecting');
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => { 
          connectWebSocket(); 
        }, 5000);
      }
    };
    
    socket.onerror = (error) => {
      setError('Connection error');
      isConnectingRef.current = false;
      setConnectionStatus('disconnected');
      console.error('WebSocket error:', error);
    };
    
    setWs(socket);
  }, [ws, wsUrl, userId, documentId, editor, user, setRemoteCursors, setConnectionStatus]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (ws) ws.close(1000, 'Component unmounting');
    };
  }, [connectWebSocket]);

  // Enhanced content update detection with better debouncing
  useEffect(() => {
    if (!ws || !connected) return;
    
    const removeUpdateListener = editor.registerUpdateListener(({ editorState }) => {
      if (suppressLocalChangeRef.current) return;
      
      editorState.read(() => {
        const root = $getRoot();
        const newText = root.getTextContent();
        const oldText = lastTextRef.current;
        
        if (newText !== oldText) {
          
          
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
            
            
            // Debounced save to database
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = setTimeout(async () => {
              try {
                await onSave(updateContent);
                
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

  // Enhanced cursor position sending with better accuracy
  useEffect(() => {
    if (!ws || !connected) return;
    
    const sendCursor = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      
      const range = selection.getRangeAt(0);
      const editorElement = editor.getRootElement();
      if (!editorElement) return;
      
      // Calculate the offset within the content editable
      let offset = 0;
      const walker = document.createTreeWalker(editorElement, NodeFilter.SHOW_TEXT, null);
      
      while (walker.nextNode()) {
        const textNode = walker.currentNode as Text;
        if (textNode === range.startContainer) {
          offset += range.startOffset;
          break;
        } else {
          offset += textNode.textContent?.length || 0;
        }
      }
      
      // Enhanced cursor data with more context
      const cursorData = {
        anchor: offset,
        focus: offset,
        timestamp: Date.now(),
        username: user?.username || `User ${userId}`,
        connectionId: sessionIdRef.current,
        color: getColor(userId),
        sessionId: sessionIdRef.current
      };
      
      
      ws.send(
        JSON.stringify({
          type: 'cursor',
          user_id: userId,
          document_id: documentId,
          data: cursorData,
        })
      );
    };
    
    // Enhanced cursor sending with both debounced and immediate options
    let timeoutId: NodeJS.Timeout;
    const debouncedSendCursor = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(sendCursor, 50); // Reduced debounce for more responsive cursors
    };
    
    const immediateSendCursor = () => {
      clearTimeout(timeoutId);
      sendCursor();
    };
    
    // Listen for both selection changes and editor updates
    const handleSelectionChange = () => {
      debouncedSendCursor();
    };
    
    document.addEventListener('selectionchange', handleSelectionChange);
    
    const removeListener = editor.registerUpdateListener(() => {
      debouncedSendCursor();
    });
    
    // Send initial cursor position
    setTimeout(immediateSendCursor, 100);
    
    return () => {
      removeListener();
      document.removeEventListener('selectionchange', handleSelectionChange);
      clearTimeout(timeoutId);
    };
  }, [ws, connected, editor, userId, documentId, user]);

  // Enhanced message handling with better presence management
  useEffect(() => {
    if (!ws) return;
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'cursor' && data.user_id !== userId) {
          
          setRemoteCursors((prev) => {
            const newState = { 
              ...prev, 
              [data.user_id]: {
                ...data.data,
                lastUpdated: Date.now()
              }
            };
            
            return newState;
          });
        }
        
        if (data.type === 'user_joined') {
          
          setRemoteCursors((prev) => ({
            ...prev,
            [data.user_id]: {
              anchor: 0,
              focus: 0,
              username: data.username || `User ${data.user_id}`,
              lastUpdated: Date.now()
            }
          }));
        }
        
        if (data.type === 'user_left') {
          
          setRemoteCursors((prev) => {
            const newState = { ...prev };
            delete newState[data.user_id];
            
            return newState;
          });
        }
        
        if (data.type === 'init' && data.cursors) {
          
          setRemoteCursors(data.cursors);
        }
        
        if (data.type === 'user_disconnected' && data.user_id) {
          
          setRemoteCursors((prev) => {
            const copy = { ...prev };
            delete copy[data.user_id];
            console.log('Updated remote cursors after disconnect:', copy);
            return copy;
          });
        }
        
        if (data.type === 'presence_update') {
          console.log('Presence update:', data);
          // Handle presence updates (online/offline status)
        }
      } catch (e) {
        console.error('Error processing WebSocket message:', e);
      }
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

// Enhanced presence indicator component
function PresenceIndicator({ onlineUsers, connectionStatus }: { 
  onlineUsers: any[], 
  connectionStatus: string 
}) {
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'success';
      case 'connecting':
      case 'reconnecting':
        return 'warning';
      case 'disconnected':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <OnlineIcon />;
      case 'connecting':
      case 'reconnecting':
        return <CircularProgress size={16} />;
      case 'disconnected':
        return <OfflineIcon />;
      default:
        return <OfflineIcon />;
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Chip
        icon={getStatusIcon()}
        label={`${onlineUsers.length} online`}
        color={getStatusColor() as any}
        size="small"
        variant="outlined"
      />
    </Box>
  );
}

// Grammar checking dialog component
function GrammarCheckDialog({ 
  open, 
  onClose, 
  grammarResult, 
  onFixIssue 
}: { 
  open: boolean;
  onClose: () => void;
  grammarResult: GrammarResult | null;
  onFixIssue: (issue: GrammarIssue, replacement: string) => void;
}) {
  if (!grammarResult) return null;

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case 'spelling':
        return <ErrorIcon color="error" />;
      case 'grammar':
        return <ErrorIcon color="warning" />;
      case 'style':
        return <InfoIcon color="info" />;
      default:
        return <InfoIcon />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'spelling':
        return 'error';
      case 'grammar':
        return 'warning';
      case 'style':
        return 'info';
      default:
        return 'default';
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SpellcheckIcon />
          Grammar Check Results
          {grammarResult.summary.total_issues > 0 && (
            <Chip 
              label={grammarResult.summary.total_issues} 
              color="error" 
              size="small" 
            />
          )}
        </Box>
      </DialogTitle>
      <DialogContent>
        {grammarResult.summary.total_issues === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2 }}>
            <CheckCircleIcon color="success" />
            <Typography>No grammar issues found!</Typography>
          </Box>
        ) : (
          <List>
            {grammarResult.issues.map((issue, index) => (
              <React.Fragment key={index}>
                <ListItem>
                  <ListItemIcon>
                    {getCategoryIcon(issue.rule_category)}
                  </ListItemIcon>
                  <ListItemText
                    primary={issue.message}
                    secondary={
                      <Box>
                        <Chip 
                          label={issue.rule_category} 
                          color={getCategoryColor(issue.rule_category) as any}
                          size="small" 
                          sx={{ mr: 1 }}
                        />
                        <Typography variant="body2" color="text.secondary">
                          Confidence: {Math.round(issue.confidence * 100)}%
                        </Typography>
                        {issue.replacements.length > 0 && (
                          <Box sx={{ mt: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                              Suggestions:
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                              {issue.replacements.slice(0, 3).map((replacement, idx) => (
                                <Button
                                  key={idx}
                                  variant="outlined"
                                  size="small"
                                  onClick={() => onFixIssue(issue, replacement)}
                                >
                                  {replacement}
                                </Button>
                              ))}
      </Box>
    </Box>
                        )}
                      </Box>
                    }
                  />
                </ListItem>
                {index < grammarResult.issues.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
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
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'reconnecting'>('disconnected');

  // AI Integration State
  const [aiState, setAIState] = useState<AIState>({
    grammarIssues: [],
    suggestions: [],
    isChecking: false,
    lastCheckedText: '',
    error: null,
    healthStatus: 'unknown'
  });
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(!DISABLE_AI);

  // AI State Management
  const updateAIState = useCallback((updates: Partial<AIState>) => {
    setAIState(prev => ({ ...prev, ...updates }));
  }, []);

  // AI Health Check
  const checkAIHealth = useCallback(async () => {
    try {
      const result = await aiService.checkHealth();
      if (result.success) {
        updateAIState({ healthStatus: 'healthy' });
      } else {
        updateAIState({ healthStatus: 'unhealthy' });
      }
    } catch (error) {
      updateAIState({ healthStatus: 'unhealthy' });
    }
  }, [updateAIState]);

  // Apply AI Suggestion
  const handleApplySuggestion = useCallback((suggestion: AISuggestion, replacement: string) => {
    if (!editor) return;

    editor.update(() => {
      const root = $getRoot();
      let currentOffset = 0;
      let targetNode: any = null;
      let targetOffset = 0;

      // Traverse the tree to find the text node at the suggestion offset
      const traverse = (node: any) => {
        if (targetNode) return;

        if (node.getType() === 'text') {
          const textLength = node.getTextContent().length;
          if (currentOffset <= suggestion.offset && suggestion.offset < currentOffset + textLength) {
            targetNode = node;
            targetOffset = suggestion.offset - currentOffset;
          }
          currentOffset += textLength;
        } else {
          const children = node.getChildren();
          for (const child of children) {
            traverse(child);
          }
        }
      };

      traverse(root);

      if (targetNode) {
        // Replace the text at the suggestion location
        const textContent = targetNode.getTextContent();
        const beforeText = textContent.substring(0, targetOffset);
        const afterText = textContent.substring(targetOffset + suggestion.length);
        const newText = beforeText + replacement + afterText;
        
        targetNode.setTextContent(newText);
        
        // Update AI state to remove the applied suggestion
        setAIState(prev => ({
          ...prev,
          suggestions: prev.suggestions.filter(s => s !== suggestion),
          grammarIssues: prev.grammarIssues.filter(issue => 
            issue.offset !== suggestion.offset || issue.length !== suggestion.length
          )
        }));
      }
    });
  }, [editor]);

  // Dismiss AI Suggestion
  const handleDismissSuggestion = useCallback((suggestion: AISuggestion) => {
    setAIState(prev => ({
      ...prev,
      suggestions: prev.suggestions.filter(s => s !== suggestion),
      grammarIssues: prev.grammarIssues.filter(issue => 
        issue.offset !== suggestion.offset || issue.length !== suggestion.length
      )
    }));
  }, []);

  // Clean up invalid suggestions when text changes
  const cleanupInvalidSuggestions = useCallback(() => {
    if (!editor) return;

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const currentText = root.getTextContent();
      
      setAIState(prev => {
        const validSuggestions = prev.suggestions.filter(suggestion => {
          // Check if the suggested text still exists at the specified offset
          const textAtOffset = currentText.substring(suggestion.offset, suggestion.offset + suggestion.length);
          return textAtOffset === suggestion.text && textAtOffset.length > 0;
        });

        const validGrammarIssues = prev.grammarIssues.filter(issue => {
          const textAtOffset = currentText.substring(issue.offset, issue.offset + issue.length);
          return textAtOffset.length > 0;
        });

        // Only update if we actually removed some suggestions
        if (validSuggestions.length !== prev.suggestions.length || validGrammarIssues.length !== prev.grammarIssues.length) {
          const removedCount = prev.suggestions.length - validSuggestions.length;
          console.log('Cleaned up invalid suggestions:', removedCount);
          
          // Show a brief notification
          if (removedCount > 0) {
            setError(`Cleaned up ${removedCount} invalid suggestion${removedCount > 1 ? 's' : ''}`);
            setTimeout(() => setError(null), 3000);
          }
          
          return {
            ...prev,
            suggestions: validSuggestions,
            grammarIssues: validGrammarIssues
          };
        }
        return prev;
      });
    });
  }, [editor]);

  // Manual AI Check - Triggered by user clicking AI button
  const handleManualAICheck = useCallback(async () => {
    if (!editor || aiState.isChecking) return;

    try {
      setAIState(prev => ({ ...prev, isChecking: true, error: null }));
      
      // Get current text from editor
      let currentText = '';
      editor.getEditorState().read(() => {
        const root = $getRoot();
        currentText = root.getTextContent();
      });

      if (!currentText.trim() || currentText.length < 10) {
        setAIState(prev => ({ 
          ...prev, 
          isChecking: false, 
          error: 'Text must be at least 10 characters long for AI analysis' 
        }));
        return;
      }

      // Get AI suggestions
      const result = await aiService.getSuggestions(currentText);
      
      if (result.success && result.data) {
        const suggestions: AISuggestion[] = [];
        
        // Process grammar issues
        if (result.data.grammar && Array.isArray(result.data.grammar.issues)) {
          result.data.grammar.issues.forEach((issue: any) => {
            try {
              if (issue && typeof issue.offset === 'number' && typeof issue.length === 'number') {
                const issueText = currentText.substring(issue.offset, issue.offset + issue.length);
                if (issueText.length > 0) {
                  suggestions.push({
                    type: (issue.rule_category || '').toLowerCase().includes('spelling') ? 'spelling' : 'grammar',
                    text: issueText,
                    replacements: Array.isArray(issue.replacements) ? issue.replacements : [],
                    confidence: typeof issue.confidence === 'number' ? issue.confidence : 0.8,
                    offset: issue.offset,
                    length: issue.length
                  });
                }
              }
            } catch (issueError) {
              console.warn('Failed to process grammar issue:', issue, issueError);
            }
          });
        }

        // Process style improvements
        if (result.data.style_improvements && Array.isArray(result.data.style_improvements.paraphrases)) {
          result.data.style_improvements.paraphrases.forEach((paraphrase: any) => {
            try {
              if (paraphrase && typeof paraphrase.text === 'string' && paraphrase.text.trim()) {
                suggestions.push({
                  type: 'style',
                  text: currentText.substring(0, Math.min(100, currentText.length)),
                  replacements: [paraphrase.text],
                  confidence: typeof paraphrase.confidence === 'number' ? paraphrase.confidence : 0.7,
                  offset: 0,
                  length: Math.min(100, currentText.length)
                });
              }
            } catch (paraphraseError) {
              console.warn('Failed to process style improvement:', paraphrase, paraphraseError);
            }
          });
        }

        setAIState(prev => ({
          ...prev,
          grammarIssues: result.data.grammar?.issues || [],
          suggestions,
          isChecking: false,
          lastCheckedText: currentText,
          error: null
        }));

        // Show dialog if there are suggestions
        if (suggestions.length > 0) {
          setAiDialogOpen(true);
        }
      } else {
        setAIState(prev => ({
          ...prev,
          isChecking: false,
          error: 'AI service returned invalid response'
        }));
      }
    } catch (error: any) {
      console.error('Manual AI check failed:', error);
      setAIState(prev => ({
        ...prev,
        isChecking: false,
        error: error.message || 'AI check failed'
      }));
    }
  }, [editor, aiState.isChecking]);

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
    checkAIHealth();
  }, [id, checkAIHealth]);

  // Clean up invalid suggestions when text changes significantly
  useEffect(() => {
    if (!editor || aiState.suggestions.length === 0) return;

    // Clean up when text changes significantly
    const removeTextChangeListener = editor.registerUpdateListener(({ editorState }) => {
      const timeoutId = setTimeout(() => {
        cleanupInvalidSuggestions();
      }, 200); // Slightly longer delay to avoid excessive cleanup
      
      return () => clearTimeout(timeoutId);
    });

    return removeTextChangeListener;
  }, [editor, aiState.suggestions.length, cleanupInvalidSuggestions]);

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

  const { RemoteCursorsOverlay, contentEditableRef, presenceState, onlineUsers } = useRemoteCursors(editor, user?.id || 0, remoteCursors);

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
            <PresenceIndicator onlineUsers={onlineUsers} connectionStatus={connectionStatus} />
            
            {/* AI Status Indicator */}
            <Tooltip title={DISABLE_AI ? 'AI disabled' : 'Refresh AI status'}>
              <span>
                <AIStatusIndicator 
                  aiState={aiState} 
                  onRefresh={checkAIHealth}
                />
              </span>
            </Tooltip>
            
            {/* AI Suggestions Button */}
            <Tooltip title={DISABLE_AI ? 'AI disabled' : 'AI Writing Suggestions'}>
              <span>
                <IconButton 
                  color="inherit" 
                  onClick={handleManualAICheck}
                  disabled={aiState.isChecking || DISABLE_AI}
                >
                  <Badge badgeContent={aiState.suggestions.length} color="primary">
                    <AIIcon />
                  </Badge>
                </IconButton>
              </span>
            </Tooltip>
            
            {/* Cleanup Invalid Suggestions Button */}
            {aiState.suggestions.length > 0 && (
              <Tooltip title={DISABLE_AI ? 'AI disabled' : 'Clean up invalid suggestions'}>
                <span>
                  <IconButton 
                    color="inherit" 
                    onClick={cleanupInvalidSuggestions}
                    size="small"
                    disabled={DISABLE_AI}
                  >
                    <ClearIcon />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            
            {/* AI Toggle */}
            <Tooltip title={DISABLE_AI ? 'AI disabled' : `${aiEnabled ? 'Disable' : 'Enable'} AI`}>
              <span>
                <IconButton 
                  color="inherit" 
                  onClick={() => setAiEnabled(!aiEnabled)}
                  disabled={DISABLE_AI}
                >
                  <SettingsIcon />
                </IconButton>
              </span>
            </Tooltip>
            
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
                contentEditable={<ContentEditable className="editor-input" ref={contentEditableRef} spellCheck={false} />}
                placeholder={<div className="editor-placeholder">Start typing...</div>}
                ErrorBoundary={EditorErrorBoundary}
              />
              <HistoryPlugin />
              <AutoFocusPlugin />
              <LinkPlugin />
              <ListPlugin />
              <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
              
              {/* AI Integration Plugin */}
              <AIIntegrationPlugin
                onAIStateChange={updateAIState}
                aiState={aiState}
                enabled={aiEnabled && !DISABLE_AI}
              />
              
              {/* Inline AI Suggestions */}
              <InlineAISuggestions
                suggestions={aiState.suggestions}
                onApplySuggestion={handleApplySuggestion}
                onDismissSuggestion={handleDismissSuggestion}
              />
              
              {document && (
                <CollaborationPlugin
                  documentId={parseInt(id!)}
                  userId={user?.id || 0}
                  wsUrl={`ws://localhost:8000/api/v1/ws/${id}`}
                  initialCrdtState={crdtState}
                  onSave={handleAutoSave}
                  setRemoteCursors={setRemoteCursors}
                  user={user}
                  setConnectionStatus={setConnectionStatus}
                />
              )}
              <RemoteCursorsOverlay />
            </div>
          </LexicalComposer>
        </Paper>
      </Box>
      
      {/* AI Suggestions Dialog */}
      <AISuggestionsDialog
        open={aiDialogOpen}
        onClose={() => setAiDialogOpen(false)}
        suggestions={aiState.suggestions}
        onApplySuggestion={handleApplySuggestion}
        onDismissSuggestion={handleDismissSuggestion}
      />

      {/* Error Snackbar */}
      <Snackbar
        open={!!aiState.error}
        autoHideDuration={6000}
        onClose={() => updateAIState({ error: null })}
      >
        <Alert 
          onClose={() => updateAIState({ error: null })} 
          severity="error" 
          sx={{ width: '100%' }}
        >
          {aiState.error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DocumentEditor;
