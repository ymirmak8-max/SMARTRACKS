import api from './axios';

export const getDeployedStudents = () => api.get('/coordinator/students');
export const getStudentDetail = (studentId) => api.get(`/coordinator/students/${studentId}`);
export const getAnomalyReport = () => api.get('/coordinator/anomalies');
export const getAttendanceReview = () => api.get('/coordinator/attendance-review');
export const reviewAttendanceRecord = (recordId, data) => api.patch(`/coordinator/attendance-review/${recordId}`, data);
export const createAnnouncement = (data) => api.post('/coordinator/announcements', data);
export const getAnnouncements = () => api.get('/coordinator/announcements');
export const logAttendanceImageView = (fileUrl) => {
  const apiPath = fileUrl.replace(/^\/api/, '');
  return api.post(`${apiPath}/access-log`);
};
export const deleteAttendanceImage = (fileUrl) => {
  const apiPath = fileUrl.replace(/^\/api/, '');
  return api.delete(`${apiPath}/attendance-selfie`);
};
