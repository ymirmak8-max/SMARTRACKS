import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getDeployedStudents, getStudentDetail,
  getAnomalyReport, createAnnouncement, getAnnouncements, logAttendanceImageView, deleteAttendanceImage,
} from '../../api/coordinator';
import { reviewDocument } from '../../api/documents';
import { exportAnalyticsAsCSV, scheduleReport, downloadCSV } from '../../api/exports';
import useAuth from '../../hooks/useAuth';
import EmptyState from '../../components/common/EmptyState';
import ErrorBoundary from '../../components/common/ErrorBoundary';
import SecureImage from '../../components/common/SecureImage';
import { AccountIdentityCard, PageHeader, safePercent } from '../../components/common/DashboardUI';
import { getProfile } from '../../api/profile';
import ProfileAvatar from '../../components/common/ProfileAvatar';
import ReportSchedulerModal from '../../components/common/ReportSchedulerModal';
import ExportHistoryModal from '../../components/common/ExportHistoryModal';
import DashboardTopbar from '../../components/common/DashboardTopbar';
import DashboardBottomNav from '../../components/common/DashboardBottomNav';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import Sidebar from '../../components/common/Sidebar';
import VectorIcon from '../../components/common/VectorIcon';
import useDashboardNavigation from '../../hooks/useDashboardNavigation';
import useTransientToast from '../../hooks/useTransientToast';
import CollapsibleSection from '../../components/common/CollapsibleSection';
import WorkspacePane from '../../components/common/WorkspacePane';
import SlidingSubnav from '../../components/common/SlidingSubnav';
import SkeletonPage from '../../components/common/Skeleton';
import NotificationPreferences from '../../components/common/NotificationPreferences';
import SecuritySettings from '../../components/common/SecuritySettings';

const AnalyticsPage = lazy(() => import('./AnalyticsPage'));
const AttendanceExceptionsPage = lazy(() => import('../../components/common/AttendanceExceptionsPage'));
const AttendanceReviewCenter = lazy(() => import('../../components/common/AttendanceReviewCenter'));
const CompanySettingsPage = lazy(() => import('./CompanySettingsPage'));
const CompletionPanel = lazy(() => import('../../components/common/CompletionPanel'));
const DeploymentsPage = lazy(() => import('../admin/DeploymentsPage'));
const MapPage = lazy(() => import('./MapPage'));
const RiskDashboard = lazy(() => import('../../components/common/RiskDashboard'));
const DocumentRequirementsManager = lazy(() => import('../../components/common/DocumentRequirementsManager'));
const UserManagementPanel = lazy(() => import('../../components/common/UserManagementPanel'));
const SystemHealthPanel = lazy(() => import('../../components/common/SystemHealthPanel'));

const COORDINATOR_VIEWS = ['deployments', 'map', 'insights', 'reviews', 'analytics', 'risks', 'attendance', 'requests', 'completion',
  'account', 'settings', 'requirements', 'anomalies', 'announcements', 'users', 'health'];

