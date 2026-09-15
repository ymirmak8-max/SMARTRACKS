import api from './axios';

export const getProfile = () => api.get('/profile');
export const updateProfile = (data) => api.put('/profile', data);
export const uploadProfilePicture = (image) => api.put('/profile/picture', { image }, { timeout: 60000 });
export const removeProfilePicture = () => api.delete('/profile/picture');
export const changePassword = (data) => api.put('/profile/change-password', data);