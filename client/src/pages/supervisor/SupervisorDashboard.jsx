import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getMyStudents, submitEvaluation } from '../../api/evaluations';
import { scheduleReport } from '../../api/exports';
import useAuth from '../../hooks/useAuth';
import Sidebar from '../../components/common/Sidebar';
import DashboardTopbar from '../../components/common/DashboardTopbar';
import DashboardBottomNav from '../../components/common/DashboardBottomNav';
import { safePercent } from '../../components/common/DashboardUI';
import ReportSchedulerModal from '../../components/common/ReportSchedulerModal';
import ExportHistoryModal from '../../components/common/ExportHistoryModal';
import VectorIcon from '../../components/common/VectorIcon';
import SupervisorLiveMap from '../../components/common/SupervisorLiveMap';
import useDashboardNavigation from '../../hooks/useDashboardNavigation';
import { useTheme } from '../../context/ThemeContext';
import { getStudentActivity } from '../../api/supervisor';
import { getNotifications, markAsRead, markAllAsRead } from '../../api/notifications';
import { getAnnouncements } from '../../api/coordinator';
import WorkspacePane from '../../components/common/WorkspacePane';
import SkeletonPage from '../../components/common/Skeleton';
import { getProfile } from '../../api/profile';
import ProfileAvatar from '../../components/common/ProfileAvatar';
import SecureImage from '../../components/common/SecureImage';
import DocPreview from '../../components/common/DocPreview';
import DocViewerModal from '../../components/common/DocViewerModal';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import SupervisorDailyTasks from '../../components/common/SupervisorDailyTasks';
import SupervisorStudentActivity from '../../components/common/SupervisorStudentActivity';
import PasswordChangeCard from '../../components/common/PasswordChangeCard';

const RUBRIC_CRITERIA = [
  { key: 'attitude', label: 'Work attitude & behavior', description: 'Punctuality, discipline, professionalism' },
  { key: 'technical', label: 'Technical skills', description: 'Application of knowledge and skills' },
  { key: 'communication', label: 'Communication skills', description: 'Oral and written communication' },
  { key: 'teamwork', label: 'Teamwork & collaboration', description: 'Works well with others' },
  { key: 'initiative', label: 'Initiative & creativity', description: 'Takes initiative, suggests improvements' },
  { key: 'quality', label: 'Quality of work', description: 'Accuracy, completeness, and neatness of output' },
];

const INITIAL_SCORES = RUBRIC_CRITERIA.reduce((acc, c) => ({ ...acc, [c.key]: 85 }), {});
const SUPERVISOR_VIEWS = ['students', 'activity', 'tasks', 'map', 'account'];
const clockTime = (value) => (value
  ? new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })
  : '—');
const dayShort = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value || '—';
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
};

