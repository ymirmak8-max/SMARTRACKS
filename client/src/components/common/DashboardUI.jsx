/**
 * Accessible Dashboard UI Components
 * Includes ARIA labels, semantic HTML, and keyboard navigation support
 */

export const PageHeader = ({ title, subtitle, actions, eyebrow, breadcrumbs = [], id = 'main-content', className = '' }) => (
  <header className={`section-header dashboard-page-header ${className}`.trim()} role="banner">
    <div className="dashboard-page-heading">
      {breadcrumbs.length > 0 && (
        <nav className="dashboard-breadcrumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumbs.map((crumb, index) => {
              const isCurrent = index === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label || crumb}-${index}`}>
                  {crumb.onClick && !isCurrent ? (
                    <button type="button" onClick={crumb.onClick}>{crumb.label}</button>
                  ) : (
                    <span aria-current={isCurrent ? 'page' : undefined}>{crumb.label || crumb}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      {eyebrow && (
        <div className="dashboard-eyebrow" role="doc-subtitle">
          {eyebrow}
        </div>
      )}
      <h1 className="section-title" id={id}>
        {title}
      </h1>
      {subtitle && (
        <p className="section-sub" aria-describedby={id}>
          {subtitle}
        </p>
      )}
    </div>
    {actions && (
      <div className="dashboard-page-actions" role="toolbar" aria-label="Page actions">
        {actions}
      </div>
    )}
  </header>
);

export const MetricCard = ({
  label,
  value,
  detail,
  icon = null,
  tone = 'primary',
  ariaLabel = null,
  role = 'region',
  onClick = null,
}) => {
  const interactive = typeof onClick === 'function';
  const handleKeyDown = (event) => {
    if (!interactive) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <article
      className={`stat-card stat-card-${tone}${interactive ? ' stat-card-clickable' : ''}`}
      role={interactive ? 'button' : role}
      aria-label={ariaLabel || (interactive ? `Open ${label}` : label)}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={handleKeyDown}
    >
      <span className="stat-accent" aria-hidden="true" />
      {icon && <span className="stat-icon" aria-hidden="true">{icon}</span>}
      <div className="stat-value">
        {value}
      </div>
      <div className="stat-label">{label}</div>
      {detail && (
        <div className="stat-detail">
          {detail}
        </div>
      )}
    </article>
  );
};

export const StatusBadge = ({
  tone = 'gray',
  children,
  ariaLabel = null,
}) => (
  <span
    className={`badge badge-${tone}`}
    role="status"
    aria-label={ariaLabel || `Status: ${children}`}
  >
    {children}
  </span>
);

export const Panel = ({
  title,
  children,
  className = '',
  ariaLabel = null,
  headingLevel = 2,
  ...props
}) => {
  const HeadingTag = `h${headingLevel}`;

  return (
    <section
      className={`card ${className}`.trim()}
      role="region"
      aria-label={ariaLabel || title}
      {...props}
    >
      {title && (
        <HeadingTag className="card-title" id={`${title.replace(/\s+/g, '-').toLowerCase()}-heading`}>
          {title}
        </HeadingTag>
      )}
      {children}
    </section>
  );
};

/**
 * Loading state component with accessibility
 */
export const LoadingOverlay = ({ isLoading = false, message = 'Loading...' }) => {
  if (!isLoading) return null;

  return (
    <div
      className="loading-overlay"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
};

/**
 * Accessible card with keyboard navigation
 */
export const InteractiveCard = ({
  children,
  onSelect = null,
  isSelected = false,
  ariaLabel = '',
  role = 'button',
  tabIndex = 0,
}) => {
  const handleKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && onSelect) {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      className={`interactive-card ${isSelected ? 'selected' : ''}`}
      role={role}
      aria-label={ariaLabel}
      aria-selected={isSelected}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
};

/**
 * Progress indicator with accessible attributes
 */
export const ProgressBar = ({
  value = 0,
  max = 100,
  label = '',
  showPercentage = true,
  ariaLabel = '',
}) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div className="progress-container" role="region" aria-label={ariaLabel || label}>
      {label && <label className="progress-label">{label}</label>}
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={`${value} of ${max}`}
      >
        <div
          className="progress-fill"
          style={{ width: `${percentage}%` }}
          aria-hidden="true"
        />
      </div>
      {showPercentage && (
        <span className="progress-text" aria-live="polite">
          {percentage.toFixed(1)}%
        </span>
      )}
    </div>
  );
};

/**
 * Alert/notification box with appropriate ARIA roles
 */
export const Alert = ({
  type = 'info', // 'info', 'success', 'warning', 'error'
  children,
  onClose = null,
  role = 'status',
}) => {
  const roleMap = {
    error: 'alert',
    warning: 'alert',
    success: 'status',
    info: 'status',
  };

  return (
    <div
      className={`alert alert-${type}`}
      role={roleMap[type] || role}
      aria-live={roleMap[type] === 'alert' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <div className="alert-content">{children}</div>
      {onClose && (
        <button
          className="alert-close"
          onClick={onClose}
          aria-label="Close notification"
          type="button"
        >
          ×
        </button>
      )}
    </div>
  );
};

/**
 * Table with proper semantic markup and accessibility
 */
export const AccessibleTable = ({
  caption,
  headers,
  rows,
  rowKey = 'id',
  sortable = false,
  onSort = null,
  ariaLabel = '',
}) => {
  return (
    <div className="table-container" role="region" aria-label={ariaLabel || caption}>
      <table className="data-table" role="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead role="rowgroup">
          <tr role="row">
            {headers.map((header, idx) => (
              <th
                key={idx}
                scope="col"
                role="columnheader"
                aria-sort={header.sortDir ? (header.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                {...(sortable && header.sortable && {
                  onClick: () => onSort && onSort(header.key),
                  tabIndex: 0,
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' && onSort) onSort(header.key);
                  },
                })}
              >
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row, rowIdx) => (
            <tr key={row[rowKey] || rowIdx} role="row">
              {headers.map((header, cellIdx) => (
                <td key={cellIdx} role="cell">
                  {row[header.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const AccountIdentityCard = ({ initials, name, email, roleLabel, details = [], photoEditor = null }) => (
  <div className="card account-identity-card" style={{ marginBottom: '0.875rem' }}>
    <div className="account-identity-header">
      {photoEditor || <div className="account-identity-avatar" aria-hidden="true">{initials}</div>}
      <div>
        <div className="account-identity-name">{name}</div>
        <div className="account-identity-email">{email}</div>
        {roleLabel && <span className="badge badge-primary account-identity-role">{roleLabel}</span>}
      </div>
    </div>
    {details.length > 0 && (
      <dl className="account-details-list">
        {details.map(item => (
          <div key={item.label} className="account-details-row">
            <dt>{item.label}</dt>
            <dd>{item.value || 'Not set'}</dd>
          </div>
        ))}
      </dl>
    )}
  </div>
);

export const safePercent = (value, total) => {
  const numericValue = Number(value);
  const numericTotal = Number(total);
  if (!Number.isFinite(numericValue) || !Number.isFinite(numericTotal) || numericTotal <= 0) return 0;
  return Math.min(Math.max((numericValue / numericTotal) * 100, 0), 100);
};
