import { useState, useEffect, useCallback } from 'react';
import { getMyStudents, submitEvaluation } from '../../api/evaluations';
import { scheduleReport } from '../../api/exports';
import useAuth from '../../hooks/useAuth';
import Sidebar from '../../components/common/Sidebar';
import DashboardTopbar from '../../components/common/DashboardTopbar';
import DashboardBottomNav from '../../components/common/DashboardBottomNav';
import { AccountIdentityCard, MetricCard, PageHeader, safePercent } from '../../components/common/DashboardUI';
import ReportSchedulerModal from '../../components/common/ReportSchedulerModal';
import ExportHistoryModal from '../../components/common/ExportHistoryModal';
import VectorIcon from '../../components/common/VectorIcon';
import SupervisorLiveMap from '../../components/common/SupervisorLiveMap';
import AttendanceReviewCenter from '../../components/common/AttendanceReviewCenter';
import useDashboardNavigation from '../../hooks/useDashboardNavigation';
import NotificationPreferences from '../../components/common/NotificationPreferences';
import CollapsibleSection from '../../components/common/CollapsibleSection';
import WorkspacePane from '../../components/common/WorkspacePane';
import SkeletonPage from '../../components/common/Skeleton';
import { getProfile } from '../../api/profile';
import ProfileAvatar from '../../components/common/ProfileAvatar';

const RUBRIC_CRITERIA = [
  { key: 'attitude', label: 'Work attitude & behavior', description: 'Punctuality, discipline, professionalism' },
  { key: 'technical', label: 'Technical skills', description: 'Application of knowledge and skills' },
  { key: 'communication', label: 'Communication skills', description: 'Oral and written communication' },
  { key: 'teamwork', label: 'Teamwork & collaboration', description: 'Works well with others' },
  { key: 'initiative', label: 'Initiative & creativity', description: 'Takes initiative, suggests improvements' },
  { key: 'quality', label: 'Quality of work', description: 'Accuracy, completeness, and neatness of output' },
];

