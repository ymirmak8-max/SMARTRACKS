import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getDeployedStudents, getStudentDetail,
  getAnomalyReport, createAnnouncement, getAnnouncements, logAttendanceImageView, deleteAttendanceImage,
} from '../../api/coordinator';
import { reviewDocument } from '../../api/documents';
import { exportAnalyticsAsCSV, scheduleReport, downloadCSV } from '../../api/exports';
import useAuth from '../../hooks/useAuth';
import EmptyState from '../../components/common/EmptyState';
import { AccountIdentityCard, MetricCard, PageHeader, safePercent } from '../../components/common/DashboardUI';
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
import StudentTypeahead from '../../components/common/StudentTypeahead';

const AnalyticsPage = lazy(() => import('./AnalyticsPage'));
const AttendanceExceptionsPage = lazy(() => import('../../components/common/AttendanceExceptionsPage'));
const AttendanceReviewCenter = lazy(() => import('../../components/common/AttendanceReviewCenter'));
const CompanySettingsPage = lazy(() => import('./CompanySettingsPage'));
const CompletionPanel = lazy(() => import('../../components/common/CompletionPanel'));
const DeploymentsPage = lazy(() => import('../admin/DeploymentsPage'));
const MapPage = lazy(() => import('./MapPage'));
const RiskDashboard = lazy(() => import('../../components/common/RiskDashboard'));
const DocumentRequirementsManager = lazy(() => import('../../components/common/DocumentRequirementsManager'));

