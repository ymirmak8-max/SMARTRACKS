import { createContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/axios';

export const AuthContext = createContext(null);

const SESSION_EXPECTED_KEY = 'smartrackSessionExpected';
const hasExpectedSession = () => localStorage.getItem(SESSION_EXPECTED_KEY) === 'true';
const markSessionExpected = () => localStorage.setItem(SESSION_EXPECTED_KEY, 'true');
const clearSessionExpected = () => localStorage.removeItem(SESSION_EXPECTED_KEY);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const authRevision = useRef(0);

  const restoreSession = useCallback(async () => {
    const revision = authRevision.current;
    const sessionExpected = hasExpectedSession()
      || Boolean(sessionStorage.getItem('accessToken'));
    if (!sessionExpected) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.post('/auth/refresh');
      if (revision !== authRevision.current) return;
      sessionStorage.setItem('accessToken', res.data.accessToken);
      const meRes = await api.get('/auth/me');
      if (revision !== authRevision.current) return;
      setUser(meRes.data.user);
    } catch {
      if (revision !== authRevision.current) return;
      setUser(null);
      sessionStorage.removeItem('accessToken');
      clearSessionExpected();
    } finally {
      if (revision === authRevision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    const clearExpiredSession = () => {
      sessionStorage.removeItem('accessToken');
      clearSessionExpected();
      setUser(null);
    };
    const requireAdminMfa = () => {
      setUser(current => (current?.role === 'admin' ? { ...current, mfaEnabled: false } : current));
    };
    window.addEventListener('smartrack:session-expired', clearExpiredSession);
    window.addEventListener('smartrack:admin-mfa-required', requireAdminMfa);
    return () => {
      window.removeEventListener('smartrack:session-expired', clearExpiredSession);
      window.removeEventListener('smartrack:admin-mfa-required', requireAdminMfa);
    };
  }, []);

  const login = async (email, password) => {
    authRevision.current += 1;
    const res = await api.post('/auth/login', { email, password });
    if (res.data.mfaRequired) {
      sessionStorage.removeItem('accessToken');
      clearSessionExpected();
      setUser(null);
      return res.data;
    }
    sessionStorage.setItem('accessToken', res.data.accessToken);
    markSessionExpected();
    setUser(res.data.user);
    setLoading(false);
    return res.data.user;
  };

  const verifyMfa = async (challengeToken, code) => {
    const res = await api.post('/auth/mfa/verify', { challengeToken, code });
    sessionStorage.setItem('accessToken', res.data.accessToken);
    markSessionExpected();
    setUser(res.data.user);
    setLoading(false);
    return res.data.user;
  };

  const acceptPrivacy = async (version) => {
    const res = await api.post('/auth/privacy/accept', { version });
    setUser(current => ({ ...current, privacyNoticeVersion: version, privacyAcceptedAt: res.data.acknowledgedAt }));
  };

  const register = async (details) => {
    const res = await api.post('/auth/register', details);
    return res.data;
  };

  const logout = async () => {
    authRevision.current += 1;
    try {
      await api.post('/auth/logout');
    } finally {
      sessionStorage.removeItem('accessToken');
      clearSessionExpected();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyMfa, acceptPrivacy, register, logout, refreshUser: restoreSession }}>
      {children}
    </AuthContext.Provider>
  );
};
