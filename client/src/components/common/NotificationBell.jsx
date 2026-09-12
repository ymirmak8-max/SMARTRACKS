import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { getNotifications, markAsRead, markAllAsRead } from '../../api/notifications';
import { getAnnouncements } from '../../api/coordinator';
import useAuth from '../../hooks/useAuth';
import { Bell } from 'lucide-react';
import SkeletonPage from './Skeleton';
import VectorIcon from './VectorIcon';
import { enablePushNotifications, getDeviceAlertStatus } from '../../utils/pushNotifications';

const announcementReadKey = userId => `smartrack:read-announcements:${userId}`;
const getReadAnnouncementIds = userId => {
  try { return new Set(JSON.parse(localStorage.getItem(announcementReadKey(userId)) || '[]')); }
  catch { return new Set(); }
};
const saveReadAnnouncementIds = (userId, ids) => {
  try { localStorage.setItem(announcementReadKey(userId), JSON.stringify([...ids].slice(-200))); }
  catch { /* Notifications still work when private storage is unavailable. */ }
};

const NotificationBell = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    () => ('Notification' in window ? Notification.permission : 'unsupported')
  );
  const [deviceAlertsEnabled, setDeviceAlertsEnabled] = useState(false);
  const [deviceAlertError, setDeviceAlertError] = useState('');
  const panelRef = useRef(null);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Always fetch notifications
      const notifRes = await getNotifications();
      let items = (notifRes.data.notifications || []).map(n => ({ ...n, source: 'notification' }));

      // If student, also fetch announcements and merge
      if (user?.role === 'student') {
        const annRes = await getAnnouncements();
        const readAnnouncementIds = getReadAnnouncementIds(user.id);
        const announcements = (annRes.data.announcements || []).filter(a => !items.some(n =>
          n.type === 'announcement' && n.body === a.body && String(n.title || '').endsWith(a.title)
        )).map(a => ({
          id: `ann-${a.id}`,
          title: `${a.title}`,
          body: a.body,
          type: 'announcement',
          is_read: readAnnouncementIds.has(String(a.id)),
          created_at: a.created_at,
          source: 'announcement',
        }));
        items = [...items, ...announcements];
        // Sort by date
        items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      setNotifications(items);
    } catch (error) { console.error('Failed to load notifications:', error); }
    finally { if (!silent) setLoading(false); }
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!user?.id) return;
    getDeviceAlertStatus().then(status => {
      setNotificationPermission(status.permission);
      setDeviceAlertsEnabled(status.enabled);
    }).catch(() => {});
    fetchAll();
    const poll = () => {
      if (document.visibilityState === 'visible') fetchAll(true);
    };
    const interval = window.setInterval(poll, 30000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchAll(true);
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const channel = supabase?.channel(`notifications:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        setNotifications(prev => [
          { ...payload.new, source: 'notification' },
          ...prev.filter(item => !(item.source === 'announcement'
            && item.body === payload.new.body
            && String(payload.new.title || '').endsWith(item.title))),
        ]);
      })
      .subscribe();

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (channel) supabase.removeChannel(channel);
    };
  }, [user?.id, fetchAll]);

  useEffect(() => {
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target))
        setShowPanel(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleMarkRead = async (n) => {
    if (n.source === 'announcement') {
      const ids = getReadAnnouncementIds(user.id);
      ids.add(String(n.id).replace(/^ann-/, ''));
      saveReadAnnouncementIds(user.id, ids);
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
      return;
    }
    try {
      await markAsRead(n.id);
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
    } catch (error) { console.error('Failed to mark notification as read:', error); }
  };

  const handleMarkAllRead = async () => {
    const ids = getReadAnnouncementIds(user.id);
    notifications.filter(n => n.source === 'announcement').forEach(n =>
      ids.add(String(n.id).replace(/^ann-/, ''))
    );
    saveReadAnnouncementIds(user.id, ids);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    try {
      await markAllAsRead();
    } catch (error) { console.error('Failed to mark notifications as read:', error); }
  };

  const enableDeviceAlerts = async () => {
    setDeviceAlertError('');
    try {
      await enablePushNotifications();
      setNotificationPermission('granted');
      setDeviceAlertsEnabled(true);
    } catch (error) {
      setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported');
      setDeviceAlertError(error.message || 'Unable to enable device alerts.');
    }
  };

  const formatTime = (ts) => {
    const diff = Date.now() - new Date(ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const getTypeColor = (type) => {
    if (type === 'document') return 'var(--primary)';
    if (type === 'announcement') return 'var(--warning)';
    if (type === 'anomaly') return 'var(--danger)';
    return 'var(--text-3)';
  };

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      <button className="notification-bell-btn" onClick={() => setShowPanel(!showPanel)} style={{
  position: 'relative', background: 'transparent',
  border: 'none', cursor: 'pointer', padding: '0.4rem',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-2)',
}} aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Notifications'}>
  <Bell size={22} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: 'var(--danger)', color: '#fff',
            borderRadius: '999px', fontSize: '0.6rem', fontWeight: 700,
            minWidth: '16px', height: '16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
          }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {showPanel && (
        <div className="notification-panel" style={{
          position: 'fixed',
          top: '3.4rem',
          right: '0.75rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          width: 'min(320px, calc(100vw - 1rem))',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          zIndex: 200,
          maxHeight: '420px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '0.875rem 1rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexShrink: 0,
          }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
              {user?.role === 'student' ? 'Notifications & Updates' : 'Notifications'}
              {unreadCount > 0 && (
                <span style={{ color: 'var(--danger)', fontSize: '0.8rem', marginLeft: '0.4rem' }}>
                  ({unreadCount})
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} style={{
                background: 'var(--primary)', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius)', padding: '0.3rem 0.6rem',
                color: 'var(--on-primary)', fontSize: '0.78rem', fontWeight: 500,
              }}>Mark all read</button>
            )}
          </div>

          {!deviceAlertsEnabled && (notificationPermission === 'default' || notificationPermission === 'granted') && (
            <button className="notification-permission" onClick={enableDeviceAlerts}>
              <VectorIcon name="bell" size={15} /> Enable device alerts
            </button>
          )}
          {deviceAlertError && <div className="error-message" role="alert" style={{ margin: '.5rem .75rem' }}>{deviceAlertError}</div>}

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div style={{ padding: '0.75rem' }}>
                <SkeletonPage variant="list" label="Loading notifications" />
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '0.875rem' }}>
                No notifications yet
              </div>
            ) : notifications.map(n => (
              <div key={n.id} className="notification-item" onClick={() => handleMarkRead(n)} style={{
                padding: '0.875rem 1rem',
                borderBottom: '1px solid var(--border)',
                background: n.is_read ? 'transparent' : 'var(--primary-light)',
                cursor: 'pointer',
                display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
              }}>
                {/* Type Icon */}
                <div style={{
                  
                }}>
                  <VectorIcon name={n.type === 'document' ? 'document' : n.type === 'announcement' ? 'megaphone' : n.type === 'anomaly' ? 'alert' : 'bell'} size={17} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: n.is_read ? 500 : 700, fontSize: '0.85rem', marginBottom: '0.2rem', color: getTypeColor(n.type) }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginBottom: '0.25rem', lineHeight: 1.4 }}>
                    {n.body}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
                    {formatTime(n.created_at)}
                  </div>
                </div>
                {!n.is_read && (
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: 'var(--primary)', flexShrink: 0, marginTop: '4px',
                  }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
