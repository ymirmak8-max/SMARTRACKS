import { useEffect, useState } from 'react';
import { getNotificationPreferences, updateNotificationPreferences } from '../../api/notifications';
import VectorIcon from './VectorIcon';

const NotificationPreferences = () => {
  const [preferences, setPreferences] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    getNotificationPreferences().then(response => setPreferences(response.data.preferences)).catch(() => {});
  }, []);
  if (!preferences) return null;
  const toggles = [['inApp', 'In-app notifications'], ['email', 'Email notifications'],
    ['attendance', 'Attendance updates'], ['documents', 'Document updates'], ['announcements', 'Announcements']];
  return (
    <div className="card profile-card notif-card">
      <div className="edit-card-head">
        <span className="edit-card-icon" aria-hidden="true"><VectorIcon name="bell" size={17} /></span>
        <div>
          <div className="edit-card-title">Notifications</div>
          <div className="edit-card-sub">Choose what reaches you, and when.</div>
        </div>
      </div>
      {toggles.map(([key, label]) => (
        <label key={key} className="notif-toggle">
          <input type="checkbox" checked={preferences[key]} onChange={event =>
            setPreferences(current => ({ ...current, [key]: event.target.checked }))} />
          <span className="notif-switch" aria-hidden="true" />
          <span>{label}</span>
        </label>
      ))}
      <div className="grid-2">
        <div className="form-group"><label>Quiet hours start</label>
          <input type="time" value={preferences.quietHoursStart || ''} onChange={event =>
            setPreferences(current => ({ ...current, quietHoursStart: event.target.value || null }))} /></div>
        <div className="form-group"><label>Quiet hours end</label>
          <input type="time" value={preferences.quietHoursEnd || ''} onChange={event =>
            setPreferences(current => ({ ...current, quietHoursEnd: event.target.value || null }))} /></div>
      </div>
      <button className="btn-primary" style={{ margin: 0 }} onClick={async () => {
        const response = await updateNotificationPreferences(preferences);
        setPreferences(response.data.preferences); setMessage('Preferences saved.');
      }}>Save preferences</button>
      {message && <p className="notif-saved" role="status">{message}</p>}
    </div>
  );
};

export default NotificationPreferences;
