import api from './axios';
export const getMyCompletion = () => api.get('/completions/mine');
export const requestCompletion = () => api.post('/completions/request');
export const getCompletionQueue = () => api.get('/completions/queue');
export const reviewCompletion = (id, data) => api.patch(`/completions/${id}/review`, data);
