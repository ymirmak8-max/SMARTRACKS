import api from './axios';

export const getDeployments = () => api.get('/deployments');
export const getDeploymentOptions = () => api.get('/deployments/options');
export const createDeployment = (data) => api.post('/deployments', data);
export const updateDeployment = (id, data) => api.put(`/deployments/${id}`, data);
export const getCompanies = () => api.get('/deployments/companies');
export const createCompany = (data) => api.post('/deployments/companies', data);
export const updateCompany = (id, data) => api.put(`/deployments/companies/${id}`, data);
export const createCompanyLocation = (companyId, data) => api.post(`/deployments/companies/${companyId}/locations`, data);
export const updateCompanyLocation = (id, data) => api.put(`/deployments/locations/${id}`, data);
export const archiveCompanyLocation = (id) => api.delete(`/deployments/locations/${id}`);
