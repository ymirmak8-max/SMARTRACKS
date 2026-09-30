import { useEffect, useMemo, useState } from 'react';
import { getRiskDashboard } from '../../api/analytics';
import EmptyState from './EmptyState';
import SkeletonPage from './Skeleton';

const RISK_FILTERS = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'high', label: 'High risk' },
  { key: 'medium', label: 'Watch' },
  { key: 'low', label: 'On track' },
];

const RISK_BADGE = { high: 'badge-danger', medium: 'badge-warning', low: 'badge-success' };
const RISK_LABEL = { high: 'High risk', medium: 'Watch', low: 'On track' };

const RiskDashboard = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('attention');

  useEffect(() => {
    getRiskDashboard().then(response => setData(response.data))
      .catch(requestError => setError(requestError.response?.data?.message || 'Risk dashboard could not be loaded.'));
  }, []);

  const visible = useMemo(() => (data?.students || []).filter(student => (
    filter === 'attention' ? student.risk !== 'low' : student.risk === filter
  )), [data, filter]);

  if (error) return <div className="card" role="alert">{error}</div>;
  if (!data) return <SkeletonPage variant="dashboard" label="Loading risks" />;

  const summary = { high: 0, medium: 0, low: 0, ...data.summary };
  const countFor = key => key === 'attention' ? summary.high + summary.medium : summary[key];

  return (
    <>
      <div className="review-status-chips" role="group" aria-label="Filter by risk">
        {RISK_FILTERS.map(item => (
          <button
            key={item.key}
            type="button"
            className={`review-status-chip is-risk-${item.key}${filter === item.key ? ' is-active' : ''}`}
            aria-pressed={filter === item.key}
            onClick={() => setFilter(item.key)}
          >
            {item.label} <b>{countFor(item.key)}</b>
          </button>
        ))}
      </div>
      {!data.students?.length ? <div className="card"><EmptyState title="No active students" /></div>
        : !visible.length ? <div className="card"><EmptyState title={filter === 'attention' ? 'Everyone is on track' : 'No students here'} /></div>
          : (
            <div className="card risk-list-card">
              <ul className="coordinator-list">
                {visible.map(student => (
                  <li key={student.id} className={`coordinator-list-row risk-row is-${student.risk}`}>
                    <div>
                      <strong>{student.first_name} {student.last_name}</strong>
                      <span className="coordinator-muted">{student.rendered_hours} / {student.required_hours} h · {student.progress}%</span>
                      {student.reasons.length > 0 && (
                        <span className="risk-reasons">
                          {student.reasons.map(reason => <span key={reason} className="risk-reason">{reason}</span>)}
                        </span>
                      )}
                    </div>
                    <span className={`badge ${RISK_BADGE[student.risk] || 'badge-gray'}`}>{RISK_LABEL[student.risk] || student.risk}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
    </>
  );
};

export default RiskDashboard;
