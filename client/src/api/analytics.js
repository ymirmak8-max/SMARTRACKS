import api from './axios';

export const getStudentAnalytics = (studentId) => api.get(`/analytics/student/${studentId}`, { timeout: 90000 });
export const getOverviewAnalytics = () => api.get('/analytics/overview', { timeout: 90000 });
export const getRiskDashboard = () => api.get('/analytics/risks');
