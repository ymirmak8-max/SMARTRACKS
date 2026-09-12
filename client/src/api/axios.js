import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const isAuthRequest = originalRequest?.url?.startsWith('/auth/');

    if (status === 403 && error.response?.data?.code === 'ADMIN_MFA_REQUIRED') {
      window.dispatchEvent(new Event('smartrack:admin-mfa-required'));
      return Promise.reject(error);
    }

    if (status !== 401 || !originalRequest || originalRequest._retry || isAuthRequest) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;
    try {
      refreshPromise ||= api.post('/auth/refresh').finally(() => {
        refreshPromise = null;
      });
      const response = await refreshPromise;
      const token = response.data.accessToken;
      sessionStorage.setItem('accessToken', token);
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
