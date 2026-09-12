import api from './axios';

export const clockIn = (data) => api.post('/dtr/clock-in', data);
export const clockOut = (data) => api.post('/dtr/clock-out', data);
export const getAttendanceChallenge = (action) => api.post('/dtr/challenge', { action });
export const getTodayRecord = () => api.get('/dtr/today');
export const getDTRHistory = () => api.get('/dtr/history');
export const getDeploymentInfo = () => api.get('/dtr/deployment-info');
export const flagPerimeterExit = (data) => api.post('/dtr/flag-exit', data);
export const updateLiveLocation = (data) => api.post('/dtr/update-location', data);
export const getLiveLocations = () => api.get('/dtr/live-locations');
