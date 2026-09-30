import api from './axios';

export const getNotifications = () => api.get('/notifications');
export const markAsRead = (id) => api.patch(`/notifications/${id}/read`);
export const markAllAsRead = () => api.patch('/notifications/read-all');
export const getNotificationPreferences = () => api.get('/notifications/preferences');
export const updateNotificationPreferences = data => api.put('/notifications/preferences', data);
export const getPushConfig = () => api.get('/notifications/push/config');
export const savePushSubscription = subscription => api.post('/notifications/push/subscribe', subscription);
export const deletePushSubscription = endpoint => api.delete('/notifications/push/subscribe', { data: { endpoint } });
