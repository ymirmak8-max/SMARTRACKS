import { useCallback, useEffect, useState } from 'react';
import { getNotifications, markAsRead, markAllAsRead } from '../../api/notifications';
import { getAnnouncements } from '../../api/coordinator';
import VectorIcon from './VectorIcon';

const readKeyFor = (userId) => `smartrack:read-announcements:${userId}`;

const getReadAnnIds = (userId) => {
  try { return new Set(JSON.parse(localStorage.getItem(readKeyFor(userId)) || '[]')); }
  catch { return new Set(); }
};

export const useUpdates = (userId, includeAnnouncements = true) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [notifRes, annRes] = await Promise.all([
        getNotifications().catch(() => ({ data: { notifications: [] } })),
        includeAnnouncements
          ? getAnnouncements().catch(() => ({ data: { announcements: [] } }))
          : { data: { announcements: [] } },
      ]);
      const readIds = userId ? getReadAnnIds(userId) : new Set();
      const merged = (notifRes.data.notifications || []).map(n => ({
        id: n.id, title: n.title, body: n.body, date: n.created_at,
        read: !!n.is_read, kind: 'notification',
      }));
      (annRes.data.announcements || []).forEach(a => {
        if (merged.some(n => n.body === a.body)) return;
        merged.push({
          id: `ann-${a.id}`, rawId: a.id, title: a.title, body: a.body, date: a.created_at,
          read: readIds.has(String(a.id)), kind: 'announcement',
        });
      });
      merged.sort((a, b) => new Date(b.date) - new Date(a.date));
      setItems(merged.slice(0, 8));
    } catch { /* Feed stays empty when unavailable. */ }
    finally { setLoading(false); }
  }, [includeAnnouncements, userId]);

  useEffect(() => { load(); }, [load]);

  const markOne = useCallback(async (item) => {
    if (!item || item.read) return;
    if (item.kind === 'announcement' && userId) {
      const ids = getReadAnnIds(userId);
      ids.add(String(item.rawId));
      try { localStorage.setItem(readKeyFor(userId), JSON.stringify([...ids].slice(-200))); } catch {}
      setItems(current => current.map(u => u.id === item.id ? { ...u, read: true } : u));
    } else {
      try { await markAsRead(item.id); } catch {}
      setItems(current => current.map(u => u.id === item.id ? { ...u, read: true } : u));
    }
  }, [userId]);

  const markAll = useCallback(async () => {
    try { await markAllAsRead(); } catch {}
    if (userId) {
      try {
        const ids = getReadAnnIds(userId);
        items.forEach(u => { if (u.kind === 'announcement') ids.add(String(u.rawId)); });
        localStorage.setItem(readKeyFor(userId), JSON.stringify([...ids].slice(-200)));
      } catch {}
    }
    setItems(current => current.map(u => ({ ...u, read: true })));
  }, [items, userId]);

  return { items, loading, reload: load, markOne, markAll };
};

const FeedList = ({ items, loading, onOpen }) => {
  if (loading) return <p className="feed-empty">Loading…</p>;
  if (!items.length) return <p className="feed-empty">You&apos;re all caught up.</p>;
  return (
    <div className="feed-list">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          className={`feed-item${item.read ? ' is-read' : ''}`}
          onClick={() => onOpen(item)}
        >
          <i aria-hidden="true" />
          <span>
            <strong>{item.title}</strong>
            {item.body && <small>{item.body}</small>}
          </span>
        </button>
      ))}
    </div>
  );
};

/** Always-visible notification + announcement feed for the Account tab. */
const NotificationFeed = ({ userId, onToast = () => {}, includeAnnouncements = true }) => {
  const { items, loading, markOne, markAll } = useUpdates(userId, includeAnnouncements);
  void onToast;
  const unread = items.filter(item => !item.read).length;
  return (
    <div className="card feed-card">
      <div className="feed-head">
        <span className="icon-label"><VectorIcon name="bell" size={15} /> Notifications</span>
        {unread > 0 && (
          <button type="button" className="feed-markall" onClick={markAll}>
            Mark all read
          </button>
        )}
      </div>
      <FeedList items={items} loading={loading} onOpen={markOne} />
    </div>
  );
};

/** Bell button that expands the feed. Used at the top of the Deploy tab. */
export const UpdatesToggle = ({ userId, label = 'Notifications', includeAnnouncements = true }) => {
  const [open, setOpen] = useState(false);
  const { items, loading, markOne, markAll } = useUpdates(userId, includeAnnouncements);
  const unread = items.filter(item => !item.read).length;
  if (!items.length && !loading) return null;
  return (
    <div className="home-updates dep-updates">
      <button
        type="button"
        className="home-updates-toggle"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <VectorIcon name="bell" size={15} />
        {label}
        {unread > 0 && <b>{unread}</b>}
        <VectorIcon name="chevronRight" size={15} className={open ? 'is-open' : ''} />
      </button>
      {open && (
        <>
          <FeedList items={items} loading={loading} onOpen={markOne} />
          {unread > 0 && (
            <button type="button" className="home-updates-readall" onClick={markAll}>
              Mark all read
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default NotificationFeed;
