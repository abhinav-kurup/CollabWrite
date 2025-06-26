import axios from 'axios';

const API_URL = 'http://localhost:8000/api/v1';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to add the auth token to requests
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

// Add a response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If the error is 401 and we haven't tried to refresh the token yet
    if (error.response.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        const response = await axios.post(`${API_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token, user_id } = response.data;
        localStorage.setItem('access_token', access_token);
        localStorage.setItem('refresh_token', refresh_token);
        localStorage.setItem('user_id', user_id.toString());

        // Update the original request with the new token
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        // If refresh token fails, clear storage and redirect to login
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_id');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export const authService = {
  login: async (username: string, password: string) => {
    // Create URLSearchParams for form data
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
};

export const documentService = {
  getDocuments: async () => {
    const response = await api.get('/documents');
    return response.data;
  },

  getDocument: async (id: number) => {
    const response = await api.get(`/documents/${id}`);
    return response.data;
  },

  createDocument: async (title: string, isPublic: boolean = false) => {
    const response = await api.post('/documents', {
      title,
      is_public: isPublic,
    });
    return response.data;
  },

  updateDocument: async (id: number, data: { title?: string; content?: any; is_public?: boolean }) => {
    console.log(`Making PUT request to /documents/${id} with data:`, data);
    try {
      const response = await api.put(`/documents/${id}`, data);
      console.log(`Update document response for id ${id}:`, response.data);
      return response.data;
    } catch (error) {
      console.error(`Error updating document ${id}:`, error);
      throw error;
    }
  },

  deleteDocument: async (id: number) => {
    const response = await api.delete(`/documents/${id}`);
    return response.data;
  },

  getCollaborators: async (documentId: number) => {
    const response = await api.get(`/documents/${documentId}/collaborators`);
    return response.data;
  },

  addCollaborator: async (documentId: number, userId: number) => {
    const response = await api.post(`/documents/${documentId}/collaborators/${userId}`);
    return response.data;
  },

  removeCollaborator: async (documentId: number, userId: number) => {
    const response = await api.delete(`/documents/${documentId}/collaborators/${userId}`);
    return response.data;
  },
};

export default api; 