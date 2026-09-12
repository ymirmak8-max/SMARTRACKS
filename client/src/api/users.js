import api from './axios';

export const getUsers = (params) => api.get('/users', { params });
export const createUser = (data) => api.post('/users', data);
export const updateUser = (id, data) => api.put(`/users/${id}`, data);
export const toggleUserStatus = (id) => api.patch(`/users/${id}/status`);
export const deleteUser = (id) => api.delete(`/users/${id}`);
export const bulkUsers = (data) => api.post('/users/bulk', data);
export const importStudents = (data) => api.post('/users/import-students', data);
export const getAuditLogs = (params) => api.get('/audit', { params });