const SupervisorDashboard = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useDashboardNavigation('students', SUPERVISOR_VIEWS);
  const activityStudentId = new URLSearchParams(location.search).get('student') || null;
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
  const [studentQuery, setStudentQuery] = useState('');
  const [openStudentId, setOpenStudentId] = useState(null);
  const [activityCache, setActivityCache] = useState({});
  const [activityLoadingId, setActivityLoadingId] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [showUpdates, setShowUpdates] = useState(false);
  const [cardPhoto, setCardPhoto] = useState(null);
  const [listModal, setListModal] = useState(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

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

  const fetchUpdates = useCallback(async () => {
    try {
      const [notifRes, annRes] = await Promise.all([
        getNotifications().catch(() => ({ data: { notifications: [] } })),
        getAnnouncements().catch(() => ({ data: { announcements: [] } })),
      ]);
      const readKey = user ? `smartrack:read-announcements:${user.id}` : null;
      let readIds = new Set();
      try { readIds = new Set(JSON.parse(localStorage.getItem(readKey) || '[]')); } catch {}
      const items = (notifRes.data.notifications || []).map(n => ({
        id: n.id, title: n.title, body: n.body, read: !!n.is_read, kind: 'notification',
      }));
      (annRes.data.announcements || []).forEach(a => {
        items.push({
          id: `ann-${a.id}`, rawId: a.id, title: a.title, body: a.body,
          read: readIds.has(String(a.id)), kind: 'announcement',
        });
      });
      setUpdates(items.slice(0, 5));
    } catch { /* Updates stay hidden when unavailable. */ }
  }, [user?.id]);

  useEffect(() => { fetchUpdates(); }, [fetchUpdates]);

  const openUpdate = async (item) => {
    if (!item || item.read) return;
    if (item.kind === 'announcement' && user) {
      const key = `smartrack:read-announcements:${user.id}`;
      try {
        const ids = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
        ids.add(String(item.rawId));
        localStorage.setItem(key, JSON.stringify([...ids].slice(-200)));
      } catch {}
      setUpdates(current => current.map(u => u.id === item.id ? { ...u, read: true } : u));
    } else {
      try { await markAsRead(item.id); } catch {}
      setUpdates(current => current.map(u => u.id === item.id ? { ...u, read: true } : u));
    }
  };

  const readAllUpdates = async () => {
    try { await markAllAsRead(); } catch {}
    setUpdates(current => current.map(u => ({ ...u, read: true })));
  };

  const ensureActivity = useCallback((student) => {
    if (activityCache[student.id]) return;
    setActivityLoadingId(student.id);
    getStudentActivity(student.id)
      .then(res => setActivityCache(current => ({ ...current, [student.id]: res.data })))
      .catch(() => {})
      .finally(() => setActivityLoadingId(current => (current === student.id ? null : current)));
  }, [activityCache]);

  const toggleStudent = (student) => {
    const isOpen = openStudentId === student.id;
    setOpenStudentId(isOpen ? null : student.id);
    if (!isOpen) ensureActivity(student);
  };

  const openListModal = (student, type) => {
    ensureActivity(student);
    setListModal({ type, student });
  };

  const openActivity = useCallback((studentId) => {
    const params = new URLSearchParams();
    params.set('view', 'activity');
    if (studentId) params.set('student', studentId);
    navigate({ pathname: location.pathname, search: `?${params.toString()}` });
  }, [location.pathname, navigate]);

  const handleLogout = useCallback(async () => {
    setConfirmLogout(false);
    await logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

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
  const supervisorCompany = (profile?.companies?.length
    ? profile.companies.map(company => company.name).join(', ')
    : [...new Set(students.map(student => student.company_name).filter(Boolean))].join(', ')) || '';
  const supervisorCompanyAddress = profile?.company_address || students.find(student => student.company_address)?.company_address || '';
  const pendingEvaluations = students.reduce((total, student) => {
    const periods = new Set((student.evaluations || []).map(evaluation => evaluation.period));
    return total + (periods.has('midterm') ? 0 : 1) + (periods.has('final') ? 0 : 1);
  }, 0);

  const NAV = [
    { key: 'students', icon: <VectorIcon name="briefcase" size={20} />, label: 'Students', badge: pendingEvaluations },
    { key: 'activity', icon: <VectorIcon name="activity" size={20} />, label: 'Activity' },
    { key: 'tasks', icon: <VectorIcon name="clipboard" size={20} />, label: 'Tasks' },
    { key: 'map', icon: <VectorIcon name="map" size={20} />, label: 'Map' },
    { key: 'account', icon: <VectorIcon name="user" size={20} />, label: 'Profile' },
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
          <SupervisorLiveMap onOpenActivity={openActivity} onToast={showToast} />
        ) : activeTab === 'activity' ? (
          <SupervisorStudentActivity
            students={students}
            studentId={activityStudentId}
            onSelectStudent={openActivity}
            onToast={showToast}
          />
        ) : activeTab === 'tasks' ? (
          <SupervisorDailyTasks onToast={showToast} />
        ) : activeTab === 'account' ? (
          <div className="sup-acc">
            <section className="sup-acc-hero" aria-label="Supervisor account">
              <div className="sup-acc-glow" aria-hidden="true" />
              <div className="sup-acc-top">
                <ProfileAvatar initials={initials} onToast={showToast} />
                <div className="sup-acc-copy">
                  <h1>{`${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Supervisor'}</h1>
                  <p>{user?.email}</p>
                  <span className="badge badge-primary">Company Supervisor</span>
                </div>
              </div>
              <ul className="sup-acc-stats" aria-label="Account summary">
                <li><strong>{students.length}</strong><span>Students</span></li>
                <li><strong>{students.reduce((acc, s) => acc + (s.evaluations?.length || 0), 0)}</strong><span>Evaluations</span></li>
              </ul>
            </section>

            <div className="card sup-acc-details">
              {[
                { label: 'Phone', value: profile?.phone || user?.phone || 'Not set' },
                { label: 'Company', value: (profile?.companies?.length
                  ? profile.companies.map(company => company.name).join(', ')
                  : [...new Set(students.map(student => student.company_name).filter(Boolean))].join(', ')) || 'Not assigned' },
                { label: 'Company address', value: profile?.company_address || students.find(student => student.company_address)?.company_address || 'Not set' },
                { label: 'Email', value: user?.email || 'Not set' },
              ].map(item => (
                <div className="sup-acc-row" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>

            <PasswordChangeCard onToast={showToast} />

            <div className="card sup-acc-appear">
              <span>Appearance</span>
              <div className="profile-theme-seg" role="group" aria-label="Appearance">
                <button
                  type="button"
                  className={`profile-theme-btn${theme === 'light' ? ' is-on' : ''}`}
                  aria-pressed={theme === 'light'}
                  onClick={() => theme !== 'light' && toggleTheme()}
                >
                  Light
                </button>
                <button
                  type="button"
                  className={`profile-theme-btn${theme === 'dark' ? ' is-on' : ''}`}
                  aria-pressed={theme === 'dark'}
                  onClick={() => theme !== 'dark' && toggleTheme()}
                >
                  Dark
                </button>
              </div>
            </div>

            <button type="button" className="profile-signout" onClick={() => setConfirmLogout(true)}>
              Sign out
            </button>

          </div>

        ) : (

          <div className="sup-stu">
            <section className="sup-stu-hero" aria-label="My students summary">
              <div className="sup-stu-glow" aria-hidden="true" />
              <div className="sup-stu-hero-top">
                <p className="sup-stu-eyebrow"><VectorIcon name="users" size={12} /> My trainees</p>
                {updates.length > 0 && (
                  <button
                    type="button"
                    className="home-updates-bell sup-stu-bell"
                    aria-expanded={showUpdates}
                    aria-label={`Notifications, ${updates.filter(u => !u.read).length} unread`}
                    onClick={() => setShowUpdates(value => !value)}
                  >
                    <VectorIcon name="bell" size={15} />
                    {updates.filter(u => !u.read).length > 0 && (
                      <b>{updates.filter(u => !u.read).length}</b>
                    )}
                  </button>
                )}
              </div>
              <h1 className="sup-stu-title">My students</h1>
              <p className="sup-stu-sub">
                {students.length === 0
                  ? 'No trainees assigned yet'
                  : `${students.length} assigned · ${pendingEvaluations} evaluation${pendingEvaluations === 1 ? '' : 's'} left`}
              </p>
              {supervisorCompany && (
                <p className="sup-stu-co"><VectorIcon name="building" size={13} /> {supervisorCompany}</p>
              )}
            </section>
            {showUpdates && updates.length > 0 && (
              <div className="modal-overlay" onClick={() => setShowUpdates(false)}>
                <div
                  className="modal-content notif-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Notifications"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="modal-handle" />
                  <div className="notif-modal-head">
                    <strong>Notifications</strong>
                    <button type="button" onClick={() => setShowUpdates(false)} aria-label="Close notifications">
                      <VectorIcon name="x" size={15} />
                    </button>
                  </div>
                  <div className="home-updates-list">
                    {updates.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className={`home-update${item.read ? ' is-read' : ''}`}
                        onClick={() => openUpdate(item)}
                      >
                        <i aria-hidden="true" />
                        <span>
                          <strong>{item.title}</strong>
                          {item.body && <small>{item.body}</small>}
                        </span>
                      </button>
                    ))}
                  </div>
                  {updates.some(u => !u.read) && (
                    <button type="button" className="home-updates-readall" onClick={readAllUpdates}>
                      Mark all read
                    </button>
                  )}
                </div>
              </div>
            )}

            {!loading && students.length > 0 && (
              <label className="sup-stu-search">
                <VectorIcon name="search" size={14} />
                <input
                  type="search"
                  placeholder="Search trainees…"
                  value={studentQuery}
                  onChange={(event) => setStudentQuery(event.target.value)}
                  aria-label="Search trainees"
                />
                {studentQuery && (
                  <button type="button" onClick={() => setStudentQuery('')} aria-label="Clear search">
                    <VectorIcon name="x" size={14} />
                  </button>
                )}
              </label>
            )}

            {loading ? (
              <SkeletonPage variant="list" label="Loading students" />
            ) : students.length === 0 ? (
              <div className="card sup-stu-empty">
                No students assigned yet. They appear here after a coordinator deploys them to your company.
              </div>
            ) : (() => {
              const q = studentQuery.trim().toLowerCase();
              const visible = q
                ? students.filter((s) => `${s.first_name} ${s.last_name} ${s.email || ''} ${s.company_name || ''} ${s.course || ''}`.toLowerCase().includes(q))
                : students;
              if (!visible.length) {
                return (
                  <div className="card sup-stu-empty">
                    No trainees match “{studentQuery}”.
                  </div>
                );
              }
              return visible.map(student => {
                const evals = student.evaluations || [];
                const hasMidterm = evals.some(e => e.period === 'midterm');
                const hasFinal = evals.some(e => e.period === 'final');
                const midterm = evals.find(e => e.period === 'midterm');
                const final = evals.find(e => e.period === 'final');
                const progressPercent = safePercent(student.hours_rendered, student.required_hours).toFixed(1);
                const isOpen = openStudentId === student.id;
                const timedIn = student.today_clock_in && !student.today_clock_out;
                return (
                  <article className={`sup-stu-card${isOpen ? ' is-open' : ''}`} key={student.id}>
                    <button
                      type="button"
                      className="sup-stu-head"
                      onClick={() => toggleStudent(student)}
                      aria-expanded={isOpen}
                      aria-label={`${student.first_name} ${student.last_name}, ${progressPercent} percent complete`}
                    >
                      <span className="sup-stu-ava" aria-hidden="true">
                        {`${student.first_name?.[0] || ''}${student.last_name?.[0] || ''}`.toUpperCase()}
                      </span>
                      <span className="sup-stu-copy">
                        <strong>{student.first_name} {student.last_name}</strong>
                        <small>{student.company_name || 'No company yet'}</small>
                      </span>
                      <span className="sup-stu-pct">{progressPercent}%</span>
                      <VectorIcon name="chevronRight" size={17} className="sup-stu-chev" />
                    </button>
                    {isOpen && (
                      <div className="sup-stu-body">
                        <p className={`sup-stu-status${timedIn ? ' is-in' : ''}`}>
                          <i aria-hidden="true" />
                          {timedIn
                            ? `Timed in at ${clockTime(student.today_clock_in)}`
                            : student.today_clock_out
                              ? `Timed out · ${clockTime(student.today_clock_in)} – ${clockTime(student.today_clock_out)}`
                              : 'Not timed in today'}
                        </p>
                        <div className="sup-stu-bar">
                          <span style={{ width: `${progressPercent}%` }} />
                        </div>
                        <p className="sup-stu-hours">
                          {parseFloat(student.hours_rendered).toFixed(1)}h of {student.required_hours}h
                          {student.course ? ` · ${student.course}` : ''}
                        </p>
                        {student.school && <p className="sup-stu-meta">{student.school}</p>}
                        <p className="sup-stu-meta">{student.email}</p>
                        <div className="sup-stu-quick">
                          <button
                            type="button"
                            className="sup-stu-quick-btn"
                            onClick={() => openListModal(student, 'attendance')}
                          >
                            <VectorIcon name="clock" size={15} />
                            <span>Attendance</span>
                            <VectorIcon name="chevronRight" size={15} />
                          </button>
                          <button
                            type="button"
                            className="sup-stu-quick-btn"
                            onClick={() => openListModal(student, 'documents')}
                          >
                            <VectorIcon name="document" size={15} />
                            <span>Documents</span>
                            <VectorIcon name="chevronRight" size={15} />
                          </button>
                        </div>
                        <div className="sup-eval-grid">
                          <div className={`sup-eval-box${hasMidterm ? ' is-done' : ''}`}>
                            <span>Midterm</span>
                            {hasMidterm ? (
                              <>
                                <strong style={{ color: getGrade(midterm.total_score).color }}>{midterm.total_score}</strong>
                                <small style={{ color: getGrade(midterm.total_score).color }}>{getGrade(midterm.total_score).label}</small>
                                <em>{formatDate(midterm.submitted_at)}</em>
                              </>
                            ) : (
                              <button type="button" className="sup-eval-go" onClick={() => handleOpenEval(student, 'midterm')}>Evaluate</button>
                            )}
                          </div>
                          <div className={`sup-eval-box${hasFinal ? ' is-done' : ''}`}>
                            <span>Final</span>
                            {hasFinal ? (
                              <>
                                <strong style={{ color: getGrade(final.total_score).color }}>{final.total_score}</strong>
                                <small style={{ color: getGrade(final.total_score).color }}>{getGrade(final.total_score).label}</small>
                                <em>{formatDate(final.submitted_at)}</em>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="sup-eval-go is-final"
                                onClick={() => handleOpenEval(student, 'final')}
                                disabled={!hasMidterm}
                              >
                                {hasMidterm ? 'Evaluate' : 'Locked'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </article>
                );
              });
            })()}
          </div>
        )}
        </WorkspacePane>
      </div>

      {/* Bottom Nav */}
      <DashboardBottomNav items={NAV} activeKey={activeTab} onChange={setActiveTab} />

      {/* Attendance / Documents list popup */}
      {listModal && (() => {
        const cached = activityCache[listModal.student.id] || {};
        const isAttendance = listModal.type === 'attendance';
        const records = cached.records || [];
        const docs = cached.documents || [];
        const loadingList = activityLoadingId === listModal.student.id;
        const tone = (status) => status === 'approved' ? 'success' : status === 'pending' ? 'warning' : 'gray';
        return (
          <div className="modal-overlay" onClick={() => setListModal(null)}>
            <div
              className="modal-content sup-list-modal"
              role="dialog"
              aria-modal="true"
              aria-label={isAttendance ? 'Attendance' : 'Documents'}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-handle" />
              <div className="notif-modal-head">
                <strong>
                  {isAttendance ? 'Attendance' : 'Documents'}
                  {' · '}{listModal.student.first_name} {listModal.student.last_name}
                </strong>
                <button type="button" onClick={() => setListModal(null)} aria-label="Close list">
                  <VectorIcon name="x" size={15} />
                </button>
              </div>
              <div className="sup-list-modal-body">
                {loadingList ? (
                  <p className="sup-stu-meta">Loading…</p>
                ) : isAttendance ? (
                  records.length === 0 ? (
                    <p className="sup-stu-meta">No attendance records yet.</p>
                  ) : (
                    <div className="sup-att-list">
                      {records.map(record => {
                        const state = record.clock_in && !record.clock_out
                          ? { label: `In · ${clockTime(record.clock_in)}`, color: 'var(--success)' }
                          : record.anomaly_flag
                            ? { label: 'Flagged', color: 'var(--danger)' }
                            : record.clock_out
                              ? { label: `${clockTime(record.clock_in)} – ${clockTime(record.clock_out)}`, color: 'var(--text-3)' }
                              : { label: 'No record', color: 'var(--text-3)' };
                        return (
                          <div className="sup-att-row" key={record.id || record.date}>
                            <span className="sup-att-dot" style={{ background: state.color }} aria-hidden="true" />
                            <span className="sup-att-copy">
                              <strong>{dayShort(record.date)}</strong>
                              <small>{state.label}</small>
                            </span>
                            {(record.selfie_in_url || record.selfie_out_url) && (
                              <span className="sup-att-thumbs">
                                {record.selfie_in_url && (
                                  <button type="button" onClick={() => setCardPhoto({ url: record.selfie_in_url, name: `Time in · ${listModal.student.first_name} ${listModal.student.last_name} · ${dayShort(record.date)}` })} aria-label={`View time-in photo for ${dayShort(record.date)}`}>
                                    <SecureImage src={record.selfie_in_url} alt="" />
                                  </button>
                                )}
                                {record.selfie_out_url && (
                                  <button type="button" onClick={() => setCardPhoto({ url: record.selfie_out_url, name: `Time out · ${listModal.student.first_name} ${listModal.student.last_name} · ${dayShort(record.date)}` })} aria-label={`View time-out photo for ${dayShort(record.date)}`}>
                                    <SecureImage src={record.selfie_out_url} alt="" />
                                  </button>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : docs.length === 0 ? (
                  <p className="sup-stu-meta">No documents yet.</p>
                ) : (
                  <div className="dep-docs">
                    {docs.map(doc => (
                      <div className="dep-doc" key={doc.id}>
                        {doc.file_url && (
                          <DocPreview
                            url={doc.file_url}
                            name={doc.requirement_name}
                            onOpen={() => setCardPhoto({ url: doc.file_url, name: `${doc.requirement_name} · ${listModal.student.first_name} ${listModal.student.last_name}` })}
                          />
                        )}
                        <span className="dep-doc-name">{doc.requirement_name}</span>
                        <span className="dep-doc-side">
                          <span className={`badge badge-${tone(doc.status)}`}>{doc.status || 'missing'}</span>
                          {doc.file_url && (
                            <button
                              type="button"
                              className="dep-link"
                              onClick={() => setCardPhoto({ url: doc.file_url, name: `${doc.requirement_name} · ${listModal.student.first_name} ${listModal.student.last_name}` })}
                            >
                              View
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Photo viewer on top of list popup */}
      {cardPhoto && (
        <DocViewerModal file={cardPhoto} onClose={() => setCardPhoto(null)} />
      )}
      <ConfirmDialog
        open={confirmLogout}
        title="Sign out?"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign out"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={handleLogout}
      />
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
