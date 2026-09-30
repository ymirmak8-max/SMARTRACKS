import api from './axios';

export const getRequirements = () => api.get('/documents/requirements');
export const getMyDocuments = () => api.get('/documents/my-documents');
export const uploadDocument = (data) => api.post('/documents/upload', data);
export const reviewDocument = (docId, data) => api.patch(`/documents/${docId}/review`, data);
export const createRequirement = (data) => api.post('/documents/requirements', data);
export const updateRequirement = (id, data) => api.put(`/documents/requirements/${id}`, data);
export const archiveRequirement = (id) => api.patch(`/documents/requirements/${id}/archive`);
export const getStudentDocuments = (studentId) => api.get(`/documents/student/${studentId}`);
