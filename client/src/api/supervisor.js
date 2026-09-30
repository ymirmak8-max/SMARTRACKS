import api from './axios';

export const getWorkplaces = () => api.get('/supervisor/workplaces');
export const createWorkplace = (data) => api.post('/supervisor/workplaces', data);
export const updateWorkplace = (id, data) => api.put(`/supervisor/workplaces/${id}`, data);
export const removeWorkplace = (id) => api.delete(`/supervisor/workplaces/${id}`);
export const getStudentActivity = (studentId) => api.get(`/supervisor/students/${studentId}/activity`);
