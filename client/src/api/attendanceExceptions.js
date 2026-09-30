import api from './axios';

export const getMyAttendanceExceptions = () => api.get('/attendance-exceptions/mine');
export const submitAttendanceRequest = (data) => api.post('/attendance-exceptions/requests', data);
export const getAttendanceRequests = () => api.get('/attendance-exceptions/requests');
export const reviewAttendanceRequest = (id, data) => api.patch(`/attendance-exceptions/requests/${id}/review`, data);
export const getCalendarExceptions = () => api.get('/attendance-exceptions/calendar');
export const createCalendarException = (data) => api.post('/attendance-exceptions/calendar', data);
