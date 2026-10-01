import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: 40000,
});

const requestPath = (config) => `${config?.baseURL || ''}${config?.url || ''}`;
const isAuthApiRequest = (config) => /\/auth(\/|\?|$)/.test(config?.url || '') || /\/auth(\/|\?|$)/.test(requestPath(config));
const isPublicAuthRequest = (config) =>
  /\/auth\/(login|register|refresh|forgot-password|reset-password|mfa\/verify)(\?|$)/.test(config?.url || '')
  || /\/auth\/(login|register|refresh|forgot-password|reset-password|mfa\/verify)(\?|$)/.test(requestPath(config));

api.interceptors.request.use((config) => {
  if (isPublicAuthRequest(config)) {
    if (config.headers) delete config.headers.Authorization;
    return config;
  }
  const token = sessionStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise = null;

// Cross-tab lock so two open tabs never rotate the refresh cookie
// at the same instant (the loser would get a 403 and log itself out).
const REFRESH_LOCK_KEY = 'smartrack:refresh-lock';
const acquireRefreshLock = () => {
  try {
    const raw = localStorage.getItem(REFRESH_LOCK_KEY);
    if (raw && Date.now() - JSON.parse(raw).t < 20000) return false;
    localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify({ t: Date.now() }));
    return true;
  } catch {
    return true;
  }
};
const releaseRefreshLock = () => {
  try { localStorage.removeItem(REFRESH_LOCK_KEY); } catch { /* ignore */ }
};

export const tokenExpiryMs = (token = sessionStorage.getItem('accessToken')) => {
  if (!token) return 0;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Number(payload.exp) * 1000;
  } catch {
    return 0;
  }
};

export const refreshSession = async () => {
  if (!acquireRefreshLock()) {
    // Another tab is rotating right now — wait for its fresh cookie,
    // then refresh normally instead of racing it.
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  refreshPromise ||= api.post('/auth/refresh').finally(() => {
    refreshPromise = null;
    releaseRefreshLock();
  });
  const response = await refreshPromise;
  const token = response.data.accessToken;
  sessionStorage.setItem('accessToken', token);
  return token;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const isAuthRequest = isAuthApiRequest(originalRequest);

    if (status !== 401 || !originalRequest || originalRequest._retry || isAuthRequest) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    try {
      const token = await refreshSession();
      originalRequest.headers.Authorization = `Bearer ${token}`;
      return api(originalRequest);
    } catch (refreshError) {
      sessionStorage.removeItem('accessToken');
      window.dispatchEvent(new Event('smartrack:session-expired'));
      return Promise.reject(refreshError);
    }
  }
);

export default api;
