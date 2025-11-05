import React, { useState, useEffect } from 'react';
import {
  Container,
  Box,
  Typography,
  Button,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Switch,
  Menu,
  MenuItem,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  PersonAdd as PersonAddIcon,
  PersonRemove as PersonRemoveIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { documentService } from '../services/api';

interface Collaborator {
  user_id: number;
  username: string;
  email: string;
}

interface Document {
  id: number;
  title: string;
  owner_id: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

const Dashboard: React.FC = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [openNewDoc, setOpenNewDoc] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [openCollaborators, setOpenCollaborators] = useState(false);
  const [collaboratorId, setCollaboratorId] = useState('');
  const [collaboratorError, setCollaboratorError] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const docs = await documentService.getDocuments();
      setDocuments(docs);
    } catch (error) {
      console.error('Error fetching documents:', error);
    }
  };

  const handleCreateDocument = async () => {
    try {
      await documentService.createDocument({ title: newDocTitle, is_public: isPublic });
      setOpenNewDoc(false);
      setNewDocTitle('');
      setIsPublic(false);
      fetchDocuments();
    } catch (error) {
      console.error('Error creating document:', error);
    }
  };

  const handleDeleteDocument = async (id: number) => {
    try {
      await documentService.deleteDocument(id);
      fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, doc: Document) => {
    setAnchorEl(event.currentTarget);
    setSelectedDoc(doc);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const fetchCollaborators = async (documentId: number) => {
    try {
      const response = await documentService.getCollaborators(documentId);
      setCollaborators(response);
    } catch (error) {
      console.error('Error fetching collaborators:', error);
      setCollaboratorError('Failed to fetch collaborators');
    }
  };

  const handleAddCollaborator = async () => {
    if (!selectedDoc || !collaboratorId) {
      return;
    }

    try {
      setCollaboratorError(null);
      const response = await documentService.addCollaborator(selectedDoc.id, parseInt(collaboratorId));
      setCollaborators(response);
      setCollaboratorId('');
    } catch (error: any) {
      console.error('Error adding collaborator:', error);
      setCollaboratorError(error.response?.data?.detail || 'Failed to add collaborator');
    }
  };

  const handleRemoveCollaborator = async (userId: number) => {
    if (!selectedDoc) return;

    try {
      const response = await documentService.removeCollaborator(selectedDoc.id, userId);
      setCollaborators(response);
    } catch (error) {
      console.error('Error removing collaborator:', error);
      setCollaboratorError('Failed to remove collaborator');
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 4 }}>
        <Typography variant="h4" component="h1">
          My Documents
        </Typography>
        <Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpenNewDoc(true)}
            sx={{ mr: 2 }}
          >
            New Document
          </Button>
          <Button variant="outlined" onClick={logout}>
            Logout
          </Button>
        </Box>
      </Box>

      <Paper sx={{ p: 2 }}>
        {documents.length > 0 ? (
          <List>
            {documents.map((doc) => (
              <ListItem
                key={doc.id}
                button
                onClick={() => navigate(`/document/${doc.id}`)}
                sx={{ mb: 1, border: '1px solid #eee', borderRadius: 1 }}
              >
                <ListItemText
                  primary={doc.title}
                  secondary={`Last updated: ${new Date(doc.updated_at).toLocaleString()}`}
                />
                <ListItemSecondaryAction>
                  <IconButton
                    edge="end"
                    aria-label="more"
                    onClick={(e) => handleMenuOpen(e, doc)}
                  >
                    <MoreVertIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        ) : (
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            py: 4,
            textAlign: 'center'
          }}>
            <Typography variant="h6" color="text.secondary" sx={{ mb: 2 }}>
              No documents found
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Create your first document to get started with collaborative editing
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setOpenNewDoc(true)}
            >
              Create Your First Document
            </Button>
          </Box>
        )}
      </Paper>

      {/* New Document Dialog */}
      <Dialog open={openNewDoc} onClose={() => setOpenNewDoc(false)}>
        <DialogTitle>Create New Document</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Document Title"
            fullWidth
            value={newDocTitle}
            onChange={(e) => setNewDocTitle(e.target.value)}
          />
          <FormControlLabel
            control={
              <Switch
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
            }
            label="Public Document"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenNewDoc(false)}>Cancel</Button>
          <Button onClick={handleCreateDocument} variant="contained">
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Collaborators Dialog */}
      <Dialog 
        open={openCollaborators} 
        onClose={() => {
          setOpenCollaborators(false);
          setCollaboratorId('');
          setCollaboratorError(null);
          setCollaborators([]);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Manage Collaborators - {selectedDoc?.title}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2 }}>
            <TextField
              label="User ID"
              value={collaboratorId}
              onChange={(e) => setCollaboratorId(e.target.value)}
              fullWidth
              sx={{ mb: 1 }}
              type="number"
              inputProps={{ min: 1 }}
              autoFocus
            />
            <Button
              variant="contained"
              startIcon={<PersonAddIcon />}
              onClick={handleAddCollaborator}
              fullWidth
              sx={{ mt: 2 }}
            >
              Add Collaborator
            </Button>
            {collaboratorError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {collaboratorError}
              </Alert>
            )}
          </Box>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Current Collaborators:
          </Typography>
          <List>
            {collaborators.length > 0 ? (
              collaborators.map((collaborator) => (
                <ListItem key={collaborator.user_id}>
                  <ListItemText 
                    primary={collaborator.username}
                    secondary={collaborator.email}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      onClick={() => handleRemoveCollaborator(collaborator.user_id)}
                      sx={{ color: 'error.main' }}
                    >
                      <PersonRemoveIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))
            ) : (
              <ListItem>
                <ListItemText primary="No collaborators" />
              </ListItem>
            )}
          </List>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => {
              setOpenCollaborators(false);
              setCollaboratorId('');
              setCollaboratorError(null);
              setCollaborators([]);
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Document Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={() => {
          handleMenuClose();
          if (selectedDoc) {
            navigate(`/document/${selectedDoc.id}`);
          }
        }}>
          <EditIcon sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem onClick={() => {
          handleMenuClose();
          if (selectedDoc) {
            setOpenCollaborators(true);
            fetchCollaborators(selectedDoc.id);
          }
        }}>
          <PersonAddIcon sx={{ mr: 1 }} /> Manage Collaborators
        </MenuItem>
        <MenuItem onClick={() => {
          handleMenuClose();
          if (selectedDoc) {
            handleDeleteDocument(selectedDoc.id);
          }
        }}>
          <DeleteIcon sx={{ mr: 1 }} /> Delete
        </MenuItem>
      </Menu>
    </Container>
  );
};

export default Dashboard; 