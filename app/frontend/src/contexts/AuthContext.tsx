import React, { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/api';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

interface User {
  id: number;
  email: string;
  username: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      const token = localStorage.getItem('access_token');
      const userId = localStorage.getItem('user_id');
      if (token && userId) {
        try {
          // You might want to add an endpoint to get the current user's info
          // For now, we'll use the stored user_id
          setUser({ id: parseInt(userId), email: '', username: '' }); // Use stored user_id
        } catch (error) {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user_id');
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const response = await authService.login(username, password);
      const { access_token, refresh_token, user_id } = response;
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', refresh_token);
      localStorage.setItem('user_id', user_id.toString());
      setUser({ id: user_id, email: '', username }); // Use actual user_id from backend
      navigate('/dashboard');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new Error('Invalid username or password');
        } else if (error.response?.data?.detail) {
          throw new Error(error.response.data.detail);
        } else if (error.message) {
          throw new Error(error.message);
        }
      }
      throw new Error('An error occurred during login');
    }
  };

  const register = async (email: string, username: string, password: string) => {
    try {
      const response = await authService.register(email, username, password);
      setUser(response);
      navigate('/login');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.data?.detail) {
          throw new Error(error.response.data.detail);
        } else if (error.message) {
          throw new Error(error.message);
        }
      }
      throw new Error('An error occurred during registration');
    }
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_id');
    setUser(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 