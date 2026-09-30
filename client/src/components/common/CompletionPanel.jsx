import { useCallback, useEffect, useState } from 'react';
import {
  getCompletionQueue, getMyCompletion, requestCompletion, reviewCompletion,
} from '../../api/completions';
import EmptyState from './EmptyState';
import VectorIcon from './VectorIcon';
import { PageHeader } from './DashboardUI';
import SkeletonPage from './Skeleton';

const STATUS_TONES = { requested: 'badge-warning', approved: 'badge-success', completed: 'badge-success', returned: 'badge-danger' };

const CheckChip = ({ ok, children }) => (
  <span className={`completion-check ${ok ? 'is-ok' : 'is-missing'}`}>{ok ? '✓' : '•'} {children}</span>
);

const CompletionPanel = ({ reviewer = false, embedded = false }) => {
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
  if (reviewer) {
    const pending = items.filter(item => item.completion_status === 'requested').length;
    return <div>
      {!embedded && <PageHeader title="Completion reviews" subtitle={`${pending} requested`} />}
      {message && <div className="card completion-message">{message}</div>}
      {loading ? <SkeletonPage variant="list" label="Loading completion" /> : items.length === 0 ? <EmptyState title="No completion records" /> : (
        <div className="card completion-review-card">
          <ul className="coordinator-list">
            {items.map(item => {
              const hoursOk = Number(item.rendered_hours) >= Number(item.required_hours || 0);
              const docsOk = Number(item.approved_documents) >= Number(item.required_documents || 0);
              return <li key={item.id} className="coordinator-list-row completion-review-row">
                <div>
                  <strong>{item.first_name} {item.last_name}</strong>
                  <div className="completion-checks">
                    <CheckChip ok={hoursOk}>{item.rendered_hours}/{item.required_hours} h</CheckChip>
                    <CheckChip ok={docsOk}>Docs {item.approved_documents}/{item.required_documents}</CheckChip>
                    <CheckChip ok={item.has_final_evaluation}>Final eval</CheckChip>
                  </div>
                  {item.completion_remarks && <span className="coordinator-muted">{item.completion_remarks}</span>}
                </div>
                <div className="coordinator-list-actions">
                  <span className={`badge ${STATUS_TONES[item.completion_status] || 'badge-gray'}`}>{String(item.completion_status || '').replace('_', ' ')}</span>
                  {item.completion_status === 'requested' && <>
                    <button type="button" className="action-btn action-btn-success" onClick={() => act(item, 'approved')}>Approve</button>
                    <button type="button" className="action-btn action-btn-danger" onClick={() => act(item, 'returned')}>Return</button>
                  </>}
                </div>
              </li>;
            })}
          </ul>
        </div>
      )}
    </div>;
  }

  return <div className="complete-page">
    {message && <div className="card complete-message" role="status">{message}</div>}
    {loading ? <SkeletonPage variant="list" label="Loading completion" /> : items.length === 0 ? <EmptyState title="No completion records" /> : items.map(item => {
      const hoursHave = Number(item.rendered_hours) || 0;
      const hoursNeed = Number(item.required_hours) || 0;
      const docsHave = Number(item.approved_documents) || 0;
      const docsNeed = Number(item.required_documents) || 0;
      const hoursFrac = hoursNeed > 0 ? Math.min(hoursHave / hoursNeed, 1) : 1;
      const docsFrac = docsNeed > 0 ? Math.min(docsHave / docsNeed, 1) : 1;
      const evalDone = Boolean(item.has_final_evaluation);
      const overall = Math.round(((hoursFrac + docsFrac + (evalDone ? 1 : 0)) / 3) * 100);
      const statusLabel = String(item.completion_status || '').replace('_', ' ');
      const canRequest = !reviewer && item.ready && ['in_progress', 'returned'].includes(item.completion_status);
      const requirements = [
        { icon: 'clock', label: 'Rendered hours', text: `${hoursHave} of ${hoursNeed}h`, frac: hoursFrac, ok: hoursFrac >= 1 },
        { icon: 'document', label: 'Approved documents', text: `${docsHave} of ${docsNeed}`, frac: docsFrac, ok: docsFrac >= 1 },
        { icon: 'success', label: 'Final evaluation', text: evalDone ? 'Complete' : 'Missing', frac: evalDone ? 1 : 0, ok: evalDone },
      ];
      return (
        <div key={item.id}>
          <section className="complete-hero" aria-label="Completion status">
            <div className="complete-hero-bg" aria-hidden="true" />
            <p className="complete-eyebrow"><VectorIcon name="success" size={13} /> OJT clearance</p>
            <div className="complete-hero-main">
              <div>
                <h1 className="complete-title">Completion</h1>
                <p className="complete-sub">
                  {overall >= 100 ? 'All requirements met.' : `${overall}% there — finish the items below.`}
                </p>
              </div>
              <div className="complete-percent">
                <strong>{overall}%</strong>
                <span className={`badge ${STATUS_TONES[item.completion_status] || 'badge-gray'}`}>{statusLabel}</span>
              </div>
            </div>
            <div className="complete-track" role="progressbar" aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100} aria-label="Overall completion">
              <div className="complete-fill" style={{ width: `${overall}%` }} />
            </div>
          </section>

          <ul className="complete-list">
            {requirements.map(req => (
              <li key={req.label} className={`complete-item${req.ok ? ' is-ok' : ''}`}>
                <span className="complete-item-icon" aria-hidden="true"><VectorIcon name={req.icon} size={17} /></span>
                <span className="complete-item-copy">
                  <span className="complete-item-head"><strong>{req.label}</strong><span>{req.text}</span></span>
                  <span className="complete-item-bar" aria-hidden="true">
                    <span className="complete-item-fill" style={{ width: `${Math.round(req.frac * 100)}%` }} />
                  </span>
                </span>
                <VectorIcon name={req.ok ? 'check' : 'clock'} size={16} className={`complete-item-state${req.ok ? ' is-ok' : ''}`} />
              </li>
            ))}
          </ul>

          {item.completion_remarks && (
            <div className="card complete-remarks">
              <div className="card-title">Coordinator remarks</div>
              <p>{item.completion_remarks}</p>
            </div>
          )}

          {canRequest && (
            <button type="button" className="btn-primary complete-request" onClick={() => act(item, 'request')}>
              <span className="icon-label"><VectorIcon name="check" size={16} /> Request completion review</span>
            </button>
          )}
        </div>
      );
    })}
  </div>;
};
export default CompletionPanel;
