import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

const DashboardBottomNav = ({ items, activeKey, onChange, hidden = false }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  if (hidden) return null;

  const primaryItems = items.length > 5 ? items.slice(0, 4) : items;
  const moreItems = items.length > 5 ? items.slice(4) : [];
  const isMoreActive = moreItems.some(item => item.key === activeKey);

  const selectItem = key => {
    setMoreOpen(false);
    onChange(key);
  };

  return (
    <nav className="bottom-nav" aria-label="Dashboard navigation">
      {primaryItems.map(item => (
        <button
          key={item.key}
          type="button"
          className={`bottom-nav-item ${activeKey === item.key ? 'active' : ''}`}
          onClick={() => selectItem(item.key)}
          aria-current={activeKey === item.key ? 'page' : undefined}
        >
          <span className="bottom-nav-item-icon" aria-hidden="true">
            {item.icon}
            {item.badge != null && Number(item.badge) > 0 && <span className="bottom-nav-item-badge">{item.badge}</span>}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
      {moreItems.length > 0 && (
        <>
          {moreOpen && (
            <div className="bottom-nav-more-menu" role="menu" aria-label="More dashboard pages">
              {moreItems.map(item => (
                <button key={item.key} type="button" role="menuitem" onClick={() => selectItem(item.key)}>
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.badge != null && Number(item.badge) > 0 && <span className="bottom-nav-more-badge">{item.badge}</span>}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className={`bottom-nav-item ${isMoreActive ? 'active' : ''}`}
            onClick={() => setMoreOpen(open => !open)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            <span className="bottom-nav-item-icon" aria-hidden="true"><MoreHorizontal size={22} /></span>
            <span>More</span>
          </button>
        </>
      )}
    </nav>
  );
};

export default DashboardBottomNav;
