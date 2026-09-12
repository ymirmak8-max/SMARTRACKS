import { useCallback, useEffect, useState } from 'react';
import {
  getCompletionQueue, getMyCompletion, requestCompletion, reviewCompletion,
} from '../../api/completions';
import EmptyState from './EmptyState';
import { PageHeader } from './DashboardUI';
import SkeletonPage from './Skeleton';

const CompletionPanel = ({ reviewer = false }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = reviewer ? await getCompletionQueue() : await getMyCompletion();
      setItems(reviewer ? response.data.completions : [response.data.completion]);
    } catch (error) { setMessage(error.response?.data?.message || 'Unable to load completion status.'); }
    finally { setLoading(false); }
  }, [reviewer]);
  useEffect(() => { load(); }, [load]);
  const act = async (item, decision) => {
    const remarks = decision === 'returned' ? window.prompt('Reason for returning this request:') : '';
    if (decision === 'returned' && !remarks) return;
    try {
      if (decision === 'request') await requestCompletion();
      else await reviewCompletion(item.id, { decision, remarks });
      setMessage(decision === 'request' ? 'Completion review requested.' : `Completion ${decision}.`);
      await load();
    } catch (error) { setMessage(error.response?.data?.message || 'Unable to update completion.'); }
  };
  return <div>
    <PageHeader eyebrow="OJT clearance" title={reviewer ? 'Completion reviews' : 'Completion status'}
      subtitle={reviewer ? 'Verify all requirements before locking completed OJT records.' : 'Track the requirements needed for final OJT clearance.'} />
    {message && <div className="card" style={{ marginBottom: '0.75rem' }}>{message}</div>}
    {loading ? <SkeletonPage variant="list" label="Loading completion" /> : items.length === 0 ? <EmptyState title="No completion records" /> : items.map(item =>
      <div className="card" key={item.id}>
        {reviewer && <h3>{item.first_name} {item.last_name}</h3>}
        <div className="grid-2">
          <div><strong>Hours</strong><p>{item.rendered_hours}/{item.required_hours}</p></div>
          <div><strong>Documents</strong><p>{item.approved_documents}/{item.required_documents}</p></div>
          <div><strong>Final evaluation</strong><p>{item.has_final_evaluation ? 'Complete' : 'Missing'}</p></div>
          <div><strong>Status</strong><p style={{ textTransform: 'capitalize' }}>{item.completion_status.replace('_', ' ')}</p></div>
        </div>
        {item.completion_remarks && <p><strong>Remarks:</strong> {item.completion_remarks}</p>}
        {!reviewer && item.ready && ['in_progress', 'returned'].includes(item.completion_status) &&
          <button className="action-btn action-btn-primary" onClick={() => act(item, 'request')}>Request completion review</button>}
        {reviewer && item.completion_status === 'requested' && <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="action-btn action-btn-success" onClick={() => act(item, 'approved')}>Approve and lock</button>
          <button className="action-btn action-btn-danger" onClick={() => act(item, 'returned')}>Return</button>
        </div>}
      </div>)}
  </div>;
};
export default CompletionPanel;
