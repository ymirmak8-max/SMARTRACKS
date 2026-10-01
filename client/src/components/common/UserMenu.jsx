import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { User, LogOut, Sun, Moon, ChevronDown, Mail } from 'lucide-react';
import VectorIcon from './VectorIcon';
import ConfirmDialog from './ConfirmDialog';
import { useTheme } from '../../context/ThemeContext';
import useAuth from '../../hooks/useAuth';
import { UserAvatar } from './ProfileAvatar';
import { formatStudentMeta, getStudentMeta, subscribeStudentMeta } from '../../utils/studentMeta';

const PANEL_WIDTH = 260;

const UserMenu = ({ onEditProfile, placement = 'chrome', compact = false }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [coords, setCoords] = useState(null);
  const [studentMeta, setStudentMeta] = useState(() => getStudentMeta(user?.id));
  const ref = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    setStudentMeta(getStudentMeta(user?.id));
    return subscribeStudentMeta(({ userId, meta }) => {
      if (String(userId) === String(user?.id)) setStudentMeta(meta);
    });
  }, [user?.id]);

  const initials = user
    ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase()
    : '??';

  const roleLabel = {
    student: 'Student',
    coordinator: placement === 'sidebar' ? 'Coordinator' : 'School Coordinator',
    supervisor: placement === 'sidebar' ? 'Supervisor' : 'Company Supervisor',
  }[user?.role] || user?.role;

  const roleIcon = {
    student: 'education', coordinator: 'clipboard', supervisor: 'building',
  }[user?.role] || 'user';

  const profilePicture = user?.profilePicture || user?.profile_picture;

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return undefined;
    }

    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const collapsed = document.documentElement.dataset.sidebar === 'collapsed';
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 24);
      const gap = 10;

      if (placement === 'sidebar' && collapsed) {
        const left = Math.min(rect.right + gap, window.innerWidth - width - 12);
        setCoords({
          top: 'auto',
          left: Math.max(12, left),
          bottom: Math.max(12, window.innerHeight - rect.bottom),
          width,
        });
        return;
      }

      if (placement === 'sidebar') {
        setCoords({
          top: 'auto',
          left: Math.max(12, rect.left),
          bottom: window.innerHeight - rect.top + gap,
          width,
        });
        return;
      }

      setCoords({
        top: rect.bottom + gap,
        left: Math.max(12, rect.right - width),
        bottom: 'auto',
        width,
      });
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, placement, compact]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      if (ref.current?.contains(event.target)) return;
      if (event.target.closest?.('.user-menu-panel')) return;
      setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [compact]);

  const handleLogout = async () => {
    setConfirmLogout(false);
    await logout();
    navigate('/login', { replace: true });
  };

  const handleEditProfile = () => {
    setOpen(false);
    if (onEditProfile) onEditProfile();
  };

  const panel = open && coords && createPortal(
    <div
      className={`user-menu-panel user-menu-panel-${placement} user-menu-panel-portal`}
      role="menu"
      style={{
        top: coords.top,
        left: coords.left,
        bottom: coords.bottom,
        width: coords.width,
      }}
    >
      <div className="user-menu-panel-head">
        <div className="user-menu-panel-identity">
          <UserAvatar
            className="user-menu-panel-avatar"
            src={user?.profilePicture || user?.profile_picture}
            initials={initials}
            size={44}
            previewable
          />
          <div className="user-menu-panel-copy">
            <div className="user-menu-panel-name">{user?.first_name} {user?.last_name}</div>
            <div className="user-menu-panel-email">
              <Mail size={11} /> {user?.email}
            </div>
            <div className="user-menu-panel-role">
              <span className="icon-label"><VectorIcon name={roleIcon} size={12} /> {roleLabel}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="user-menu-panel-body">
        <button type="button" className="user-menu-item" onClick={handleEditProfile}>
          <User size={16} color="var(--primary)" />
          Edit Profile & Settings
        </button>

        <button type="button" className="user-menu-item" onClick={toggleTheme}>
          {theme === 'light' ? <Moon size={16} color="var(--primary)" /> : <Sun size={16} color="var(--warning)" />}
          {theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          <span className={`user-menu-theme-chip is-${theme}`}>{theme === 'light' ? 'Light' : 'Dark'}</span>
        </button>

        <div className="user-menu-divider" />

        <button type="button" className="user-menu-item user-menu-signout" onClick={() => { setOpen(false); setConfirmLogout(true); }}>
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>,
    document.body,
  );

  return (
    <div ref={ref} className={`user-menu user-menu-${placement}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`user-menu-trigger ${open ? 'is-open' : ''} ${compact ? 'is-compact' : ''}`}
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open account menu"
      >
        {placement === 'sidebar' ? (
          <span className="user-menu-sidebar-identity">
            <span className="user-menu-name user-menu-sidebar-name">{user?.first_name} {user?.last_name}</span>
            {formatStudentMeta(studentMeta) && (
              <span className="user-menu-sidebar-meta">{formatStudentMeta(studentMeta)}</span>
            )}
            <span className="user-menu-role">{roleLabel}</span>
          </span>
        ) : profilePicture ? (
          <UserAvatar
            className="user-menu-avatar"
            src={profilePicture}
            initials={initials}
            size={36}
          />
        ) : (
          <span className="user-menu-icon-btn" aria-hidden="true">
            <User size={18} />
          </span>
        )}
        {placement === 'sidebar' && <ChevronDown className="user-menu-chevron" size={14} aria-hidden="true" />}
      </button>
      {panel}
      <ConfirmDialog
        open={confirmLogout}
        title="Sign out?"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign out"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={handleLogout}
      />
    </div>
  );
};

export default UserMenu;
