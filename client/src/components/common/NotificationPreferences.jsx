import { useEffect, useState } from 'react';
import { getNotificationPreferences, updateNotificationPreferences } from '../../api/notifications';

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
    <div className="card" style={{ marginBottom: '.875rem' }}>
      <div className="card-title">Notification preferences</div>
      {toggles.map(([key, label]) => (
        <label key={key} style={{ display: 'flex', gap: '.6rem', margin: '.65rem 0', alignItems: 'center' }}>
          <input type="checkbox" checked={preferences[key]} onChange={event =>
            setPreferences(current => ({ ...current, [key]: event.target.checked }))} /> {label}
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
      <button className="btn-compact-primary" onClick={async () => {
        const response = await updateNotificationPreferences(preferences);
        setPreferences(response.data.preferences); setMessage('Preferences saved.');
      }}>Save preferences</button>
      {message && <p role="status" style={{ marginTop: '.5rem' }}>{message}</p>}
    </div>
  );
};

export default NotificationPreferences;
