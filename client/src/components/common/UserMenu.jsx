import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { User, LogOut, Sun, Moon, ChevronDown, Mail } from 'lucide-react';
import VectorIcon from './VectorIcon';
import { useTheme } from '../../context/ThemeContext';
import useAuth from '../../hooks/useAuth';

const PANEL_WIDTH = 260;

const UserMenu = ({ onEditProfile, placement = 'chrome', compact = false }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const ref = useRef(null);
  const triggerRef = useRef(null);

  const initials = user
    ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase()
    : '??';

  const roleLabel = {
    student: 'Student',
    coordinator: placement === 'sidebar' ? 'Coordinator' : 'School Coordinator',
    supervisor: placement === 'sidebar' ? 'Supervisor' : 'Company Supervisor',
    admin: placement === 'sidebar' ? 'Administrator' : 'System Administrator',
  }[user?.role] || user?.role;

  const roleIcon = {
    student: 'education', coordinator: 'clipboard', supervisor: 'building', admin: 'settings',
  }[user?.role] || 'user';

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
          <div className="user-menu-panel-avatar" aria-hidden="true">{initials}</div>
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

        <button type="button" className="user-menu-item user-menu-signout" onClick={handleLogout}>
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
        <span className="user-menu-avatar" aria-hidden="true">{initials}</span>
        <span className="user-menu-copy">
          <span className="user-menu-name">{user?.first_name} {user?.last_name}</span>
          {placement === 'sidebar' && <span className="user-menu-role">{roleLabel}</span>}
        </span>
        <ChevronDown className="user-menu-chevron" size={14} aria-hidden="true" />
      </button>
      {panel}
    </div>
  );
};

export default UserMenu;