const INITIAL_SCORES = RUBRIC_CRITERIA.reduce((acc, c) => ({ ...acc, [c.key]: 85 }), {});
const SUPERVISOR_VIEWS = ['students', 'map', 'attendance', 'account'];
const SupervisorDashboard = () => {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useDashboardNavigation('students', SUPERVISOR_VIEWS);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showEvalModal, setShowEvalModal] = useState(false);
  const [evalPeriod, setEvalPeriod] = useState('midterm');
  const [scores, setScores] = useState(INITIAL_SCORES);
  const [comments, setComments] = useState('');
  const [evalLoading, setEvalLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showExportHistory, setShowExportHistory] = useState(false);
  const [profile, setProfile] = useState(null);

  const showToast = useCallback((msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 6000);
  }, []);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyStudents();
      setStudents(res.data.students);
    } catch { showToast('Failed to load students.', 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  useEffect(() => {
    getProfile().then(res => setProfile(res.data.user)).catch(() => {});
  }, []);

  const handleOpenEval = (student, period) => {
    setSelectedStudent(student);
    setEvalPeriod(period);
    setScores(INITIAL_SCORES);
    setComments('');
    setShowEvalModal(true);
  };

  const handleScoreChange = (key, value) => {
    const num = Math.min(100, Math.max(0, parseInt(value) || 0));
    setScores({ ...scores, [key]: num });
  };

  const handleSubmitEval = async (e) => {
    e.preventDefault();
    setEvalLoading(true);
    try {
      await submitEvaluation({
        deploymentId: selectedStudent.deployment_id,
        period: evalPeriod, scores, comments,
      });
      showToast(`${evalPeriod} evaluation submitted.`);
      setShowEvalModal(false);
      fetchStudents();
    } catch (err) {
      showToast(err.response?.data?.message || 'Failed to submit.', 'error');
    } finally { setEvalLoading(false); }
  };

  const totalScore = parseFloat(
    (Object.values(scores).reduce((a, b) => a + b, 0) / RUBRIC_CRITERIA.length).toFixed(2)
  );

  const getGrade = (score) => {
    if (score >= 95) return { label: 'Excellent', color: 'var(--success)' };
    if (score >= 85) return { label: 'Very good', color: 'var(--primary)' };
    if (score >= 75) return { label: 'Good', color: '#7C3AED' };
    if (score >= 65) return { label: 'Satisfactory', color: 'var(--warning)' };
    return { label: 'Needs improvement', color: 'var(--danger)' };
  };

  const handleScheduleReport = async (options) => {
    try {
      await scheduleReport(options);
      showToast('Report scheduled successfully.');
      setShowScheduleModal(false);
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to schedule report', { cause: error });
    }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  }) : '—';

  const initials = user ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() : 'SV';
  const pendingEvaluations = students.reduce((total, student) => {
    const periods = new Set((student.evaluations || []).map(evaluation => evaluation.period));
    return total + (periods.has('midterm') ? 0 : 1) + (periods.has('final') ? 0 : 1);
  }, 0);

  const NAV = [
    { key: 'students', icon: <VectorIcon name="briefcase" size={20} />, label: 'Students', badge: pendingEvaluations },
    { key: 'map', icon: <VectorIcon name="map" size={20} />, label: 'Map' },
    { key: 'attendance', icon: <VectorIcon name="calendar" size={20} />, label: 'Attendance' },
  ];

  return (
  <div className="workspace-shell">

    {/* Sidebar — desktop only */}
    <Sidebar
      user={user}
      navItems={NAV}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      role="supervisor"
      onEditProfile={() => setActiveTab('account')}
    />

    {/* Topbar */}
    <DashboardTopbar role="supervisor" onEditProfile={() => setActiveTab('account')} />

      {/* Content */}
      <div className="page-content" style={{ paddingBottom: '2rem' }}>
        <WorkspacePane key={activeTab}>
        {activeTab === 'map' ? (
          <SupervisorLiveMap />
        ) : activeTab === 'attendance' ? (
          <AttendanceReviewCenter onToast={showToast} />
        ) : activeTab === 'account' ? (
          <div>
            <PageHeader title="Account" subtitle="Update your supervisor profile and notification preferences." breadcrumbs={[{ label: 'Supervisor' }, { label: 'Account' }]} />
            <AccountIdentityCard
              initials={initials}
              photoEditor={<ProfileAvatar initials={initials} onToast={showToast} />}
              name={`${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Supervisor'}
              email={user?.email}
              roleLabel="Company Supervisor"
              details={[
                { label: 'Phone', value: profile?.phone || user?.phone || 'Not set' },
                { label: 'Company', value: (profile?.companies?.length
                  ? profile.companies.map(company => company.name).join(', ')
                  : [...new Set(students.map(student => student.company_name).filter(Boolean))].join(', ')) || 'Not assigned' },
                { label: 'Company address', value: profile?.company_address || students.find(student => student.company_address)?.company_address || 'Not set' },
                { label: 'Email', value: user?.email || 'Not set' },
              ]}
            />

            {/* Stats */}
            <div className="stat-grid stat-grid-2" style={{ marginBottom: '0.875rem' }}>
              {[
                { label: 'Assigned Students', value: students.length, color: 'var(--primary)' },
                { label: 'Evaluations Done', value: students.reduce((acc, s) => acc + (s.evaluations?.length || 0), 0), color: 'var(--success)' },
              ].map(s => (
                <MetricCard key={s.label} label={s.label} value={s.value} />
              ))}
            </div>
            <NotificationPreferences />

          </div>

        ) : (
          
          <>
            <PageHeader
              title="My students"
              subtitle={`${students.length} assigned · ${pendingEvaluations} evaluation${pendingEvaluations === 1 ? '' : 's'} remaining`}
              breadcrumbs={[{ label: 'Supervisor' }, { label: 'Students' }]}
            />


            {loading ? (
              <SkeletonPage variant="list" label="Loading students" />
            ) : students.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', color: 'var(--text-3)', padding: '3rem' }}>
                No students assigned yet. They appear here after a coordinator deploys them to your company.
              </div>
            ) : students.map(student => {
              const evals = student.evaluations || [];
              const hasMidterm = evals.some(e => e.period === 'midterm');
              const hasFinal = evals.some(e => e.period === 'final');
              const midterm = evals.find(e => e.period === 'midterm');
              const final = evals.find(e => e.period === 'final');
              const progressPercent = safePercent(student.hours_rendered, student.required_hours).toFixed(1);

              return (
                <CollapsibleSection
                  key={student.id}
                  title={`${student.first_name} ${student.last_name}`}
                  subtitle={`${student.company_name || 'No company'} · ${progressPercent}%`}
                  count={`${parseFloat(student.hours_rendered || 0).toFixed(0)}h`}
                  defaultOpen={false}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.875rem' }}>
                    <div>
                      <p style={{ color: 'var(--text-3)', margin: '0 0 0.1rem', fontSize: '0.8rem' }}>{student.email}</p>
                      {student.course && (
                        <p style={{ color: 'var(--text-2)', margin: '0 0 0.1rem', fontSize: '0.8rem', fontWeight: 500 }}>
                          {student.course}
                        </p>
                      )}
                      {student.school && (
                        <p style={{ color: 'var(--text-3)', margin: '0 0 0.1rem', fontSize: '0.8rem' }}>
                          {student.school}
                        </p>
                      )}
                      <p style={{ color: 'var(--text)', margin: '0.35rem 0 0', fontSize: '0.8rem', fontWeight: 600 }}>
                        {student.company_name || 'No company assigned'}
                      </p>
                      {student.company_address && (
                        <p style={{ color: 'var(--text-3)', margin: '0.1rem 0 0', fontSize: '0.78rem' }}>
                          {student.company_address}
                        </p>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary)' }}>{progressPercent}%</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                        {parseFloat(student.hours_rendered).toFixed(1)}h / {student.required_hours}h
                      </div>
                    </div>
                  </div>

                  <div className="progress-bar progress-bar-sm" style={{ marginBottom: '1rem' }}>
                    <div className="progress-fill" style={{
                      width: `${progressPercent}%`,
                      background: parseFloat(progressPercent) >= 100 ? 'var(--success)' : 'var(--primary)',
                    }} />
                  </div>

                  <div className="grid-2">
                    {/* Midterm */}
                    <div style={{
                      border: `1px solid ${hasMidterm ? 'var(--success)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-lg)', padding: '0.875rem',
                      background: hasMidterm ? 'var(--success-light)' : 'var(--bg)',
                    }}>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-2)', marginBottom: '0.5rem' }}>
                        Midterm
                      </div>
                      {hasMidterm ? (
                        <>
                          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: getGrade(midterm.total_score).color, lineHeight: 1 }}>
                            {midterm.total_score}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: getGrade(midterm.total_score).color, fontWeight: 600, marginTop: '0.2rem' }}>
                            {getGrade(midterm.total_score).label}
                          </div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginTop: '0.3rem' }}>
                            {formatDate(midterm.submitted_at)}
                          </div>
                        </>
                      ) : (
                        <button onClick={() => handleOpenEval(student, 'midterm')} style={{
                          width: '100%', padding: '0.5rem', background: 'var(--primary)', color: 'var(--on-primary)',
                          border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
                          fontWeight: 600, fontSize: '0.78rem',
                        }}>Submit evaluation</button>
                      )}
                    </div>

                    {/* Final */}
                    <div style={{
                      border: `1px solid ${hasFinal ? 'var(--success)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-lg)', padding: '0.875rem',
                      background: hasFinal ? 'var(--success-light)' : 'var(--bg)',
                    }}>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-2)', marginBottom: '0.5rem' }}>
                        Final
                      </div>
                      {hasFinal ? (
                        <>
                          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: getGrade(final.total_score).color, lineHeight: 1 }}>
                            {final.total_score}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: getGrade(final.total_score).color, fontWeight: 600, marginTop: '0.2rem' }}>
                            {getGrade(final.total_score).label}
                          </div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginTop: '0.3rem' }}>
                            {formatDate(final.submitted_at)}
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => handleOpenEval(student, 'final')}
                          disabled={!hasMidterm}
                          style={{
                            width: '100%', padding: '0.5rem',
                            background: !hasMidterm ? 'var(--surface-2)' : '#7C3AED',
                            color: !hasMidterm ? 'var(--text-3)' : '#fff',
                            border: 'none', borderRadius: 'var(--radius)',
                            cursor: !hasMidterm ? 'not-allowed' : 'pointer',
                            fontWeight: 600, fontSize: '0.78rem',
                          }}
                        >{!hasMidterm ? 'Locked' : 'Submit'}</button>
                      )}
                    </div>
                  </div>
                </CollapsibleSection>
              );
            })}
          </>
        )}
        </WorkspacePane>
      </div>

      {/* Bottom Nav */}
      <DashboardBottomNav items={NAV} activeKey={activeTab} onChange={setActiveTab} />

      {/* Evaluation Modal */}
      {showEvalModal && selectedStudent && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-handle" />
            <div className="modal-title" style={{ textTransform: 'capitalize' }}>
              {evalPeriod} Evaluation
            </div>
            <p style={{ color: 'var(--text-3)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              {selectedStudent.first_name} {selectedStudent.last_name} — {selectedStudent.company_name}
            </p>

            <form onSubmit={handleSubmitEval}>
              {RUBRIC_CRITERIA.map(criterion => (
                <div key={criterion.key} className="eval-criterion">
                  <div className="eval-criterion-header">
                    <div>
                      <div className="eval-criterion-label">{criterion.label}</div>
                      <div className="eval-criterion-desc">{criterion.description}</div>
                    </div>
                    <input
                      className="eval-score-field"
                      type="number" min="0" max="100" inputMode="numeric"
                      aria-label={`${criterion.label} score`}
                      value={scores[criterion.key]}
                      onChange={e => handleScoreChange(criterion.key, e.target.value)}
                      style={{ accentColor: getGrade(scores[criterion.key]).color }}
                    />
                  </div>
                  <input
                    type="range" min="0" max="100"
                    value={scores[criterion.key]}
                    onChange={e => handleScoreChange(criterion.key, e.target.value)}
                    aria-label={`${criterion.label} slider`}
                    style={{ width: '100%', accentColor: getGrade(scores[criterion.key]).color }}
                  />
                </div>
              ))}

              <div style={{
                background: 'var(--primary-light)', borderRadius: 'var(--radius-lg)',
                padding: '1rem', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: '1.25rem',
              }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Overall score</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>Average of all criteria</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="eval-overall-score">
                    {totalScore}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: getGrade(totalScore).color, fontWeight: 600 }}>
                    {getGrade(totalScore).label}
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Comments (optional)</label>
                <textarea rows={3} value={comments}
                  onChange={e => setComments(e.target.value)}
                  placeholder="What should the student keep doing, and what should they improve?"
                  style={{
                    width: '100%', padding: '0.75rem',
                    border: '1.5px solid var(--border)', borderRadius: 'var(--radius)',
                    fontSize: '0.9rem', resize: 'vertical',
                    background: 'var(--surface)', color: 'var(--text)',
                  }}
                />
              </div>

              <div className="modal-actions grid-2">
                <button type="button" onClick={() => setShowEvalModal(false)}
                  className="action-btn action-btn-gray" style={{ padding: '0.875rem' }}>
                  Cancel
                </button>
                <button type="submit" disabled={evalLoading} className="btn-primary" style={{ margin: 0 }}>
                  {evalLoading ? 'Submitting...' : <span className="icon-label"><VectorIcon name="check" size={16} /> Submit</span>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Evaluation Export Modals */}
      <ReportSchedulerModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSchedule={handleScheduleReport}
        reportType="evaluation"
        reportTypeLabel="Evaluation Report"
      />

      <ExportHistoryModal
        isOpen={showExportHistory}
        onClose={() => setShowExportHistory(false)}
      />

      {/* Toast */}
      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </div>
  );
};

export default SupervisorDashboard;
