import axios from 'axios';
import { DISABLE_AI } from '../config';

// Create axios instance with base configuration
const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  timeout: 30000, // 30 seconds timeout for AI requests
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user_id');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth service
export const authService = {
  login: async (username: string, password: string) => {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    
    const response = await api.post('/auth/login', formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data;
  },

  register: async (email: string, username: string, password: string) => {
    const response = await api.post('/auth/register', {
      email,
      username,
      password,
    });
    return response.data;
  },

  getCurrentUser: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },
};

// Document service
export const documentService = {
  getDocuments: async () => {
    const response = await api.get('/documents/');
    return response.data;
  },

  getDocument: async (id: number) => {
    const response = await api.get(`/documents/${id}`);
    return response.data;
  },

  createDocument: async (data: { title: string; is_public?: boolean; content?: any }) => {
    const response = await api.post('/documents/', data);
    return response.data;
  },

  updateDocument: async (id: number, data: { title?: string; content?: any }) => {
    const response = await api.put(`/documents/${id}`, data);
    return response.data;
  },

  deleteDocument: async (id: number) => {
    const response = await api.delete(`/documents/${id}`);
    return response.data;
  },

  // Collaborator management (re-added)
  getCollaborators: async (documentId: number) => {
    const response = await api.get(`/documents/${documentId}/collaborators`);
    return response.data;
  },
  addCollaborator: async (documentId: number, username: string) => {
    const response = await api.post(`/documents/${documentId}/collaborators/${username}`);
    return response.data;
  },
  removeCollaborator: async (documentId: number, userId: number) => {
    const response = await api.delete(`/documents/${documentId}/collaborators/${userId}`);
    return response.data;
  },
};

// AI service with proper error handling and retry logic
export const aiService = {
  // Grammar checking with real-time suggestions
  checkGrammar: async (text: string, language: string = 'en-US') => {
    if (DISABLE_AI) {
      throw new Error('AI features are disabled');
    }
    try {
      const response = await api.post('/ai/grammar', {
        text,
        language,
      });
      return response.data;
    } catch (error: any) {
      console.error('Grammar check failed:', error);
      throw new Error(error.response?.data?.detail || 'Grammar check failed');
    }
  },

  // Paraphrase text for style improvements
  paraphraseText: async (text: string, numAlternatives: number = 3, context?: string) => {
    if (DISABLE_AI) {
      throw new Error('AI features are disabled');
    }
    try {
      const response = await api.post('/ai/paraphrase', {
        text,
        num_alternatives: numAlternatives,
        context,
      });
      return response.data;
    } catch (error: any) {
      console.error('Paraphrase failed:', error);
      throw new Error(error.response?.data?.detail || 'Paraphrasing failed');
    }
  },

  // Summarize text with optional headline
  summarizeText: async (text: string, includeHeadline: boolean = true) => {
    if (DISABLE_AI) {
      throw new Error('AI features are disabled');
    }
    try {
      const response = await api.post('/ai/summarize', {
        text,
        include_headline: includeHeadline,
      });
      return response.data;
    } catch (error: any) {
      console.error('Summarization failed:', error);
      throw new Error(error.response?.data?.detail || 'Summarization failed');
    }
  },

  // Get comprehensive AI suggestions
  getSuggestions: async (text: string, language: string = 'en-US') => {
    if (DISABLE_AI) {
      throw new Error('AI features are disabled');
    }
    try {
      const response = await api.post('/ai/suggest', {
        text,
        language,
      });
      return response.data;
    } catch (error: any) {
      console.error('AI suggestions failed:', error);
      throw new Error(error.response?.data?.detail || 'AI suggestions failed');
    }
  },

  // Check AI service health
  checkHealth: async () => {
    if (DISABLE_AI) {
      return { success: false, data: { status: 'disabled' } } as any;
    }
    try {
      const response = await api.get('/ai/health');
      return response.data;
    } catch (error: any) {
      console.error('AI health check failed:', error);
      throw new Error(error.response?.data?.detail || 'AI service unavailable');
    }
  },

  // Generate headline for text
  generateHeadline: async (text: string) => {
    if (DISABLE_AI) {
      throw new Error('AI features are disabled');
    }
    try {
      const response = await api.post('/ai/summarize', {
        text,
        include_headline: true,
      });
      return response.data;
    } catch (error: any) {
      console.error('Headline generation failed:', error);
      throw new Error(error.response?.data?.detail || 'Headline generation failed');
    }
  },
};

export default api; 