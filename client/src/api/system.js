import api from './axios';

export const getSystemHealth = () => api.get('/system/health');
export const getPrivacySettings = () => api.get('/system/privacy');
export const updatePrivacySettings = data => api.put('/system/privacy', data);
export const runAttendanceImageCleanup = () => api.post('/system/privacy/cleanup');
export const getOperationalEvents = () => api.get('/system/events');
export const getAttendancePolicy = () => api.get('/system/attendance-policy');
export const updateAttendancePolicy = data => api.put('/system/attendance-policy', data);
export const getBackupStatus = () => api.get('/system/backups');
