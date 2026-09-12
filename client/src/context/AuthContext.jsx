import { createContext, useState, useEffect, useCallback, useRef } from 'react';
import api, { refreshSession, tokenExpiryMs } from '../api/axios';

const SILENT_REFRESH_LEAD_MS = 60 * 1000;

export const AuthContext = createContext(null);

const SESSION_EXPECTED_KEY = 'smartrackSessionExpected';
const PRIVACY_VERSION_KEY = 'smartrackPrivacyVersion';
const PRIVACY_USER_KEY = 'smartrackPrivacyUserId';
const hasExpectedSession = () => localStorage.getItem(SESSION_EXPECTED_KEY) === 'true';
const markSessionExpected = () => localStorage.setItem(SESSION_EXPECTED_KEY, 'true');
const clearSessionExpected = () => localStorage.removeItem(SESSION_EXPECTED_KEY);

const clearPrivacySession = () => {
  sessionStorage.removeItem(PRIVACY_VERSION_KEY);
  sessionStorage.removeItem(PRIVACY_USER_KEY);
};

const hydrateUser = (user) => {
  if (!user) return null;
  const storedForSameUser = sessionStorage.getItem(PRIVACY_USER_KEY) === String(user.id)
    ? sessionStorage.getItem(PRIVACY_VERSION_KEY)
    : null;
  const privacyNoticeVersion = user.privacyNoticeVersion || storedForSameUser || null;
  if (privacyNoticeVersion) {
    sessionStorage.setItem(PRIVACY_VERSION_KEY, privacyNoticeVersion);
    sessionStorage.setItem(PRIVACY_USER_KEY, String(user.id));
  } else {
    clearPrivacySession();
  }
  return { ...user, privacyNoticeVersion };
};

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
      await refreshSession();
      if (revision !== authRevision.current) return;
      const meRes = await api.get('/auth/me');
      if (revision !== authRevision.current) return;
      setUser(hydrateUser(meRes.data.user));
    } catch {
      if (revision !== authRevision.current) return;
      setUser(null);
      sessionStorage.removeItem('accessToken');
      clearPrivacySession();
      clearSessionExpected();
    } finally {
      if (revision === authRevision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) return undefined;
    let timer = 0;
    let cancelled = false;

    const scheduleSilentRefresh = () => {
      if (cancelled) return;
      const expiry = tokenExpiryMs();
      const delay = expiry
        ? Math.max(5000, Math.min(expiry - Date.now() - SILENT_REFRESH_LEAD_MS, 12 * 60 * 1000))
        : 10 * 60 * 1000;
      timer = window.setTimeout(async () => {
        try {
          await refreshSession();
        } catch {
          // The next authenticated request will recover or sign the session out.
        }
        scheduleSilentRefresh();
      }, delay);
    };

    const refreshIfNeeded = () => {
      if (document.visibilityState !== 'visible') return;
      const expiry = tokenExpiryMs();
      if (!expiry || expiry - Date.now() < SILENT_REFRESH_LEAD_MS * 2) {
        refreshSession().catch(() => {});
      }
    };

    scheduleSilentRefresh();
    document.addEventListener('visibilitychange', refreshIfNeeded);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshIfNeeded);
    };
  }, [userId]);

  useEffect(() => {
    const clearExpiredSession = () => {
      sessionStorage.removeItem('accessToken');
      clearPrivacySession();
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
    const nextUser = hydrateUser(res.data.user);
    setUser(nextUser);
    setLoading(false);
    return nextUser;
  };

  const verifyMfa = async (challengeToken, code) => {
    const res = await api.post('/auth/mfa/verify', { challengeToken, code });
    sessionStorage.setItem('accessToken', res.data.accessToken);
    markSessionExpected();
    const nextUser = hydrateUser(res.data.user);
    setUser(nextUser);
    setLoading(false);
    return nextUser;
  };

  const acceptPrivacy = async (version) => {
    const res = await api.post('/auth/privacy/accept', { version });
    sessionStorage.setItem(PRIVACY_VERSION_KEY, version);
    if (res.data?.userId) sessionStorage.setItem(PRIVACY_USER_KEY, String(res.data.userId));
    setUser(current => {
      if (current?.id) sessionStorage.setItem(PRIVACY_USER_KEY, String(current.id));
      return { ...current, privacyNoticeVersion: version, privacyAcceptedAt: res.data.acknowledgedAt };
    });
  };

  const register = async (details) => {
    const res = await api.post('/auth/register', details);
    return res.data;
  };

  const patchUser = (partial) => {
    setUser(current => (current ? hydrateUser({ ...current, ...partial }) : current));
  };

  const logout = async () => {
    authRevision.current += 1;
    try {
      await api.post('/auth/logout');
    } finally {
      sessionStorage.removeItem('accessToken');
      clearPrivacySession();
      clearSessionExpected();
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyMfa, acceptPrivacy, register, logout, patchUser, refreshUser: restoreSession }}>
      {children}
    </AuthContext.Provider>
  );
};
