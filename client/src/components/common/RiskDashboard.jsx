import { useEffect, useState } from 'react';
import { getRiskDashboard } from '../../api/analytics';
import EmptyState from './EmptyState';
import { MetricCard, PageHeader } from './DashboardUI';
import SkeletonPage from './Skeleton';

const RiskDashboard = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    getRiskDashboard().then(response => setData(response.data))
      .catch(requestError => setError(requestError.response?.data?.message || 'Risk dashboard could not be loaded.'));
  }, []);
  if (error) return <div className="card" role="alert">{error}</div>;
  if (!data) return <SkeletonPage variant="dashboard" label="Loading risks" />;
  return (
    <>
      <PageHeader title="Student risk dashboard" subtitle="Students who may need coordinator attention" eyebrow="Intervention" />
      <div className="stat-grid stat-grid-3">
        <MetricCard label="High risk" value={data.summary.high} />
        <MetricCard label="Needs review" value={data.summary.medium} />
        <MetricCard label="On track" value={data.summary.low} />
      </div>
      {!data.students.length ? <div className="card"><EmptyState title="No active students" /></div> :
        data.students.map(student => (
          <div className="card" key={student.id} style={{
            borderLeft: `4px solid ${student.risk === 'high' ? 'var(--danger)' : student.risk === 'medium' ? 'var(--warning)' : 'var(--success)'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <div><strong>{student.first_name} {student.last_name}</strong>
                <div className="section-sub">{student.rendered_hours}h / {student.required_hours}h · {student.progress}%</div></div>
              <span className={`badge ${student.risk === 'high' ? 'badge-danger' : student.risk === 'medium' ? 'badge-warning' : 'badge-success'}`}>
                {student.risk} risk
              </span>
            </div>
            {student.reasons.length > 0 && <ul style={{ margin: '.75rem 0 0 1.25rem' }}>
              {student.reasons.map(reason => <li key={reason}>{reason}</li>)}
            </ul>}
          </div>
        ))}
    </>
  );
};

export default RiskDashboard;
