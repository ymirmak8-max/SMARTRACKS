import api from './axios';

export const getMyStudents = () => api.get('/evaluations/my-students');
export const submitEvaluation = (data) => api.post('/evaluations/submit', data);
export const getEvaluations = (deploymentId) => api.get(`/evaluations/${deploymentId}`);