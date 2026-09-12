import { useEffect, useState } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import BrandLogo from './BrandLogo';
import UserMenu from './UserMenu';

const SIDEBAR_KEY = 'smartrack:sidebar';

const Sidebar = ({ user, navItems, activeTab, onTabChange, role, onEditProfile }) => {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'; }
    catch { return false; }
  });

  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); }
    catch { /* Private mode can block storage. */ }
    return () => {
      if (document.documentElement.dataset.sidebar) {
        delete document.documentElement.dataset.sidebar;
      }
    };
  }, [collapsed]);

  const navGroups = navItems.reduce((groups, item) => {
    const group = item.group || 'Workspace';
    const existing = groups.find(entry => entry.label === group);
    if (existing) existing.items.push(item);
    else groups.push({ label: group, items: [item] });
    return groups;
  }, []);

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label={`${role || 'Workspace'} navigation`}>
      <div className="sidebar-logo">
        <BrandLogo className="sidebar-logo-icon" size="sm" mark={collapsed} />
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed(current => !current)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        {navGroups.map(group => (
          <div className="sidebar-nav-group" key={group.label}>
            <div className="sidebar-section-label">{group.label}</div>
            {group.items.map(item => (
              <button
                key={item.key}
                type="button"
                className={`sidebar-item ${activeTab === item.key ? 'active' : ''}`}
                onClick={() => onTabChange(item.key)}
                aria-current={activeTab === item.key ? 'page' : undefined}
                title={item.label}
              >
                <span className="sidebar-item-icon" aria-hidden="true">{item.icon}</span>
                <span className="sidebar-item-label">{item.label}</span>
                {item.badge != null && Number(item.badge) > 0 && (
                  <span className="sidebar-item-badge" aria-label={`${item.badge} items`}>{item.badge}</span>
                )}
                {activeTab === item.key && <span className="sidebar-active-dot" aria-hidden="true" />}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <UserMenu placement="sidebar" compact={collapsed} onEditProfile={onEditProfile} />
      </div>
    </aside>
  );
};

export default Sidebar;
