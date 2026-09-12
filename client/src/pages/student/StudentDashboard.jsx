import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { clockIn, clockOut, getTodayRecord, getDTRHistory, getDeploymentInfo, flagPerimeterExit, getAttendanceChallenge } from '../../api/dtr';
import { scheduleReport } from '../../api/exports';
import useAuth from '../../hooks/useAuth';
import useLocation from '../../hooks/useLocation';
import { exportDTRtoPDF } from '../../utils/exportPDF';
import EmptyState from '../../components/common/EmptyState';
import Sidebar from '../../components/common/Sidebar';
import DashboardTopbar from '../../components/common/DashboardTopbar';
import { PageHeader, safePercent } from '../../components/common/DashboardUI';
import ReportSchedulerModal from '../../components/common/ReportSchedulerModal';
import ExportHistoryModal from '../../components/common/ExportHistoryModal';
import VectorIcon from '../../components/common/VectorIcon';
import CollapsibleSection from '../../components/common/CollapsibleSection';
import WorkspacePane from '../../components/common/WorkspacePane';
import SkeletonPage from '../../components/common/Skeleton';
import {
  getAttendanceQueueSummary, queueAttendance, retryFailedAttendance,
  subscribeAttendanceQueue, synchronizeAttendanceQueue,
} from '../../utils/attendanceQueue';
import useDashboardNavigation from '../../hooks/useDashboardNavigation';
import useTransientToast from '../../hooks/useTransientToast';
const DocumentsPage = lazy(() => import('./DocumentsPage'));
const ProfilePage = lazy(() => import('./ProfilePage'));
const LocationMap = lazy(() => import('../../components/common/LocationMap'));
const AttendanceExceptionsPage = lazy(() => import('../../components/common/AttendanceExceptionsPage'));
const CompletionPanel = lazy(() => import('../../components/common/CompletionPanel'));
const NO_WORKSITES = [];
const STUDENT_VIEWS = ['dashboard', 'documents', 'attendance', 'completion', 'profile'];

const distanceBetweenPositions = (first, second) => {
  const toRadians = value => value * Math.PI / 180;
  const dLat = toRadians(second.coords.latitude - first.coords.latitude);
  const dLng = toRadians(second.coords.longitude - first.coords.longitude);
  const lat1 = toRadians(first.coords.latitude);
  const lat2 = toRadians(second.coords.latitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const formatDurationHours = value => {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) return '—';
  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes === 0) return '<1 min';
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!wholeHours) return `${minutes} min`;
  if (!minutes) return `${wholeHours} ${wholeHours === 1 ? 'hr' : 'hrs'}`;
  return `${wholeHours} ${wholeHours === 1 ? 'hr' : 'hrs'} ${minutes} min`;
};

const StudentDashboard = () => {
  const { user } = useAuth();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const attendanceSyncRef = useRef(false);

  const [activePage, setActivePage] = useDashboardNavigation('dashboard', STUDENT_VIEWS);
  const [todayRecord, setTodayRecord] = useState(null);
  const [history, setHistory] = useState([]);
  const [totalRendered, setTotalRendered] = useState(0);
  const [requiredHours, setRequiredHours] = useState(486);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const { toast, toastType, showToast } = useTransientToast(6000);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedSelfie, setCapturedSelfie] = useState(null);
  const [currentAction, setCurrentAction] = useState(null);
  const [gpsCoords, setGpsCoords] = useState(null);
  const [gpsError, setGpsError] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [evidenceUrl, setEvidenceUrl] = useState(null);
  const [evidenceNote, setEvidenceNote] = useState('');
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [deployment, setDeployment] = useState(null);
  const [exitWarning, setExitWarning] = useState(false);
  const [exitDistance, setExitDistance] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showExportHistory, setShowExportHistory] = useState(false);
  const [queueSummary, setQueueSummary] = useState({ total: 0, pending: 0, failed: 0 });
  const [syncingAttendance, setSyncingAttendance] = useState(false);
  const [latestReceipt, setLatestReceipt] = useState(null);
  const [attendanceChallenge, setAttendanceChallenge] = useState(null);
  const [maximumGpsAccuracy, setMaximumGpsAccuracy] = useState(50);
  const [permissionPrompt, setPermissionPrompt] = useState(null);

  // Live location tracking
  const handleExitPerimeter = async (position) => {
  // Only flag if student is currently clocked in
  if (!todayRecord?.clock_in || todayRecord?.clock_out) return;
  setExitWarning(true);
  setExitDistance(position.distance);
  try {
    await flagPerimeterExit(position);
    await fetchData();
  } catch (err) {
    console.error('Failed to flag exit:', err);
  }
};

