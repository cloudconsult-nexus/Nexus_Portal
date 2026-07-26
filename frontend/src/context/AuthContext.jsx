import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError, getToken, setToken } from '../lib/api.js';

const AuthContext = createContext(null);

// The API's `people` rows (and therefore every /auth response) use the DB
// column name `name`. `display_name` is kept as an alias purely so existing
// UI that reads `user.display_name` keeps working without renaming the API.
function normalizeUser(user) {
  if (!user) return null;
  return { ...user, display_name: user.name };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return null;
    }
    try {
      const data = await api.get('/auth/me');
      const normalized = normalizeUser(data.user);
      setUser(normalized);
      return normalized;
    } catch {
      setToken(null);
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email, password, mfaToken) => {
    const data = await api.post('/auth/login', { email, password, mfaToken });
    setToken(data.token);
    setUser(normalizeUser(data.user));
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Best-effort — the token is cleared client-side regardless.
    }
    setToken(null);
    setUser(null);
  }, []);

  const acceptTerms = useCallback(async () => {
    await api.post('/auth/accept-terms');
    await refreshUser();
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, acceptTerms }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { ApiError };
