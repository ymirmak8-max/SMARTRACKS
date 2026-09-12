import VectorIcon from './VectorIcon';

const TYPES = {
  students:      { icon: 'users', title: 'No students yet',         sub: 'Students appear here once deployed.' },
  documents:     { icon: 'document', title: 'No documents yet',        sub: 'Upload your required documents to get started.' },
  dtr:           { icon: 'clock', title: 'No records yet',          sub: 'Time in to start tracking your OJT hours.' },
  anomalies:     { icon: 'success', title: 'No anomalies detected',   sub: 'All time-in records look good!' },
  announcements: { icon: 'megaphone', title: 'No announcements yet',    sub: 'Check back later for updates.' },
  evaluations:   { icon: 'clipboard', title: 'No evaluations yet',      sub: 'Evaluations appear here once submitted.' },
  notifications: { icon: 'bell', title: 'No notifications yet',    sub: "You're all caught up!" },
  deployments:   { icon: 'building', title: 'No deployments yet',      sub: 'Create a deployment to link students to companies.' },
  map:           { icon: 'map', title: 'No students online',      sub: 'Students appear here when GPS is active.' },
  default:       { icon: 'inbox', title: 'Nothing here yet',        sub: 'Content will appear here soon.' },
};

const EmptyState = ({ type = 'default', title, sub, action, actionLabel, actionIcon }) => {
  const c = TYPES[type] || TYPES.default;
  return (
    <div className="empty-state" style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '3rem 1.5rem', textAlign: 'center',
    }}>
      <div style={{
        width: '72px', height: '72px', borderRadius: '50%',
        background: 'var(--primary-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--primary)', marginBottom: '1rem',
      }}><VectorIcon name={c.icon} size={30} /></div>
      <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.35rem' }}>
        {title || c.title}
      </div>
      <div style={{ color: 'var(--text-3)', fontSize: '0.85rem', maxWidth: '220px', lineHeight: 1.6 }}>
        {sub || c.sub}
      </div>
      {action && (
        <button onClick={action} className="btn-primary" style={{
          marginTop: '1.25rem', width: 'auto', padding: '0.75rem 1.5rem',
        }}>
          <span className="icon-label">{actionIcon && <VectorIcon name={actionIcon} size={16} />}{actionLabel || 'Get started'}</span>
        </button>
      )}
    </div>
  );
};

export default EmptyState;
