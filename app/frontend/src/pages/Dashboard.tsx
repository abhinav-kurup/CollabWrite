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
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  PersonAdd as PersonAddIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { documentService } from '../services/api';

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
      await documentService.createDocument(newDocTitle, isPublic);
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
    setSelectedDoc(null);
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
          <EditIcon fontSize="small" sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem onClick={() => {
          handleMenuClose();
          if (selectedDoc) {
            handleDeleteDocument(selectedDoc.id);
          }
        }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
        <MenuItem onClick={() => {
          handleMenuClose();
          if (selectedDoc) {
            // TODO: Implement collaborator management
          }
        }}>
          <PersonAddIcon fontSize="small" sx={{ mr: 1 }} />
          Manage Collaborators
        </MenuItem>
      </Menu>
    </Container>
  );
};

export default Dashboard; 