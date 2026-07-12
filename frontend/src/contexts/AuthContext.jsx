import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from '../utils/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bootstrapLocalSession();
  }, []);

  const storeSession = ({ token, user: nextUser }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(nextUser));
    setUser(nextUser);
    setIsAuthenticated(true);
  };

  const createLocalSession = async () => {
    const res = await axios.post('/api/auth/local-session');
    if (res.data.success) {
      storeSession(res.data);
      return res.data.user;
    }
    throw new Error(res.data.message || 'Failed to create local session');
  };

  const checkAuthStatus = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      return createLocalSession();
    }

    try {
      const res = await axios.get('/api/auth/check');
      if (res.data.success && res.data.authenticated) {
        setUser(res.data.user);
        setIsAuthenticated(true);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        return res.data.user;
      }
    } catch (err) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }

    return createLocalSession();
  };

  const bootstrapLocalSession = async () => {
    try {
      await checkAuthStatus();
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await createLocalSession();
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      loading,
      logout,
      checkAuthStatus,
      createLocalSession
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function isCryptoAvailable() {
  return typeof window !== 'undefined' &&
    window.crypto &&
    window.crypto.subtle;
}
