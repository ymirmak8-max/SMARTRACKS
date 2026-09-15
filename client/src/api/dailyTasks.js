import api from './axios';

export const getSupervisorDailyTasks = (date) => api.get('/daily-tasks', { params: date ? { date } : {} });
export const createDailyTask = (data) => api.post('/daily-tasks', data);
export const excuseDailyTask = (id, data) => api.patch(`/daily-tasks/${id}/excuse`, data);
export const getMyDailyTasks = (date) => api.get('/daily-tasks/mine', { params: date ? { date } : {} });
export const updateMyDailyTask = (id, data) => api.patch(`/daily-tasks/${id}`, data);
