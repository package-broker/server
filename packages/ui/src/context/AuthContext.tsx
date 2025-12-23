import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  role: 'admin' | 'viewer';
}

interface AuthContextType {
  adminToken: string | null;
  isAuthenticated: boolean;
  user: User | null;
  isAdmin: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY = 'composer_proxy_admin_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [adminToken, setAdminToken] = useState<string | null>(() => {
    // Initialize from localStorage
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY);
    }
    return null;
  });

  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (adminToken) {
      // Fetch user details
      fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        }
      })
        .then(res => {
          if (res.ok) return res.json();
          throw new Error('Failed to fetch user');
        })
        .then(data => setUser(data.user))
        .catch((err) => {
          console.error('AuthContext: Failed to fetch user', err);
          setAuthError(err.message || 'Unknown auth error');
          // If token is invalid, logout
          logout();
        });
    } else {
      setUser(null);
    }
  }, [adminToken]);

  const login = (token: string) => {
    setAdminToken(token);
    localStorage.setItem(STORAGE_KEY, token);
    setAuthError(null);
  };

  const logout = () => {
    setAdminToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const isAuthenticated = adminToken !== null && adminToken.length > 0;
  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ adminToken, isAuthenticated, user, isAdmin, login, logout, authError } as any}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}