const CoordinatorDashboard = () => {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useDashboardNavigation('deployments', COORDINATOR_VIEWS);
  const [insightView, setInsightView] = useState('analytics');
  const [reviewView, setReviewView] = useState('attendance');
  const [students, setStudents] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentDetail, setStudentDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const { toast, toastType, showToast } = useTransientToast(6000);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState({ title: '', body: '', targetRole: '' });
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewForm, setReviewForm] = useState({ status: 'approved', remarks: '' });
  const [reviewLoading, setReviewLoading] = useState(false);

  // Export & Scheduling
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showExportHistory, setShowExportHistory] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [deployStudentId, setDeployStudentId] = useState('');
  const [deploySignal, setDeploySignal] = useState(0);
  const [studentQuery, setStudentQuery] = useState('');
  const [profile, setProfile] = useState(null);
  const [studentSection, setStudentSection] = useState('all');
  const reportsMenuRef = useRef(null);
  const [attendanceImage, setAttendanceImage] = useState(null);
  const [confirmImageDelete, setConfirmImageDelete] = useState(false);
  const [imageDeleting, setImageDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    const results = await Promise.allSettled([
      getDeployedStudents(), getAnomalyReport(), getAnnouncements(),
    ]);
    if (results[0].status === 'fulfilled') setStudents(results[0].value.data.students || []);
    if (results[1].status === 'fulfilled') setAnomalies(results[1].value.data.anomalies || []);
    if (results[2].status === 'fulfilled') setAnnouncements(results[2].value.data.announcements || []);
    if (results.some(result => result.status === 'rejected')) showToast('Some dashboard data could not be loaded.', 'error');
  }, [showToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    getProfile().then(res => setProfile(res.data.user)).catch(() => {});
  }, []);
  useEffect(() => {
    if (activeTab === 'analytics' || activeTab === 'risks') {
      setInsightView(activeTab);
      setActiveTab('insights');
    } else if (['attendance', 'requests', 'completion', 'anomalies'].includes(activeTab)) {
      setReviewView(activeTab);
      setActiveTab('reviews');
    }
  }, [activeTab, setActiveTab]);
  useEffect(() => {
    const closeReportsMenu = event => {
      if (reportsMenuRef.current && !reportsMenuRef.current.contains(event.target)) setReportsOpen(false);
    };
    document.addEventListener('mousedown', closeReportsMenu);
    return () => document.removeEventListener('mousedown', closeReportsMenu);
  }, []);

  const handleSelectStudent = async (student) => {
    if (!student.deployment_id) {
      setDeployStudentId(String(student.id));
      setActiveTab('deployments');
      showToast(`${student.first_name} needs a company assignment first.`);
      return;
    }
    if (detailLoading) return;
    setSelectedStudent(student);
    setStudentDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const res = await getStudentDetail(student.id);
      setStudentDetail(res.data);
    } catch (error) {
      const message = error.response?.data?.message || 'Unable to load student details. Please try again.';
      setDetailError(message);
      showToast(message, 'error');
    }
    finally { setDetailLoading(false); }
  };

  const handleCreateAnnouncement = async (e) => {
    e.preventDefault(); setAnnouncementLoading(true);
    try {
      const response = await createAnnouncement(announcementForm);
      setAnnouncements(current => [response.data.announcement, ...current.filter(item => item.id !== response.data.announcement.id)]);
      showToast('Announcement posted.');
      setShowAnnouncement(false);
      setAnnouncementForm({ title: '', body: '', targetRole: '' });
      await fetchAll();
    } catch { showToast('Failed to post.', 'error'); }
    finally { setAnnouncementLoading(false); }
  };

  const handleReviewDocument = async (e) => {
    e.preventDefault(); setReviewLoading(true);
    try {
      await reviewDocument(reviewTarget.id, reviewForm);
      showToast(`Document ${reviewForm.status}.`);
      setShowReview(false);
      const res = await getStudentDetail(selectedStudent.id);
      setStudentDetail(res.data);
    } catch { showToast('Failed to review.', 'error'); }
    finally { setReviewLoading(false); }
  };

  const handleExportAnalytics = async () => {
    setExporting(true);
    try {
      const blob = await exportAnalyticsAsCSV();
      downloadCSV(blob, `Analytics_Report_${new Date().toISOString().split('T')[0]}`);
      showToast('Analytics exported successfully.');
    } catch (error) {
      showToast(error.message || 'Failed to export analytics.', 'error');
    } finally {
      setExporting(false);
    }
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

  const progressPercent = (rendered, required) => safePercent(rendered, required).toFixed(1);
  const closeStudentDetail = () => {
    setSelectedStudent(null);
    setStudentDetail(null);
    setDetailError('');
    setAttendanceImage(null);
  };

  const openAttendanceImage = async (url, label, record, imageType) => {
    try {
      await logAttendanceImageView(url);
      setAttendanceImage({ url, label, date: record.date, recordId: record.id, imageType });
    } catch (error) {
      showToast(error.response?.data?.message || 'Unable to open this attendance image.', 'error');
    }
  };

  const handleDeleteAttendanceImage = async () => {
    if (!attendanceImage || imageDeleting) return;
    setImageDeleting(true);
    try {
      await deleteAttendanceImage(attendanceImage.url);
      const field = attendanceImage.imageType === 'clock_in' ? 'selfie_in_url' : 'selfie_out_url';
      setStudentDetail(current => ({
        ...current,
        dtr: current.dtr.map(record => record.id === attendanceImage.recordId ? { ...record, [field]: null } : record),
      }));
      setConfirmImageDelete(false);
      setAttendanceImage(null);
      showToast('Attendance image deleted and recorded in Audit.');
    } catch (error) {
      setConfirmImageDelete(false);
      showToast(error.response?.data?.message || 'Unable to delete the attendance image.', 'error');
    } finally {
      setImageDeleting(false);
    }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const formatTime = (ts) => ts ? new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';

  const DOC_STATUS = {
    not_submitted: { bg: 'var(--surface-2)', color: 'var(--text-2)', label: 'Not Submitted' },
    pending: { bg: 'var(--warning-light)', color: 'var(--warning)', label: 'Pending' },
    approved: { bg: 'var(--success-light)', color: 'var(--success)', label: 'Approved' },
    returned: { bg: 'var(--danger-light)', color: 'var(--danger)', label: 'Returned' },
  };

  const NAV = [
    { key: 'deployments', icon: <VectorIcon name="briefcase" size={20} />, label: 'Deployments', group: 'Operations' },
    { key: 'map', icon: <VectorIcon name="map" size={20} />, label: 'Live Map', group: 'Operations' },
    { key: 'insights', icon: <VectorIcon name="trending" size={20} />, label: 'Insights', group: 'Monitoring' },
    { key: 'reviews', icon: <VectorIcon name="success" size={20} />, label: 'Reviews', group: 'Monitoring', badge: anomalies.length },
    { key: 'requirements', icon: <VectorIcon name="document" size={20} />, label: 'Document Requirements', group: 'Operations' },
    { key: 'announcements', icon: <VectorIcon name="bell" size={20} />, label: 'Announcements', group: 'Communication' },
    { key: 'users', icon: <VectorIcon name="users" size={20} />, label: 'Users', group: 'Administration' },
    { key: 'health', icon: <VectorIcon name="activity" size={20} />, label: 'System Health', group: 'Administration' },
  ];
  const MOBILE_NAV = [
    { key: 'deployments', icon: <VectorIcon name="briefcase" size={20} />, label: 'Deploy' },
    { key: 'map', icon: <VectorIcon name="map" size={20} />, label: 'Map' },
    { key: 'insights', icon: <VectorIcon name="trending" size={20} />, label: 'Insights' },
    { key: 'reviews', icon: <VectorIcon name="success" size={20} />, label: 'Reviews', badge: anomalies.length },
    { key: 'announcements', icon: <VectorIcon name="bell" size={20} />, label: 'Announcements' },
    { key: 'requirements', icon: <VectorIcon name="document" size={20} />, label: 'Requirements' },
    { key: 'users', icon: <VectorIcon name="users" size={20} />, label: 'Users' },
    { key: 'health', icon: <VectorIcon name="activity" size={20} />, label: 'Health' },
    { key: 'settings', icon: <VectorIcon name="settings" size={20} />, label: 'Company Settings' },
    { key: 'account', icon: <VectorIcon name="user" size={20} />, label: 'Account' },
  ];

const deployedStudents = students.filter(student => student.deployment_id);
const undeployedStudents = students.filter(student => !student.deployment_id);
// Simple two-view navigation: legacy 'all' resolves to whichever needs attention.
const view = studentSection === 'deployed' ? 'deployed' : studentSection === 'awaiting' ? 'awaiting' : (undeployedStudents.length ? 'awaiting' : 'deployed');
  const filteredAwaitingStudents = useMemo(() => {
    const query = studentQuery.trim().toLowerCase();
    return undeployedStudents.filter(student => {
      if (!query) return true;
      return [
        student.id,
        student.student_id,
        student.first_name,
        student.last_name,
        `${student.first_name || ''} ${student.last_name || ''}`,
        student.email,
      ].some(value => String(value || '').toLowerCase().includes(query));
    });
  }, [undeployedStudents, studentQuery]);
  const averageProgress = deployedStudents.length
    ? deployedStudents.reduce((total, student) => total + safePercent(student.hours_rendered, student.required_hours), 0) / deployedStudents.length
    : 0;
  const progressByStudent = useMemo(() => Object.fromEntries(students
    .filter(student => student.deployment_id)
    .map(student => [String(student.id), {
      rendered: Number(student.hours_rendered || 0),
      required: Number(student.required_hours || 0),
      percent: safePercent(student.hours_rendered, student.required_hours),
    }])), [students]);
  const studentsNeedingAttention = deployedStudents.filter(student =>
    Number(student.anomaly_count || 0) > 0
    || Number(student.pending_documents || 0) > 0
    || safePercent(student.hours_rendered, student.required_hours) < 30
  ).length;
  const openInsights = view => {
    setInsightView(view);
    setActiveTab('insights');
  };
  const openReviews = view => {
    setReviewView(view);
    setActiveTab('reviews');
  };

  const initials = user ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() : 'CO';

  // Student Detail View
  if (selectedStudent) {
    return (
      <div className="workspace-shell">
        {/* Sidebar on detail view too */}
        <Sidebar user={user} navItems={NAV} activeTab={activeTab} onTabChange={(tab) => { closeStudentDetail(); setActiveTab(tab); }} role="coordinator" onEditProfile={() => { closeStudentDetail(); setActiveTab('account'); }} />

        <DashboardTopbar role="coordinator" onEditProfile={() => { closeStudentDetail(); setActiveTab('account'); }} />

        <div className="page-content" style={{ paddingBottom: '1rem' }}>
          <WorkspacePane key={selectedStudent.id}>
          <PageHeader
            className="dashboard-back-header"
            breadcrumbs={[{ label: 'Coordinator', onClick: closeStudentDetail }, { label: 'Deployments', onClick: closeStudentDetail }, { label: studentDetail?.student?.first_name || selectedStudent.first_name }]}
            title={`${studentDetail?.student?.first_name || selectedStudent.first_name} ${studentDetail?.student?.last_name || selectedStudent.last_name}`}
            subtitle={studentDetail ? `${Math.round(progressPercent(studentDetail.totalHours, studentDetail.student.required_hours))}% complete` : 'Loading…'}
            actions={<button className="action-btn action-btn-gray dashboard-back-button icon-label" onClick={closeStudentDetail}><VectorIcon name="back" size={16} /> Back</button>}
          />
          {detailLoading ? (
            <SkeletonPage variant="profile" label="Loading student" />
          ) : detailError ? (
            <div className="card dashboard-detail-error" role="alert">
              <div className="card-title">Student details unavailable</div>
              <p>{detailError}</p>
              <div className="dashboard-detail-error-actions">
                <button className="action-btn action-btn-gray" onClick={closeStudentDetail}>Back to students</button>
                <button className="btn-compact-primary" onClick={() => handleSelectStudent(selectedStudent)}>Try again</button>
              </div>
            </div>
          ) : (
            <>
              <div className="card rec-card">
                <div className="card-title coordinator-card-title">
                  Attendance <span className="badge badge-gray">{studentDetail.dtr.length} recent</span>
                </div>
                {studentDetail.dtr.length === 0 ? (
                  <EmptyState type="dtr" />
                ) : (
                  <div className="rec-att-list">
                    {studentDetail.dtr.map(r => (
                      <article className="rec-att" key={r.id}>
                        <div className="rec-att-top">
                          <strong>{formatDate(r.date)}</strong>
                          {r.anomaly_flag
                            ? <span className="badge badge-warning"><VectorIcon name="alert" size={13} /></span>
                            : <span className="badge badge-success"><VectorIcon name="check" size={13} /></span>}
                        </div>
                        {(r.selfie_in_url || r.selfie_out_url) ? (
                          <div className="att-photos">
                            {r.selfie_in_url && (
                              <button type="button" className="att-thumb" onClick={() => openAttendanceImage(r.selfie_in_url, 'Time In selfie', r, 'clock_in')} aria-label={`View Time In selfie for ${formatDate(r.date)}`}>
                                <SecureImage src={r.selfie_in_url} alt="" />
                                <span>Time in</span>
                              </button>
                            )}
                            {r.selfie_out_url && (
                              <button type="button" className="att-thumb" onClick={() => openAttendanceImage(r.selfie_out_url, 'Time Out selfie', r, 'clock_out')} aria-label={`View Time Out selfie for ${formatDate(r.date)}`}>
                                <SecureImage src={r.selfie_out_url} alt="" />
                                <span>Time out</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <p className="att-nophoto">No time-in / time-out photos.</p>
                        )}
                        <div className="rec-att-facts">
                          <div><span>In</span><strong>{formatTime(r.clock_in)}</strong></div>
                          <div><span>Out</span><strong>{formatTime(r.clock_out)}</strong></div>
                          <div><span>Hours</span><strong>{r.total_hours ? `${r.total_hours}h` : '—'}</strong></div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          </WorkspacePane>
        </div>

        {attendanceImage && (
          <div className="modal-overlay attendance-photo-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setAttendanceImage(null); }}>
            <div className="modal-content attendance-photo-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-photo-title">
              <div className="modal-handle" />
              <div className="attendance-photo-header">
                <div>
                  <h2 className="modal-title" id="attendance-photo-title">{attendanceImage.label}</h2>
                  <p>{formatDate(attendanceImage.date)} · Access recorded in Audit</p>
                </div>
                <div className="attendance-photo-actions">
                  <button type="button" className="action-btn action-btn-danger" onClick={() => setConfirmImageDelete(true)}>Delete image</button>
                  <button type="button" className="action-btn action-btn-gray" onClick={() => setAttendanceImage(null)}>Close</button>
                </div>
              </div>
              <SecureImage className="attendance-photo-full" src={attendanceImage.url} alt={attendanceImage.label} />
            </div>
          </div>
        )}
        <ConfirmDialog
          open={confirmImageDelete}
          title="Delete attendance image?"
          message="This permanently removes the selfie from protected storage. The attendance times remain unchanged, and the deletion will be recorded in Audit."
          confirmLabel={imageDeleting ? 'Deleting…' : 'Delete image'}
          danger
          onCancel={() => { if (!imageDeleting) setConfirmImageDelete(false); }}
          onConfirm={handleDeleteAttendanceImage}
        />

        {/* Review Modal */}
        {showReview && reviewTarget && (
          <div className="modal-overlay">
            <div className="modal-content">
              <div className="modal-handle" />
              <div className="modal-title">Review Document</div>
              <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>{reviewTarget.requirement_name}</p>
              <form onSubmit={handleReviewDocument}>
                <div className="form-group">
                  <label>Decision</label>
                  <select value={reviewForm.status} onChange={e => setReviewForm({ ...reviewForm, status: e.target.value })}>
                    <option value="approved">Approve</option>
                    <option value="returned">Return for Revision</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Remarks {reviewForm.status === 'returned' ? '(required)' : '(optional)'}</label>
                  <textarea rows={3} required={reviewForm.status === 'returned'}
                    value={reviewForm.remarks}
                    onChange={e => setReviewForm({ ...reviewForm, remarks: e.target.value })}
                    placeholder={reviewForm.status === 'returned' ? 'Tell the student exactly what to fix and resubmit' : 'Optional note for the student, e.g. approved as submitted'}
                    style={{ width: '100%', padding: '0.75rem', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontSize: '0.9rem', resize: 'vertical', background: 'var(--surface)', color: 'var(--text)' }}
                  />
                </div>
                <div className="modal-actions grid-2" style={{ marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => setShowReview(false)}
                    className="action-btn action-btn-gray" style={{ padding: '0.875rem' }}>Cancel</button>
                  <button type="submit" disabled={reviewLoading} style={{
                    padding: '0.875rem',
                    background: reviewForm.status === 'approved' ? 'var(--success)' : 'var(--danger)',
                    color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontWeight: 600,
                  }}>{reviewLoading ? 'Saving...' : 'Submit'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {toast && (
          <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
        )}
      </div>
    );
  }

  return (
    <div className="workspace-shell">

      {/* ── SIDEBAR (desktop only) ── */}
      <Sidebar
        user={user}
        navItems={NAV}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        role="coordinator"
        onEditProfile={() => setActiveTab('account')}
      />

      {/* ── TOPBAR ── */}
      <DashboardTopbar role="coordinator" onEditProfile={() => setActiveTab('account')} />

      {/* ── CONTENT ── */}
      <div className="page-content">
        <WorkspacePane key={activeTab}>
        <Suspense fallback={<SkeletonPage variant="dashboard" />}>
        {activeTab === 'users' ? (
          <UserManagementPanel onToast={showToast} />
        ) : activeTab === 'health' ? (
          <SystemHealthPanel />
        ) : activeTab === 'map' ? (
          <ErrorBoundary tabName="map" key={activeTab}>
            <MapPage />
          </ErrorBoundary>

        ) : activeTab === 'insights' ? (
          <>
            <PageHeader
              title="Insights"
              subtitle={`${students.length} students`}
              actions={insightView === 'analytics' ? (
                <div className="reports-menu-wrap" ref={reportsMenuRef}>
                  <button type="button" className="action-btn action-btn-gray icon-label" onClick={() => setReportsOpen(open => !open)} aria-expanded={reportsOpen} aria-haspopup="menu">
                    <VectorIcon name="document" size={16} /> Reports
                  </button>
                  {reportsOpen && (
                    <div className="reports-menu" role="menu" aria-label="Analytics reports">
                      <button type="button" role="menuitem" disabled={exporting} onClick={() => { setReportsOpen(false); handleExportAnalytics(); }}>
                        <VectorIcon name="download" size={16} /> {exporting ? 'Exporting…' : 'Export CSV'}
                      </button>
                      <button type="button" role="menuitem" onClick={() => { setReportsOpen(false); setShowScheduleModal(true); }}>
                        <VectorIcon name="calendar" size={16} /> Schedule report
                      </button>
                      <button type="button" role="menuitem" onClick={() => { setReportsOpen(false); setShowExportHistory(true); }}>
                        <VectorIcon name="clock" size={16} /> Report history
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            />
            <SlidingSubnav
              ariaLabel="Insight views"
              activeKey={insightView}
              onChange={setInsightView}
              items={[
                { key: 'analytics', label: 'Analytics', icon: <VectorIcon name="trending" size={16} /> },
                { key: 'risks', label: 'Risks', icon: <VectorIcon name="alert" size={16} /> },
              ]}
            />
            <WorkspacePane key={insightView}>
              {insightView === 'analytics' ? (
                <AnalyticsPage
                  students={students}
                  onOpenStudents={() => { setStudentSection('all'); setActiveTab('deployments'); }}
                  onOpenProgress={() => { setStudentSection('deployed'); setActiveTab('deployments'); }}
                  onOpenRisks={() => openInsights('risks')}
                />
              ) : <RiskDashboard />}
            </WorkspacePane>
          </>

        ) : activeTab === 'reviews' ? (
          <>
            <PageHeader
              title="Review center"
              subtitle={anomalies.length ? `${anomalies.length} flagged` : 'All clear'}
            />
            <SlidingSubnav
              ariaLabel="Review queues"
              activeKey={reviewView}
              onChange={setReviewView}
              items={[
                { key: 'attendance', label: 'Attendance', icon: <VectorIcon name="calendar" size={16} /> },
                { key: 'anomalies', label: 'Anomalies', icon: <VectorIcon name="alert" size={16} />, count: anomalies.length },
                { key: 'requests', label: 'Requests', icon: <VectorIcon name="clock" size={16} /> },
                { key: 'completion', label: 'Completion', icon: <VectorIcon name="success" size={16} /> },
              ]}
            />
            <WorkspacePane key={reviewView}>
            {reviewView === 'attendance' ? (
              <AttendanceReviewCenter canDeleteImages embedded onToast={showToast} />
            ) : reviewView === 'requests' ? (
              <AttendanceExceptionsPage reviewer embedded />
            ) : reviewView === 'completion' ? (
              <CompletionPanel reviewer embedded />
            ) : anomalies.length === 0 ? (
              <div className="card"><EmptyState type="anomalies" /></div>
            ) : (
              <div className="card coordinator-anomaly-card">
                <ul className="coordinator-list">
                  {anomalies.map(a => (
                    <li key={a.id} className="coordinator-list-row">
                      <div>
                        <strong>{a.first_name} {a.last_name}</strong>
                        <span className="coordinator-muted">{formatDate(a.date)} · {formatTime(a.clock_in)}{a.company_name ? ` · ${a.company_name}` : ''}</span>
                        <span className="coordinator-flag"><VectorIcon name="alert" size={14} /> {a.anomaly_flag}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <button type="button" className="action-btn action-btn-primary coordinator-anomaly-cta" onClick={() => setReviewView('attendance')}>Review in Attendance</button>
              </div>
            )}
            </WorkspacePane>
          </>

        ) : activeTab === 'account' ? (
          <div>
            <PageHeader title="Account" />
            <AccountIdentityCard
              initials={initials}
              photoEditor={<ProfileAvatar initials={initials} onToast={showToast} />}
              name={`${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Coordinator'}
              email={user?.email}
              roleLabel="School Coordinator"
              details={[
                { label: 'Phone', value: profile?.phone || user?.phone || 'Not set' },
                { label: 'Company', value: (profile?.companies?.length
                  ? profile.companies.map(company => company.name).join(', ')
                  : [...new Set(students.map(student => student.company_name).filter(Boolean))].join(', ')) || 'Not assigned' },
                { label: 'Company address', value: profile?.company_address || 'Not set' },
                { label: 'School', value: profile?.school || user?.school || 'Not set' },
              ]}
            />
            <button type="button" className="card account-link-row" onClick={() => setActiveTab('settings')}>
              <VectorIcon name="map" size={18} />
              <span>Worksites &amp; perimeter</span>
              <VectorIcon name="chevronRight" size={18} />
            </button>
            <NotificationPreferences />
            <SecuritySettings />
          </div>

        ) : activeTab === 'settings' ? (
          <CompanySettingsPage onBack={() => setActiveTab('account')} />

        ) : activeTab === 'requirements' ? (
          <DocumentRequirementsManager role="Coordinator" />

        ) : activeTab === 'deployments' ? (
          <div className="dep">
            <section className="dep-hero" aria-label="Deployments summary">
              <div className="dep-hero-glow" aria-hidden="true" />
              <div className="dep-hero-top">
                <div>
                  <p className="dep-eyebrow"><VectorIcon name="briefcase" size={12} /> Deploy</p>
                  <h1 className="dep-title">
                    {undeployedStudents.length === 0 ? 'All deployed' : `${undeployedStudents.length} waiting`}
                  </h1>
                  <p className="dep-sub">
                    {undeployedStudents.length === 0
                      ? `${deployedStudents.length} deployed · ${Math.round(averageProgress)}% avg progress`
                      : `${undeployedStudents.length} awaiting · ${deployedStudents.length} deployed`}
                  </p>
                </div>
                <button type="button" className="dep-new" onClick={() => setDeploySignal(signal => signal + 1)}>
                  <VectorIcon name="plus" size={17} /> Deploy
                </button>
              </div>
            </section>

            <div className="dep-tabs" role="tablist" aria-label="Student filter">
              {[
                { v: 'awaiting', label: `Awaiting${undeployedStudents.length ? ` · ${undeployedStudents.length}` : ''}` },
                { v: 'deployed', label: `Deployed${deployedStudents.length ? ` · ${deployedStudents.length}` : ''}` },
              ].map(tab => (
                <button
                  key={tab.v} role="tab" aria-selected={view === tab.v} type="button"
                  className={`dep-tab${view === tab.v ? ' is-on' : ''}`}
                  onClick={() => setStudentSection(tab.v)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <label className="dep-search">
              <VectorIcon name="search" size={14} />
              <input
                type="search"
                placeholder="Search students…"
                value={studentQuery}
                onChange={event => setStudentQuery(event.target.value)}
                aria-label="Search students"
              />
              {studentQuery && (
                <button type="button" onClick={() => setStudentQuery('')} aria-label="Clear search">
                  <VectorIcon name="x" size={14} />
                </button>
              )}
            </label>

            {view === 'awaiting' && (undeployedStudents.length > 0 ? (
              <section className="dep-await" aria-label="Awaiting assignment">
                <p className="dep-await-title">Awaiting assignment · {filteredAwaitingStudents.length}</p>
                {filteredAwaitingStudents.length === 0 ? (
                  <p className="dep-empty">No students match this search.</p>
                ) : (
                  <div className="dep-await-list">
                    {filteredAwaitingStudents.map(student => (
                      <div key={student.id} className="dep-await-row">
                        <span className="dep-ava" aria-hidden="true">
                          {`${student.first_name?.[0] || ''}${student.last_name?.[0] || ''}`.toUpperCase()}
                        </span>
                        <div className="dep-who">
                          <strong>{student.first_name} {student.last_name}</strong>
                          <small>{student.email}</small>
                        </div>
                        <button type="button" className="dep-go" onClick={() => setDeployStudentId(String(student.id))}>
                          Deploy
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <div className="card dep-empty-card">Everyone is deployed. Nice work.</div>
            ))}
            {view === 'deployed' && (
            <section className="coordinator-deployments-panel dep-panel" aria-label="Student deployments">
              <DeploymentsPage
                showHeader={false}
                hideSearch
                searchQuery={studentQuery}
                progressByStudent={progressByStudent}
                prefillStudentId={deployStudentId}
                createSignal={deploySignal}
                studentExtras={students}
                detailFetcher={(studentId) => getStudentDetail(studentId).then(response => response.data)}
                onPrefillConsumed={() => setDeployStudentId('')}
                onViewStudent={(studentId) => {
                const student = students.find(item => String(item.id) === String(studentId));
                if (student) handleSelectStudent(student);
                else showToast('Student monitoring record is not available yet.', 'warning');
              }} />
            </section>
            )}
          </div>

        ) : activeTab === 'anomalies' ? (
          <>
            <PageHeader title="Anomaly report" subtitle={`${anomalies.length} flagged record${anomalies.length !== 1 ? 's' : ''}`} />
            {anomalies.length === 0 ? (
              <div className="card"><EmptyState type="anomalies" /></div>
            ) : anomalies.map(a => (
              <CollapsibleSection
                key={a.id}
                title={`${a.first_name} ${a.last_name}`}
                subtitle={`${formatDate(a.date)} · ${a.company_name || 'Unassigned company'}`}
                defaultOpen={false}
              >
                <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginBottom: '0.5rem' }}>
                  Time in {formatTime(a.clock_in)}
                </div>
                <div style={{ background: 'var(--warning-light)', color: 'var(--warning)', fontSize: '0.82rem', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)' }}>
                  <span className="icon-label"><VectorIcon name="alert" size={15} /> {a.anomaly_flag}</span>
                </div>
              </CollapsibleSection>
            ))}
          </>

        ) : (
          <>
            <PageHeader title="Announcements" subtitle={`${announcements.length} posted`} actions={
              <button onClick={() => setShowAnnouncement(true)} className="btn-compact-primary icon-label"><VectorIcon name="plus" size={16} /> New announcement</button>
            } />
            {announcements.length === 0 ? (
              <div className="card"><EmptyState type="announcements" /></div>
            ) : announcements.map(a => (
              <CollapsibleSection
                key={a.id}
                title={a.title}
                subtitle={`${a.first_name} ${a.last_name} · ${formatDate(a.created_at)}`}
                count={a.target_role ? `${a.target_role}s` : 'All'}
                defaultOpen={false}
              >
                <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: 1.55, margin: 0 }}>{a.body}</p>
              </CollapsibleSection>
            ))}
          </>
        )}
        </Suspense>
        </WorkspacePane>
      </div>

      {/* ── BOTTOM NAV (mobile only) ── */}
      <DashboardBottomNav items={MOBILE_NAV} activeKey={activeTab} onChange={setActiveTab} />

      {/* Announcement Modal */}
      {showAnnouncement && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-handle" />
            <div className="modal-title">New Announcement</div>
            <form onSubmit={handleCreateAnnouncement}>
              <div className="form-group">
                <label>Title</label>
                <input type="text" required value={announcementForm.title}
                  onChange={e => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                  placeholder="e.g. Midterm evaluation deadline this Friday" />
              </div>
              <div className="form-group">
                <label>Message</label>
                <textarea required rows={4} value={announcementForm.body}
                  onChange={e => setAnnouncementForm({ ...announcementForm, body: e.target.value })}
                  placeholder="Write the notice students or supervisors should read"
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
              <div className="form-group">
                <label>Target Role (optional)</label>
                <select value={announcementForm.targetRole}
                  onChange={e => setAnnouncementForm({ ...announcementForm, targetRole: e.target.value })}>
                  <option value="">Everyone in this program</option>
                  <option value="student">Students</option>
                  <option value="supervisor">Supervisors</option>
                  <option value="coordinator">Coordinators</option>
                </select>
              </div>
              <div className="modal-actions grid-2">
                <button type="button" onClick={() => setShowAnnouncement(false)}
                  className="action-btn action-btn-gray" style={{ padding: '0.875rem' }}>Cancel</button>
                <button type="submit" disabled={announcementLoading} className="btn-primary" style={{ margin: 0 }}>
                  {announcementLoading ? 'Posting...' : 'Post'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Export & Scheduling Modals */}
      <ReportSchedulerModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSchedule={handleScheduleReport}
        reportType="analytics"
        reportTypeLabel="Analytics Report"
      />

      <ExportHistoryModal
        isOpen={showExportHistory}
        onClose={() => setShowExportHistory(false)}
      />

      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </div>
  );
};

export default CoordinatorDashboard;