const { coords, distance, isInside, accuracy, matchedLocation } = useLocation(
  deployment?.latitude,
  deployment?.longitude,
  deployment?.geo_radius_meters,
  handleExitPerimeter,
  !!todayRecord?.clock_in && !todayRecord?.clock_out,
  deployment?.locations || NO_WORKSITES
);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [todayRes, historyRes] = await Promise.all([getTodayRecord(), getDTRHistory()]);
      setTodayRecord(todayRes.data.record);
      setHistory(historyRes.data.records);
      setTotalRendered(historyRes.data.totalRendered);
      setRequiredHours(historyRes.data.requiredHours);
    } catch { showToast('Failed to load data.', 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => {
    if (user?.role === 'student') {
      fetchData();
      getDeploymentInfo()
        .then(res => {
          setDeployment(res.data.deployment);
          const configuredAccuracy = Number(res.data.attendancePolicy?.maximumGpsAccuracyMeters);
          if (Number.isFinite(configuredAccuracy)) setMaximumGpsAccuracy(configuredAccuracy);
        })
        .catch(() => showToast('Deployment information is unavailable.', 'warning'));
    } else {
      setLoading(false);
    }
  }, [user?.role, fetchData, showToast]);

  const refreshQueueSummary = useCallback(() => {
    getAttendanceQueueSummary().then(setQueueSummary).catch(() => {});
  }, []);

  const syncQueuedAttendance = useCallback(async () => {
    if (!navigator.onLine || attendanceSyncRef.current) return;
    attendanceSyncRef.current = true;
    setSyncingAttendance(true);
    try {
      const summary = await synchronizeAttendanceQueue();
      setQueueSummary(summary);
      if (summary.total === 0) await fetchData();
    } finally {
      attendanceSyncRef.current = false;
      setSyncingAttendance(false);
    }
  }, [fetchData]);

  useEffect(() => {
    refreshQueueSummary();
    const unsubscribe = subscribeAttendanceQueue(refreshQueueSummary);
    window.addEventListener('online', syncQueuedAttendance);
    syncQueuedAttendance();
    return () => {
      unsubscribe();
      window.removeEventListener('online', syncQueuedAttendance);
    };
  }, [refreshQueueSummary, syncQueuedAttendance]);

  const getGPS = () => new Promise((resolve, reject) => {
    if (!window.isSecureContext)
      return reject(new Error('GPS requires a secure HTTPS connection.'));
    if (!navigator.geolocation)
      return reject(new Error('Geolocation is not supported on this device.'));
    setGpsLoading(true);
    let bestPosition = null;
    const goodPositions = [];
    let settled = false;
    let watchId;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      setGpsLoading(false);
      callback(value);
    };
    const timeoutId = window.setTimeout(() => {
      const measured = bestPosition?.coords?.accuracy;
      const message = Number.isFinite(measured)
        ? `GPS accuracy is currently ${Math.round(measured)} meters. Move near a window or outdoors, enable precise location, then try again. Required: ${maximumGpsAccuracy} meters or better.`
        : 'GPS request timed out. Enable precise location, move near a window or outdoors, then try again.';
      setGpsError(message);
      finish(reject, new Error(message));
    }, 20000);
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!bestPosition || pos.coords.accuracy < bestPosition.coords.accuracy) bestPosition = pos;
        if (pos.coords.accuracy > maximumGpsAccuracy) return;
        goodPositions.push(pos);
        if (goodPositions.length < 2) return;
        const previous = goodPositions[goodPositions.length - 2];
        const stabilityLimit = Math.max(10, previous.coords.accuracy, pos.coords.accuracy);
        if (distanceBetweenPositions(previous, pos) > stabilityLimit) return;
        const accepted = previous.coords.accuracy <= pos.coords.accuracy ? previous : pos;
        const c = { latitude: accepted.coords.latitude, longitude: accepted.coords.longitude, accuracy: accepted.coords.accuracy };
        setGpsCoords(c);
        setGpsError('');
        finish(resolve, c);
      },
      (error) => {
        const message = error.code === 1
          ? 'GPS access denied. Enable location and precise-location permission in your browser settings.'
          : error.code === 2
            ? 'GPS position is unavailable. Move to an open area and try again.'
            : 'GPS request timed out. Check location services and try again.';
        setGpsError(message);
        finish(reject, new Error(message));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  });

  const startCamera = async () => {
    if (!window.isSecureContext)
      throw new Error('Camera access requires a secure HTTPS connection.');
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera access is not supported by this browser.');
    setShowCamera(true); setCapturedSelfie(null);
    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: false });
      if (videoRef.current) videoRef.current.srcObject = stream;
      else stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      setShowCamera(false);
      throw new Error(error.name === 'NotAllowedError'
        ? 'Camera access denied. Enable camera permission in your browser settings.'
        : error.message || 'Unable to start the camera.', { cause: error });
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    setShowCamera(false);
  };

  const captureSelfie = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || video.readyState < 2 || !video.videoWidth) {
      showToast('Camera is still starting. Please try again.', 'warning');
      return;
    }
    const scale = Math.min(1, 1280 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    setCapturedSelfie(canvas.toDataURL('image/jpeg', 0.82));
    stopCamera();
  };

  const beginAttendanceCapture = async (action) => {
    setCurrentAction(action); setGpsError('');
    try {
      const challenge = await getAttendanceChallenge(action);
      setAttendanceChallenge(challenge.data.token);
      await getGPS();
      await startCamera();
      setPermissionPrompt(null);
    }
    catch (error) {
      setCurrentAction(null);
      const denied = /denied|permission/i.test(error.message || '');
      if (denied) setPermissionPrompt({ action, denied: true, message: error.message });
      else showToast(error.message || 'Unable to start attendance verification.', 'error');
    }
  };

  const handleInitiateAction = async (action) => {
    let permissionsGranted = false;
    if (navigator.permissions?.query) {
      try {
        const [locationPermission, cameraPermission] = await Promise.all([
          navigator.permissions.query({ name: 'geolocation' }),
          navigator.permissions.query({ name: 'camera' }),
        ]);
        permissionsGranted = locationPermission.state === 'granted' && cameraPermission.state === 'granted';
      } catch { /* Some mobile browsers do not expose camera permission state. */ }
    }
    if (permissionsGranted) await beginAttendanceCapture(action);
    else setPermissionPrompt({ action, denied: false });
  };

  useEffect(() => () => {
    if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(track => track.stop());
  }, []);

  const handleSubmitAction = async () => {
    if (!capturedSelfie) return showToast('Please take a selfie.', 'error');
    if (!gpsCoords) return showToast('GPS not found.', 'error');

    if (currentAction === 'out' && !showEvidenceModal) {
      setShowEvidenceModal(true);
      return;
    }

    setActionLoading(true);
    try {
      const payload = {
        latitude: gpsCoords.latitude,
        longitude: gpsCoords.longitude,
        accuracy: gpsCoords.accuracy,
        selfieUrl: capturedSelfie,
        clientCapturedAt: new Date().toISOString(),
        submissionId: crypto.randomUUID(),
        attendanceChallenge,
      };
      if (currentAction === 'in') {
        let response;
        try { response = await clockIn(payload); }
        catch (error) {
          if (error.response) throw error;
          await queueAttendance('in', payload);
          showToast('Time In saved offline. It will synchronize automatically.', 'warning');
        }
        if (response) {
          setLatestReceipt(response.data.receipt || null);
          showToast(response.data.message, response.data.isValid ? 'success' : 'warning');
        }
      } else {
        const clockOutPayload = { ...payload, evidenceUrl: evidenceUrl || null, evidenceNote: evidenceNote || null };
        let response;
        try { response = await clockOut(clockOutPayload); }
        catch (error) {
          if (error.response) throw error;
          await queueAttendance('out', clockOutPayload);
          showToast('Time Out saved offline. It will synchronize automatically.', 'warning');
        }
        if (response) {
          setLatestReceipt(response.data.receipt || null);
          showToast(`Timed out successfully — ${formatDurationHours(response.data.totalHours)} credited today.`, 'success');
        }
      }
      setCapturedSelfie(null); setCurrentAction(null); setGpsCoords(null); setAttendanceChallenge(null);
      setEvidenceUrl(null); setEvidenceNote(''); setShowEvidenceModal(false);
      if (navigator.onLine) await fetchData();
    } catch (err) { showToast(err.response?.data?.message || 'Action failed.', 'error'); }
    finally { setActionLoading(false); }
  };

  const handleScheduleReport = async (options) => {
    try {
      await scheduleReport({ ...options, report_type: 'dtr' });
      showToast('Report scheduled successfully.');
      setShowScheduleModal(false);
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to schedule report', { cause: error });
    }
  };

  const progressPercent = safePercent(totalRendered, requiredHours);
  const formatTime = (ts) => ts ? new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
  const isClockedIn = todayRecord?.clock_in && !todayRecord?.clock_out;
  const isClockedOut = todayRecord?.clock_in && todayRecord?.clock_out;

  const NAV = [
    { key: 'dashboard', icon: <VectorIcon name="home" size={20} />, label: 'Home' },
    { key: 'documents', icon: <VectorIcon name="document" size={20} />, label: 'Docs' },
    { key: 'attendance', icon: <VectorIcon name="calendar" size={20} />, label: 'Requests' },
    { key: 'completion', icon: <VectorIcon name="success" size={20} />, label: 'Completion' },
  ];

  return (
  <div className="workspace-shell">

    {/* Sidebar — desktop only */}
    <Sidebar
      user={user}
      navItems={NAV}
      activeTab={activePage}
      onTabChange={setActivePage}
      role="student"
      onEditProfile={() => setActivePage('profile')}
    />

    <DashboardTopbar role="student" onEditProfile={() => setActivePage('profile')} />

      {/* Content */}
      <div className="page-content">
        <WorkspacePane key={activePage}>
        {activePage === 'documents' ? (
          <Suspense fallback={<SkeletonPage variant="list" />}><DocumentsPage onBack={() => setActivePage('dashboard')} /></Suspense>
        ) : activePage === 'attendance' ? (
          <Suspense fallback={<SkeletonPage variant="list" />}><AttendanceExceptionsPage /></Suspense>
        ) : activePage === 'completion' ? (
          <Suspense fallback={<SkeletonPage variant="list" />}><CompletionPanel /></Suspense>
        ) : activePage === 'profile' ? (
          <Suspense fallback={<SkeletonPage variant="profile" />}><ProfilePage /></Suspense>
        ) : (
          <>
            <PageHeader
              title={`Welcome back, ${user?.first_name || 'Student'}`}
              subtitle={deployment?.company_name
                ? `${deployment.company_name} · ${progressPercent.toFixed(0)}% of ${requiredHours}h`
                : `${progressPercent.toFixed(0)}% of ${requiredHours} required hours`}
            />

            {queueSummary.total > 0 && (
              <div className="card" style={{ marginBottom: '0.875rem', borderColor: queueSummary.failed ? 'var(--danger)' : 'var(--warning)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                  <div>
                    <strong>{syncingAttendance ? 'Synchronizing attendance…' : `${queueSummary.total} attendance submission${queueSummary.total === 1 ? '' : 's'} stored on this device`}</strong>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                      {queueSummary.failed ? `${queueSummary.failed} needs attention` : navigator.onLine ? 'Waiting to synchronize' : 'Offline — synchronization resumes automatically'}
                    </div>
                  </div>
                  <button className="action-btn action-btn-primary" disabled={syncingAttendance || !navigator.onLine}
                    onClick={async () => {
                      setSyncingAttendance(true);
                      try { setQueueSummary(await retryFailedAttendance()); await fetchData(); }
                      finally { setSyncingAttendance(false); }
                    }}>Retry</button>
                </div>
              </div>
            )}

            {latestReceipt && (
              <div className="card" style={{ marginBottom: '0.875rem', borderColor: 'var(--success)' }} role="status">
                <div className="card-title">Latest attendance receipt</div>
                <p><strong>{latestReceipt.action === 'clock_in' ? 'Time In' : 'Time Out'}</strong> · {latestReceipt.status}</p>
                <p style={{ color: 'var(--text-2)', fontSize: '.82rem' }}>
                  Server: {new Date(latestReceipt.serverReceivedAt).toLocaleString()} · GPS accuracy: {latestReceipt.gpsAccuracy}m
                  {latestReceipt.worksite ? ` · ${latestReceipt.worksite}` : ''}
                </p>
                <code style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>{latestReceipt.receiptId}</code>
              </div>
            )}

            {/* Progress */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <div className="card-title">OJT Progress</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>{totalRendered}h of {requiredHours}h</div>
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: progressPercent >= 100 ? 'var(--success)' : 'var(--primary)', lineHeight: 1 }}>
                  {progressPercent.toFixed(1)}%
                </div>
              </div>
              <div className="progress-bar progress-bar-md">
                <div className="progress-fill" style={{
                  width: `${progressPercent}%`,
                  background: progressPercent >= 100 ? 'var(--success)' : 'var(--primary)',
                }} />
              </div>
            </div>

            {/* Stats */}
            <div className="stat-grid stat-grid-3">
              {[
                { label: 'Time In', value: formatTime(todayRecord?.clock_in), color: 'var(--success)', empty: 'Not yet' },
                { label: 'Time Out', value: formatTime(todayRecord?.clock_out), color: 'var(--danger)', empty: 'Not yet' },
                { label: 'Duration', value: todayRecord?.clock_out ? formatDurationHours(todayRecord.total_hours) : null, color: 'var(--primary)', empty: 'Not completed' },
              ].map(s => (
                <div key={s.label} className="stat-card">
                  <div className="stat-value" style={{
                    color: s.value ? s.color : 'var(--text-3)',
                    fontSize: s.value ? '1.1rem' : '0.85rem',
                    fontWeight: s.value ? 700 : 400,
                  }}>{s.value || s.empty}</div>
                  <div className="stat-label">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Exit Warning Banner */}
{exitWarning && (
  <div style={{
    background: 'var(--danger-light)',
    border: '2px solid var(--danger)',
    borderRadius: 'var(--radius-lg)',
    padding: '1rem',
    marginBottom: '0.875rem',
    animation: 'pulse 1s ease-in-out',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <VectorIcon name="alert" size={28} />
      <div>
        <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '0.95rem' }}>
          You left the office perimeter!
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--danger)', marginTop: '0.1rem', opacity: 0.8 }}>
          Your DTR has been automatically flagged. Distance: {exitDistance}m from office.
        </div>
      </div>
    </div>
    <button onClick={() => setExitWarning(false)} style={{
      marginTop: '0.75rem', width: '100%', padding: '0.5rem',
      background: 'var(--danger)', color: '#fff',
      border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
      fontWeight: 600, fontSize: '0.82rem',
    }}>Dismiss</button>
  </div>
)}

{/* Live Perimeter Status */}
{coords && deployment?.latitude && !exitWarning && (
  <div style={{
    background: isInside ? 'var(--success-light)' : 'var(--danger-light)',
    border: `1px solid ${isInside ? 'var(--success)' : 'var(--danger)'}`,
    borderRadius: 'var(--radius-lg)',
    padding: '0.875rem 1rem',
    marginBottom: '0.875rem',
    display: 'flex', alignItems: 'center', gap: '0.75rem',
  }}>
    <VectorIcon name={isInside ? 'success' : 'alert'} size={24} />
    <div>
      <div style={{
        fontWeight: 600, fontSize: '0.875rem',
        color: isInside ? 'var(--success)' : 'var(--danger)',
      }}>
        {isInside ? `Inside ${matchedLocation?.name || 'approved worksite'}` : 'You are outside all approved worksites!'}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: '0.1rem' }}>
        {distance !== null ? `${distance}m from ${matchedLocation?.name || 'nearest worksite'}` : 'Calculating...'}
      </div>
    </div>
  </div>
)}

            {/* Live Map */}
            {coords && (
              <div className="card" style={{ padding: '1rem', marginBottom: '0.875rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div className="card-title icon-label" style={{ margin: 0 }}><VectorIcon name="map" size={15} /> Live Location</div>
                  {deployment?.latitude && (
                    <span style={{
                      fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem',
                      borderRadius: '999px',
                      background: isInside ? 'var(--success-light)' : 'var(--danger-light)',
                      color: isInside ? 'var(--success)' : 'var(--danger)',
                    }}>
                      <span className="icon-label"><VectorIcon name={isInside ? 'success' : 'alert'} size={13} /> {isInside ? 'In range' : 'Out of range'}</span>
                    </span>
                  )}
                </div>
                <Suspense fallback={<SkeletonPage variant="map" />}><LocationMap
                  studentLat={coords.latitude}
                  studentLng={coords.longitude}
                  accuracy={accuracy}
                  officeLat={matchedLocation?.latitude || deployment?.latitude}
                  officeLng={matchedLocation?.longitude || deployment?.longitude}
                  radiusMeters={matchedLocation?.geoRadiusMeters || deployment?.geo_radius_meters}
                  isInside={isInside}
                /></Suspense>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: '0.5rem', textAlign: 'center' }}>
  <span className="icon-label"><VectorIcon name="map" size={13} /> Precise coordinates protected</span>
  {deployment?.company_name && <span className="icon-label" style={{ marginLeft: '0.45rem' }}><VectorIcon name="building" size={13} /> {deployment.company_name}</span>}
</div>
<div style={{
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  gap: '0.4rem', marginTop: '0.25rem',
}}>
  <div style={{
    width: '8px', height: '8px', borderRadius: '50%',
    background: accuracy <= 10 ? 'var(--success)' : accuracy <= 30 ? 'var(--warning)' : 'var(--danger)',
  }} />
  <span style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>
    GPS accuracy: ±{accuracy}m
    {accuracy <= 10 ? ' (Excellent)' : accuracy <= 30 ? ' (Good)' : accuracy <= 100 ? ' (Fair)' : ' (Poor)'}
  </span>
</div>
              </div>
            )}

            {/* Anomaly */}
            {todayRecord?.anomaly_flag && (
              <div style={{
                background: 'var(--warning-light)', border: '1px solid #FCD34D',
                borderRadius: 'var(--radius-lg)', padding: '0.875rem 1rem',
                color: 'var(--warning)', fontSize: '0.85rem', marginBottom: '0.875rem',
              }}><span className="icon-label"><VectorIcon name="alert" size={15} /> {todayRecord.anomaly_flag}</span></div>
            )}

            {/* GPS Error */}
            {gpsError && (
              <div style={{
                background: 'var(--danger-light)', border: '1px solid #FCA5A5',
                borderRadius: 'var(--radius-lg)', padding: '0.875rem 1rem',
                color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '0.875rem',
              }}>{gpsError}</div>
            )}

            {/* Clock Buttons */}
            <div className="grid-2" style={{ marginBottom: '1rem' }}>
              <button className="clock-btn clock-btn-in"
                onClick={() => handleInitiateAction('in')}
                disabled={!!isClockedIn || !!isClockedOut || actionLoading}>
                <span className="clock-btn-icon"></span>
                {gpsLoading ? 'Getting GPS...' : 'Time In'}
              </button>
              <button className="clock-btn clock-btn-out"
                onClick={() => handleInitiateAction('out')}
                disabled={!isClockedIn || actionLoading}>
                <span className="clock-btn-icon"></span>
                Time Out
              </button>
            </div>

            <CollapsibleSection
                title="Attendance history"
                subtitle={`${history.length} live record${history.length === 1 ? '' : 's'}`}
                count={history.length}
                defaultOpen
              >
                {history.length > 0 && (
                  <button onClick={() => exportDTRtoPDF(
                    { ...user, company_name: deployment?.company_name || '—' },
                    history, totalRendered, requiredHours
                  )} className="action-btn action-btn-primary" style={{ marginBottom: '0.75rem' }}>Export PDF</button>
                )}
                {loading ? (
                  <SkeletonPage variant="table" label="Loading attendance" />
                ) : history.length === 0 ? (
                  <EmptyState type="dtr" />
                ) : (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>{['Date', 'In', 'Out', 'Duration', ''].map(h => <th key={h}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {history.map(r => (
                          <tr key={r.id}>
                            <td style={{ fontWeight: 500 }}>{formatDate(r.date)}</td>
                            <td style={{ color: 'var(--success)', fontWeight: 500 }}>{formatTime(r.clock_in)}</td>
                            <td style={{ color: 'var(--danger)', fontWeight: 500 }}>{formatTime(r.clock_out)}</td>
                            <td style={{ fontWeight: 600 }} title={r.total_hours != null ? `${r.total_hours} decimal hours` : undefined}>
                              {r.clock_out ? formatDurationHours(r.total_hours) : '—'}
                            </td>
                            <td>{r.anomaly_flag
                              ? <span className="badge badge-warning"><VectorIcon name="alert" size={13} /></span>
                              : <span className="badge badge-success"><VectorIcon name="check" size={13} /></span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CollapsibleSection>
          </>
        )}
        </WorkspacePane>
      </div>

      {/* Bottom Nav */}
      {!showCamera && !capturedSelfie && !showEvidenceModal && <nav className="bottom-nav">
        {NAV.map(item => (
          <button key={item.key}
            className={`bottom-nav-item ${activePage === item.key ? 'active' : ''}`}
            onClick={() => setActivePage(item.key)}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>}

      {/* Camera Modal */}
      {permissionPrompt && !showCamera && (
        <div className="modal-overlay attendance-modal-overlay permission-overlay">
          <section className="modal-content attendance-modal-content permission-card" role="dialog" aria-modal="true" aria-labelledby="permission-title">
            <div className="modal-handle" />
            <div className={`permission-hero ${permissionPrompt.denied ? 'permission-hero-denied' : ''}`}>
              <VectorIcon name={permissionPrompt.denied ? 'alert' : 'lock'} size={28} />
            </div>
            <h2 className="modal-title" id="permission-title">
              {permissionPrompt.denied ? 'Permission needed' : 'Allow attendance verification'}
            </h2>
            <p className="permission-summary">
              {permissionPrompt.denied
                ? 'Smartrack cannot verify attendance until camera and precise location access are enabled.'
                : `To ${permissionPrompt.action === 'in' ? 'time in' : 'time out'}, Smartrack needs these permissions:`}
            </p>
            <div className="permission-list">
              <div className="permission-item">
                <div className="permission-icon" aria-hidden="true"><VectorIcon name="map" size={21} /></div>
                <div className="permission-copy">
                  <strong>Precise location</strong>
                  <p>Confirms whether you are at an approved worksite. Your GPS accuracy is included.</p>
                </div>
              </div>
              <div className="permission-item">
                <div className="permission-icon" aria-hidden="true"><VectorIcon name="camera" size={21} /></div>
                <div className="permission-copy">
                  <strong>Camera</strong>
                  <p>Captures the attendance selfie required for verification.</p>
                </div>
              </div>
            </div>
            {permissionPrompt.denied && (
              <div className="permission-help">
                Open this site or app in your device settings, allow Camera and Location, enable Precise Location, then return and try again.
              </div>
            )}
            {!permissionPrompt.denied && <p className="permission-privacy"><VectorIcon name="lock" size={14} /> Access is requested only when needed for attendance.</p>}
            <div className="modal-actions grid-2 attendance-modal-actions permission-actions">
              <button onClick={() => { setPermissionPrompt(null); setCurrentAction(null); }} className="action-btn action-btn-gray">Not now</button>
              <button onClick={() => beginAttendanceCapture(permissionPrompt.action)} className="btn-primary" style={{ margin: 0 }}>
                {permissionPrompt.denied ? 'Try Again' : 'Continue'}
              </button>
            </div>
          </section>
        </div>
      )}

      {showCamera && (
        <div className="modal-overlay attendance-modal-overlay">
          <div className="modal-content attendance-modal-content">
            <div className="modal-handle" />
            <div className="modal-title">{currentAction === 'in' ? 'Time In' : 'Time Out'} — Take Selfie</div>
            <video ref={videoRef} autoPlay playsInline style={{
              width: '100%', borderRadius: 'var(--radius-lg)', background: '#000', maxHeight: '55vh', objectFit: 'cover',
            }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className="modal-actions grid-2 attendance-modal-actions" style={{ marginTop: '1rem' }}>
              <button onClick={() => { stopCamera(); setCurrentAction(null); }}
                className="action-btn action-btn-gray" style={{ padding: '0.875rem' }}>Cancel</button>
              <button onClick={captureSelfie} className="btn-primary" style={{ margin: 0 }}><span className="icon-label"><VectorIcon name="camera" size={17} /> Capture</span></button>
            </div>
          </div>
        </div>
      )}

      {/* Selfie Confirm */}
      {capturedSelfie && !showEvidenceModal && (
        <div className="modal-overlay attendance-modal-overlay">
          <div className="modal-content attendance-modal-content">
            <div className="modal-handle" />
            <div className="modal-title">Confirm {currentAction === 'in' ? 'Time In' : 'Time Out'}</div>
            <img src={capturedSelfie} alt="selfie" style={{ width: '100%', borderRadius: 'var(--radius-lg)', marginBottom: '0.75rem' }} />
            {gpsCoords && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: '1rem' }}>
                {gpsCoords.latitude.toFixed(5)}, {gpsCoords.longitude.toFixed(5)}
              </p>
            )}
            <div className="modal-actions grid-2 attendance-modal-actions">
              <button onClick={() => { setCapturedSelfie(null); setCurrentAction(null); }}
                className="action-btn action-btn-gray" style={{ padding: '0.875rem' }}>Retake</button>
              <button onClick={handleSubmitAction} disabled={actionLoading}
                className="btn-primary" style={{ margin: 0 }}>
                {actionLoading ? 'Submitting...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Evidence Modal */}
      {showEvidenceModal && (
        <div className="modal-overlay attendance-modal-overlay">
          <div className="modal-content attendance-modal-content">
            <div className="modal-handle" />
            <div className="modal-title icon-label"><VectorIcon name="paperclip" size={18} /> Attach Evidence (Optional)</div>
            <p style={{ color: 'var(--text-3)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Attach a photo or document as proof of work for today.
            </p>

            {evidenceUrl ? (
              <div style={{ marginBottom: '1rem', position: 'relative' }}>
                <img src={evidenceUrl} alt="evidence" style={{
                  width: '100%', borderRadius: 'var(--radius-lg)', maxHeight: '200px', objectFit: 'cover',
                }} />
                <button onClick={() => setEvidenceUrl(null)} style={{
                  position: 'absolute', top: '0.5rem', right: '0.5rem',
                  background: 'var(--danger)', color: '#fff',
                  border: 'none', borderRadius: '999px', width: '24px', height: '24px',
                  cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
                }} aria-label="Remove evidence"><VectorIcon name="x" size={14} /></button>
              </div>
            ) : (
              <label style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: '0.5rem',
                border: '2px dashed var(--border)', borderRadius: 'var(--radius-lg)',
                padding: '1.5rem', cursor: 'pointer', marginBottom: '1rem',
                color: 'var(--text-3)', fontSize: '0.875rem',
              }}>
                <VectorIcon name="camera" size={30} />
                <span>Tap to attach a photo (maximum 5 MB)</span>
                <input type="file" accept="image/jpeg,image/png" style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    if (!['image/jpeg', 'image/png'].includes(file.type)) { showToast('Evidence must be a JPG or PNG image.', 'error'); e.target.value = ''; return; }
                    if (file.size > 5 * 1024 * 1024) { showToast('Evidence must be smaller than 5 MB.', 'error'); e.target.value = ''; return; }
                    const reader = new FileReader();
                    reader.onload = () => setEvidenceUrl(reader.result);
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            )}

            <div className="form-group">
              <label>Note / Accomplishment (optional)</label>
              <textarea rows={3} value={evidenceNote}
                onChange={e => setEvidenceNote(e.target.value)}
                placeholder="Briefly describe the tasks you finished today"
                style={{
                  width: '100%', padding: '0.75rem',
                  border: '1.5px solid var(--border)',
                  borderRadius: 'var(--radius)', fontSize: '0.9rem', resize: 'vertical',
                  background: 'var(--surface)', color: 'var(--text)',
                }}
              />
            </div>

            <div className="modal-actions grid-2 attendance-modal-actions" style={{ marginTop: '0.5rem' }}>
              <button onClick={() => {
                setShowEvidenceModal(false);
                setEvidenceUrl(null);
                setEvidenceNote('');
              }} className="action-btn action-btn-gray" style={{ padding: '0.875rem' }}>Cancel</button>
              <button onClick={handleSubmitAction} disabled={actionLoading}
                className="btn-primary" style={{ margin: 0 }}>
                {actionLoading ? 'Timing out…' : 'Time Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DTR Export Modals */}
      <ReportSchedulerModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSchedule={handleScheduleReport}
        reportType="dtr"
        reportTypeLabel="DTR Report"
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

export default StudentDashboard;