const COORDINATOR_VIEWS = ['deployments', 'map', 'insights', 'reviews', 'analytics', 'risks', 'attendance', 'requests', 'completion',
  'account', 'settings', 'requirements', 'anomalies', 'announcements'];

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
  ];
  const MOBILE_NAV = [
    { key: 'deployments', icon: <VectorIcon name="briefcase" size={20} />, label: 'Deploy' },
    { key: 'map', icon: <VectorIcon name="map" size={20} />, label: 'Map' },
    { key: 'insights', icon: <VectorIcon name="trending" size={20} />, label: 'Insights' },
    { key: 'reviews', icon: <VectorIcon name="success" size={20} />, label: 'Reviews', badge: anomalies.length },
    { key: 'announcements', icon: <VectorIcon name="bell" size={20} />, label: 'Announcements' },
    { key: 'requirements', icon: <VectorIcon name="document" size={20} />, label: 'Requirements' },
    { key: 'settings', icon: <VectorIcon name="settings" size={20} />, label: 'Company Settings' },
    { key: 'account', icon: <VectorIcon name="user" size={20} />, label: 'Account' },
  ];

  const deployedStudents = students.filter(student => student.deployment_id);
  const undeployedStudents = students.filter(student => !student.deployment_id);
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
            eyebrow="Student record"
            breadcrumbs={[{ label: 'Coordinator', onClick: closeStudentDetail }, { label: 'Deployments', onClick: closeStudentDetail }, { label: studentDetail?.student?.first_name || selectedStudent.first_name }]}
            title={`${studentDetail?.student?.first_name || selectedStudent.first_name} ${studentDetail?.student?.last_name || selectedStudent.last_name}`}
            subtitle={studentDetail ? `${progressPercent(studentDetail.totalHours, studentDetail.student.required_hours)}% complete · ${studentDetail.student.company_name}` : 'Loading student information…'}
            actions={<button className="action-btn action-btn-gray dashboard-back-button icon-label" onClick={closeStudentDetail}><VectorIcon name="back" size={16} /> Back to students</button>}
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
              <div className="card">
                <p style={{ color: 'var(--text-2)', fontSize: '0.85rem', marginBottom: '0.25rem' }}>{studentDetail.student.email}</p>
                <p className="icon-label" style={{ color: 'var(--text-3)', fontSize: '0.82rem', marginBottom: '0.25rem' }}><VectorIcon name="building" size={14} /> {studentDetail.student.company_name}</p>
                {studentDetail.student.course && (
                  <p style={{ color: 'var(--text-2)', fontSize: '0.82rem', marginBottom: '0.2rem', fontWeight: 500 }}>
                    <span className="icon-label"><VectorIcon name="education" size={14} /> {studentDetail.student.course}</span>
                  </p>
                )}
                {studentDetail.student.school && (
                  <p style={{ color: 'var(--text-3)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
                    <span className="icon-label"><VectorIcon name="school" size={14} /> {studentDetail.student.school}</span>
                  </p>
                )}
                <div className="progress-bar progress-bar-md" style={{ marginBottom: '0.4rem' }}>
                  <div className="progress-fill" style={{ width: `${progressPercent(studentDetail.totalHours, studentDetail.student.required_hours)}%` }} />
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                  {studentDetail.totalHours}h / {studentDetail.student.required_hours}h required
                </p>
              </div>

              <div className="stat-grid stat-grid-3">
                {[
                  { label: 'DTR Records', value: studentDetail.dtr.length, color: 'var(--primary)' },
                  { label: 'Docs Approved', value: studentDetail.documents.filter(d => d.status === 'approved').length, color: 'var(--success)' },
                  { label: 'Evaluations', value: studentDetail.evaluations.length, color: '#7C3AED' },
                ].map(s => (
                  <MetricCard key={s.label} label={s.label} value={s.value} />
                ))}
              </div>

              {/* Evaluations */}
              <div className="card">
                <div className="card-title">Evaluations</div>
                {studentDetail.evaluations.length === 0 ? (
                  <EmptyState type="evaluations" />
                ) : (
                  <div className="evaluations-grid">
                    {studentDetail.evaluations.map(ev => {
                      const getGrade = (score) => {
                        if (score >= 95) return { label: 'Excellent', color: 'var(--success)' };
                        if (score >= 85) return { label: 'Very Good', color: 'var(--primary)' };
                        if (score >= 75) return { label: 'Good', color: '#7C3AED' };
                        if (score >= 65) return { label: 'Satisfactory', color: 'var(--warning)' };
                        return { label: 'Needs Improvement', color: 'var(--danger)' };
                      };
                      const grade = getGrade(ev.total_score);
                      return (
                        <div key={ev.id} className="evaluation-card">
                          <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-2)', marginBottom: '0.5rem', textTransform: 'capitalize' }}>
                            {ev.period} Evaluation
                          </div>
                          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: grade.color, lineHeight: 1 }}>{ev.total_score}</div>
                          <div style={{ fontSize: '0.72rem', color: grade.color, fontWeight: 600, marginTop: '0.2rem' }}>{grade.label}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: '0.4rem' }}>
                            By {ev.supervisor_first} {ev.supervisor_last}
                          </div>
                          {ev.comments && (
                            <div className="evaluation-comment">
                              <VectorIcon name="message" size={14} />
                              <span>{ev.comments}</span>
                            </div>
                          )}
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginTop: '0.4rem' }}>
                            {new Date(ev.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Documents */}
              <div className="card">
                <div className="card-title">Documents</div>
                {studentDetail.documents.length === 0 ? (
                  <EmptyState type="documents" />
                ) : studentDetail.documents.map(doc => {
                  const style = DOC_STATUS[doc.status] || DOC_STATUS.not_submitted;
                  return (
                    <div key={doc.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.75rem', background: 'var(--bg)', borderRadius: 'var(--radius)', marginBottom: '0.5rem',
                    }}>
                      <div style={{ flex: 1, marginRight: '0.5rem' }}>
                        <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{doc.requirement_name}</div>
                        {doc.remarks && <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.2rem' }}>{doc.remarks}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
                        <span className="badge" style={{ background: style.bg, color: style.color }}>{style.label}</span>
                        {doc.status === 'pending' && (
                          <button onClick={() => { setReviewTarget(doc); setReviewForm({ status: 'approved', remarks: '' }); setShowReview(true); }}
                            style={{ padding: '0.25rem 0.6rem', background: 'var(--primary)', color: 'var(--on-primary)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 500 }}>
                            Review
                          </button>
                        )}
                        {doc.file_url && (
                          <a href={doc.file_url} target="_blank" rel="noreferrer" style={{
                            padding: '0.25rem 0.6rem', background: 'var(--surface-2)', borderRadius: '6px',
                            fontSize: '0.75rem', fontWeight: 500, textDecoration: 'none', color: 'var(--text-2)',
                          }} aria-label="View document"><VectorIcon name="eye" size={15} /></a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* DTR */}
              <div className="card">
                <div className="card-title">Recent DTR & Attendance Verification</div>
                <p className="attendance-photo-note">Selfies are private attendance evidence. Full-image access is recorded in the audit history.</p>
                {studentDetail.dtr.length === 0 ? (
                  <EmptyState type="dtr" />
                ) : (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>{['Date', 'In', 'Out', 'Hrs', 'Photos', 'Status'].map(h => <th key={h}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {studentDetail.dtr.map(r => (
                          <tr key={r.id}>
                            <td style={{ fontWeight: 500 }}>{formatDate(r.date)}</td>
                            <td style={{ color: 'var(--success)', fontWeight: 500 }}>{formatTime(r.clock_in)}</td>
                            <td style={{ color: 'var(--danger)', fontWeight: 500 }}>{formatTime(r.clock_out)}</td>
                            <td style={{ fontWeight: 600 }}>{r.total_hours ? `${r.total_hours}h` : '—'}</td>
                            <td>
                              <div className="attendance-photo-pair">
                                {r.selfie_in_url && <button type="button" onClick={() => openAttendanceImage(r.selfie_in_url, 'Time In selfie', r, 'clock_in')} aria-label={`View Time In selfie for ${formatDate(r.date)}`}>
                                  <img src={r.selfie_in_url} alt="" loading="lazy" /><span>In</span>
                                </button>}
                                {r.selfie_out_url && <button type="button" onClick={() => openAttendanceImage(r.selfie_out_url, 'Time Out selfie', r, 'clock_out')} aria-label={`View Time Out selfie for ${formatDate(r.date)}`}>
                                  <img src={r.selfie_out_url} alt="" loading="lazy" /><span>Out</span>
                                </button>}
                                {!r.selfie_in_url && !r.selfie_out_url && <span className="attendance-photo-missing">None</span>}
                              </div>
                            </td>
                            <td>{r.anomaly_flag ? <span className="badge badge-warning"><VectorIcon name="alert" size={13} /></span> : <span className="badge badge-success"><VectorIcon name="check" size={13} /></span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
              <img className="attendance-photo-full" src={attendanceImage.url} alt={attendanceImage.label} />
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
        {activeTab === 'map' ? (
          <MapPage />

        ) : activeTab === 'insights' ? (
          <>
            <PageHeader
              title="Insights"
              subtitle={`${students.length} students · ${anomalies.length} open anomal${anomalies.length === 1 ? 'y' : 'ies'}`}
              breadcrumbs={[{ label: 'Coordinator' }, { label: 'Insights' }]}
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
                { key: 'analytics', label: 'AI Analytics', icon: <VectorIcon name="trending" size={16} /> },
                { key: 'risks', label: 'Student Risks', icon: <VectorIcon name="alert" size={16} /> },
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
              subtitle={`${anomalies.length} attendance anomal${anomalies.length === 1 ? 'y' : 'ies'} currently flagged`}
              breadcrumbs={[{ label: 'Coordinator' }, { label: 'Reviews' }]}
            />
            <SlidingSubnav
              ariaLabel="Review queues"
              activeKey={reviewView}
              onChange={setReviewView}
              items={[
                { key: 'attendance', label: 'Attendance', icon: <VectorIcon name="calendar" size={16} /> },
                { key: 'anomalies', label: 'Anomalies', icon: <VectorIcon name="alert" size={16} />, count: anomalies.length },
                { key: 'requests', label: 'Leave & Corrections', icon: <VectorIcon name="clock" size={16} /> },
                { key: 'completion', label: 'Completion', icon: <VectorIcon name="success" size={16} /> },
              ]}
            />
            <WorkspacePane key={reviewView}>
            {reviewView === 'attendance' ? (
              <AttendanceReviewCenter canDeleteImages onToast={showToast} />
            ) : reviewView === 'requests' ? (
              <AttendanceExceptionsPage reviewer />
            ) : reviewView === 'completion' ? (
              <CompletionPanel reviewer />
            ) : (
              <>
                <div className="review-section-heading">
                  <div>
                    <h2>Anomaly report</h2>
                    <p>{anomalies.length} flagged record{anomalies.length !== 1 ? 's' : ''} awaiting inspection.</p>
                  </div>
                  <button type="button" className="action-btn action-btn-gray" onClick={() => setReviewView('attendance')}>Open attendance review</button>
                </div>
                {anomalies.length === 0 ? (
                  <div className="card"><EmptyState type="anomalies" /></div>
                ) : anomalies.map(a => (
                  <div key={a.id} className="card">
                    <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>{a.first_name} {a.last_name}</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginBottom: '0.5rem' }}>
                      {formatDate(a.date)} • {formatTime(a.clock_in)} • {a.company_name}
                    </div>
                    <div style={{ background: 'var(--warning-light)', color: 'var(--warning)', fontSize: '0.82rem', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)' }}>
                      <span className="icon-label"><VectorIcon name="alert" size={15} /> {a.anomaly_flag}</span>
                    </div>
                  </div>
                ))}
              </>
            )}
            </WorkspacePane>
          </>

        ) : activeTab === 'account' ? (
          <div>
            <PageHeader title="Account" subtitle="Update your coordinator profile, company settings, and notification preferences." breadcrumbs={[{ label: 'Coordinator' }, { label: 'Account' }]} />
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
            <div className="stat-grid stat-grid-3" style={{ marginBottom: '0.875rem' }}>
              <MetricCard label="Students" value={students.length} onClick={() => { setStudentSection('all'); setActiveTab('deployments'); }} />
              <MetricCard label="Anomalies" value={anomalies.length} tone="danger" onClick={() => openReviews('anomalies')} />
              <MetricCard label="Announcements" value={announcements.length} onClick={() => setActiveTab('announcements')} />
            </div>
            <div className="card" style={{ marginBottom: '0.875rem' }}>
              <div className="card-title">Company Perimeter</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-3)', marginBottom: '0.875rem' }}>
                Manage office locations and geo-fence radius
              </p>
              <button type="button" onClick={() => setActiveTab('settings')} className="action-btn action-btn-primary icon-label">
                <VectorIcon name="settings" size={16} /> Manage perimeter
              </button>
            </div>
            <NotificationPreferences />
          </div>

        ) : activeTab === 'settings' ? (
          <CompanySettingsPage onBack={() => setActiveTab('account')} />

        ) : activeTab === 'requirements' ? (
          <DocumentRequirementsManager role="Coordinator" />

        ) : activeTab === 'deployments' ? (
          <>
            <PageHeader
              title="Coordinator workspace"
              subtitle={`${deployedStudents.length} deployed · ${undeployedStudents.length} awaiting assignment`}
              breadcrumbs={[{ label: 'Coordinator' }, { label: 'Deployments' }]}
              actions={(
                <div className="coordinator-header-actions">
                  <button type="button" className="action-btn action-btn-gray icon-label" onClick={() => setActiveTab('map')}>
                    <VectorIcon name="map" size={16} /> Live map
                  </button>
                  <button type="button" className="btn-compact-primary icon-label" onClick={() => openReviews('attendance')}>
                    <VectorIcon name="success" size={16} /> Review attendance
                  </button>
                </div>
              )}
            />
            <section className="coordinator-command-center" aria-label="Coordinator overview">
              <div className="coordinator-command-copy">
                <span className="coordinator-command-kicker">Today’s focus</span>
                <h2>{
                  studentsNeedingAttention
                    ? `${studentsNeedingAttention} student${studentsNeedingAttention === 1 ? '' : 's'} may need attention`
                    : undeployedStudents.length
                      ? `${undeployedStudents.length} student${undeployedStudents.length === 1 ? '' : 's'} ready to deploy`
                      : 'Your active students are on track'
                }</h2>
                <p>{
                  studentsNeedingAttention
                    ? 'Review flags and pending requirements first, then use analytics to plan follow-up.'
                    : undeployedStudents.length
                      ? 'Assign each approved student to a company and supervisor to start monitoring.'
                      : 'Review flags and pending requirements first, then use analytics to plan follow-up.'
                }</p>
                <div className="coordinator-command-links">
                  <button type="button" onClick={() => openInsights('risks')}>Open risk dashboard</button>
                  <button type="button" onClick={() => openReviews('anomalies')}>View anomalies</button>
                  <button type="button" onClick={() => openInsights('analytics')}>Open AI analytics</button>
                </div>
              </div>
              <div className="coordinator-command-progress" aria-label={`${averageProgress.toFixed(1)} percent average progress`}>
                <strong>{averageProgress.toFixed(1)}%</strong>
                <span>Average cohort progress</span>
                <div className="progress-bar progress-bar-md"><div className="progress-fill" style={{ width: `${averageProgress}%` }} /></div>
              </div>
            </section>
            <div className="stat-grid stat-grid-3 coordinator-overview-metrics">
              <MetricCard label="Deployed" value={deployedStudents.length} detail="Active company assignments" icon={<VectorIcon name="briefcase" size={18} />} onClick={() => setStudentSection('deployed')} />
              <MetricCard label="Awaiting assignment" value={undeployedStudents.length} detail="Approved students to deploy" tone="warning" icon={<VectorIcon name="users" size={18} />} onClick={() => setStudentSection('awaiting')} />
              <MetricCard label="Open anomalies" value={anomalies.length} detail="Attendance records to inspect" tone="danger" icon={<VectorIcon name="calendar" size={18} />} onClick={() => openReviews('anomalies')} />
            </div>
            <div className="student-directory-toolbar" role="search" aria-label="Search and filter students">
              <StudentTypeahead
                id="coordinator-find-student"
                students={students}
                value={studentQuery}
                onChange={setStudentQuery}
                onSelect={(student) => {
                  setStudentQuery(`${student.first_name || ''} ${student.last_name || ''}`.trim());
                  if (student.deployment_id) handleSelectStudent(student);
                  else setStudentSection('awaiting');
                }}
                label="Find student"
                placeholder="Type a name to see matching students"
              />
              <div className="student-directory-filter">
                <label htmlFor="coordinator-student-section">Show</label>
                <select
                  id="coordinator-student-section"
                  value={studentSection}
                  onChange={event => setStudentSection(event.target.value)}
                >
                  <option value="all">All students</option>
                  <option value="awaiting">Awaiting assignment</option>
                  <option value="deployed">Deployed</option>
                </select>
              </div>
            </div>
            {studentSection !== 'deployed' && undeployedStudents.length > 0 && (
              <CollapsibleSection
                title="Awaiting assignment"
                subtitle="Approved students who still need a company"
                count={filteredAwaitingStudents.length}
                defaultOpen
                className="awaiting-assignment-collapse"
              >
                {filteredAwaitingStudents.length === 0 ? (
                  <p className="awaiting-empty">No students match this name, ID, or email.</p>
                ) : (
                  <div className="awaiting-student-list">
                    {filteredAwaitingStudents.map(student => (
                      <div key={student.id} className="awaiting-student-row">
                        <div>
                          <strong>{student.first_name} {student.last_name}</strong>
                          <small>{student.email}</small>
                          <small className="awaiting-student-id">ID {String(student.id).slice(0, 8)}</small>
                        </div>
                        <button type="button" className="btn-compact-primary" onClick={() => setDeployStudentId(String(student.id))}>
                          Deploy
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleSection>
            )}
            {studentSection !== 'awaiting' && (
            <section className="coordinator-deployments-panel" aria-label="Student deployments">
              <DeploymentsPage
                showHeader={false}
                hideSearch
                searchQuery={studentQuery}
                prefillStudentId={deployStudentId}
                onPrefillConsumed={() => setDeployStudentId('')}
                onViewStudent={(studentId) => {
                const student = students.find(item => String(item.id) === String(studentId));
                if (student) handleSelectStudent(student);
                else showToast('Student monitoring record is not available yet.', 'warning');
              }} />
            </section>
            )}
          </>

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
            <PageHeader title="Announcements" subtitle={`${announcements.length} posted`} breadcrumbs={[{ label: 'Coordinator' }, { label: 'Announcements' }]} actions={
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
