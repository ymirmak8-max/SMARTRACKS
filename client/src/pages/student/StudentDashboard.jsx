import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import { clockIn, clockOut, getTodayRecord, getDTRHistory, getDeploymentInfo, flagPerimeterExit, getAttendanceChallenge } from '../../api/dtr';
import { scheduleReport } from '../../api/exports';
import useAuth from '../../hooks/useAuth';
import useLocation from '../../hooks/useLocation';
import { exportDTRtoPDF } from '../../utils/exportPDF';
import { validateSelfie } from '../../utils/selfieCheck';
import EmptyState from '../../components/common/EmptyState';
import Sidebar from '../../components/common/Sidebar';
import DashboardTopbar from '../../components/common/DashboardTopbar';
import { safePercent } from '../../components/common/DashboardUI';
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
const StudentDailyTasks = lazy(() => import('../../components/common/StudentDailyTasks'));
const NO_WORKSITES = [];
const STUDENT_VIEWS = ['dashboard', 'documents', 'tasks', 'attendance', 'completion', 'profile'];

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

const GPS_RECORDING_LIMIT_METERS = 250;

const toGpsSample = (source) => {
  if (!source) return null;
  const latitude = Number(source.latitude ?? source.coords?.latitude);
  const longitude = Number(source.longitude ?? source.coords?.longitude);
  const accuracy = Number(source.accuracy ?? source.coords?.accuracy);
  if (![latitude, longitude, accuracy].every(Number.isFinite) || accuracy < 0) return null;
  return { latitude, longitude, accuracy };
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
  const [maximumGpsAccuracy, setMaximumGpsAccuracy] = useState(100);
  const [permissionPrompt, setPermissionPrompt] = useState(null);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [selfieChecking, setSelfieChecking] = useState(false);
  const [selfieReport, setSelfieReport] = useState(null);
  const attendanceCaptureRef = useRef(0);

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

const { coords, distance, isInside, accuracy, error: locationError, matchedLocation } = useLocation(
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

  const getGPS = (seedCoords = null) => new Promise((resolve, reject) => {
    if (!window.isSecureContext)
      return reject(new Error('GPS requires a secure HTTPS connection.'));
    if (!navigator.geolocation)
      return reject(new Error('Geolocation is not supported on this device.'));
    setGpsLoading(true);
    let bestSample = toGpsSample(seedCoords);
    let settled = false;
    let watchId;
    let improveTimer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.clearTimeout(improveTimer);
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      setGpsLoading(false);
      callback(value);
    };
    const accept = (sample) => {
      setGpsCoords(sample);
      setGpsError('');
      finish(resolve, sample);
    };
    const recordingLimit = Math.max(GPS_RECORDING_LIMIT_METERS, maximumGpsAccuracy);
    const acceptIfReady = (force = false) => {
      if (!bestSample) return false;
      if (bestSample.accuracy <= maximumGpsAccuracy) {
        accept(bestSample);
        return true;
      }
      if (force && bestSample.accuracy <= recordingLimit) {
        accept(bestSample);
        return true;
      }
      if (!force) return false;
      const message = `Your GPS is ±${Math.round(bestSample.accuracy)}m. A smaller number is more precise. Smartrack can record a fix within ±${recordingLimit}m. Enable Precise Location and try near a window.`;
      setGpsError(message);
      finish(reject, new Error(message));
      return true;
    };
    const noteSample = (sample) => {
      if (!sample) return;
      if (!bestSample || sample.accuracy < bestSample.accuracy) bestSample = sample;
      if (bestSample.accuracy <= Math.min(maximumGpsAccuracy, 35)) {
        accept(bestSample);
        return;
      }
      if (improveTimer != null) return;
      if (bestSample.accuracy <= maximumGpsAccuracy) {
        improveTimer = window.setTimeout(() => acceptIfReady(false), 6000);
      } else if (bestSample.accuracy <= recordingLimit) {
        improveTimer = window.setTimeout(() => acceptIfReady(true), 10000);
      }
    };
    const seedIsReady = bestSample && bestSample.accuracy <= maximumGpsAccuracy;
    const timeoutId = window.setTimeout(() => {
      if (acceptIfReady(true)) return;
      const message = 'GPS request timed out. Enable precise location, move near a window or outdoors, then try again.';
      setGpsError(message);
      finish(reject, new Error(message));
    }, seedIsReady ? 8000 : 45000);
    noteSample(bestSample);
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        noteSample(toGpsSample(pos.coords));
      },
      (error) => {
        if (error.code === 1) {
          const message = 'GPS access denied. Enable location and precise-location permission in your browser settings.';
          setGpsError(message);
          finish(reject, new Error(message));
          return;
        }
        if (acceptIfReady(false)) return;
        if (error.code === 2 && !bestSample) {
          const message = 'GPS position is unavailable. Move to an open area and try again.';
          setGpsError(message);
          finish(reject, new Error(message));
        }
      },
      { enableHighAccuracy: true, maximumAge: 2500, timeout: 60000 }
    );
  });

  const openProofCapture = async () => {
    setCameraError('');
    setSelfieReport(null);
    setShowCamera(true);
    setCapturedSelfie(null);
    if (!window.isSecureContext) {
      setCameraError('Camera needs a secure HTTPS connection. Live selfie is required for Time In — uploads are not accepted.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera is not available on this device. Live selfie is required — please use a device with a camera.');
      return;
    }
    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      // Front camera: Time In/Out proof is a live selfie, never an upload.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
      else stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      setCameraError(error.name === 'NotAllowedError'
        ? 'Camera access denied. Enable the camera in your browser settings — a live selfie is required.'
        : 'Unable to start the camera. A live selfie is required — please try again.');
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setShowCamera(false);
  };

  const captureSelfie = async () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || video.readyState < 2 || !video.videoWidth) {
      showToast('Camera is still starting. Please try again.', 'warning');
      return;
    }
    if (selfieChecking) return;
    setSelfieChecking(true);
    setCameraError('');
    try {
      const scale = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      // Mirror the preview so the selfie matches what the user sees.
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const result = await validateSelfie(dataUrl);
      if (!result.ok) {
        setSelfieReport(result);
        setCameraError(result.reason || 'That selfie was rejected. Please retake it.');
        showToast(result.reason || 'Selfie rejected. Please retake.', 'error');
        return;
      }
      setSelfieReport(result);
      setCapturedSelfie(dataUrl);
      stopCamera();
    } catch {
      setCameraError('Could not check that selfie. Please retake it in good lighting.');
    } finally {
      setSelfieChecking(false);
    }
  };

  const beginAttendanceCapture = async (action) => {
    const captureId = ++attendanceCaptureRef.current;
    setPermissionBusy(true);
    setCurrentAction(action);
    setGpsError('');
    try {
      const challenge = await getAttendanceChallenge(action);
      if (captureId !== attendanceCaptureRef.current) return;
      setAttendanceChallenge(challenge.data.token);
      const sample = await getGPS(coords);
      if (captureId !== attendanceCaptureRef.current) return;
      if (sample.accuracy > maximumGpsAccuracy) {
        showToast(`Location recorded at ±${Math.round(sample.accuracy)}m. Smaller numbers are more precise. Staff will see this as low GPS accuracy.`, 'warning');
      }
      await openProofCapture();
      setPermissionPrompt(null);
    }
    catch (error) {
      if (captureId !== attendanceCaptureRef.current) return;
      setCurrentAction(null);
      const denied = /denied|permission/i.test(error.message || '');
      if (denied) setPermissionPrompt({ action, denied: true, message: error.message });
      else showToast(error.message || 'Unable to start attendance verification.', 'error');
    }
    finally {
      if (captureId === attendanceCaptureRef.current) setPermissionBusy(false);
    }
  };

  const cancelAttendanceCapture = () => {
    attendanceCaptureRef.current += 1;
    stopCamera();
    setPermissionPrompt(null);
    setCurrentAction(null);
    setPermissionBusy(false);
    setCapturedSelfie(null);
    setCameraError('');
    setSelfieChecking(false);
    setSelfieReport(null);
  };

  const handleInitiateAction = async (action) => {
    let permissionsGranted = false;
    if (navigator.permissions?.query) {
      try {
        const locationPermission = await navigator.permissions.query({ name: 'geolocation' });
        permissionsGranted = locationPermission.state === 'granted';
      } catch { /* Some mobile browsers do not expose camera permission state. */ }
    }
    if (permissionsGranted) await beginAttendanceCapture(action);
    else setPermissionPrompt({ action, denied: false });
  };

  useEffect(() => () => {
    if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(track => track.stop());
  }, []);

  const handleSubmitAction = async () => {
    if (!capturedSelfie) return showToast('Please take a live selfie to continue.', 'error');
    if (!gpsCoords) return showToast('GPS not found.', 'error');

    if (currentAction === 'out' && !showEvidenceModal) {
      setShowEvidenceModal(true);
      return;
    }

    setActionLoading(true);
    setSubmitError('');
    try {
      // Final AI gate: reject blurred or faceless selfies even if capture was bypassed.
      const finalCheck = await validateSelfie(capturedSelfie);
      if (!finalCheck.ok) {
        const message = finalCheck.reason || 'That selfie was rejected. Please retake it.';
        setSubmitError(message);
        showToast(message, 'error');
        setCapturedSelfie(null);
        setSelfieReport(finalCheck);
        await openProofCapture();
        return;
      }
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
          if (error.response?.data?.code === 'ATTENDANCE_CHALLENGE_INVALID') {
            const challenge = await getAttendanceChallenge('in');
            payload.attendanceChallenge = challenge.data.token;
            setAttendanceChallenge(challenge.data.token);
            response = await clockIn(payload);
          } else if (/already timed in/i.test(error.response?.data?.message || '')) {
            response = error.response;
          } else if (error.response) throw error;
          else {
            await queueAttendance('in', payload);
            showToast('Time In saved offline. It will synchronize automatically.', 'warning');
          }
        }
        if (response?.data?.record) setTodayRecord(response.data.record);
        if (response?.data) {
          setLatestReceipt(response.data.receipt || null);
          showToast(response.data.message || 'Timed in.', response.data.isValid === false || response.data.alreadyRecorded ? 'warning' : 'success');
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
      setSelfieReport(null); setSelfieChecking(false);
      setEvidenceUrl(null); setEvidenceNote(''); setShowEvidenceModal(false); setSubmitError('');
      if (navigator.onLine) await fetchData();
    } catch (err) {
      const message = err.response?.data?.message || 'Action failed.';
      setSubmitError(message);
      showToast(message, 'error');
    }
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

  // Cooler home helpers — greeting, date, remaining hours, status
  const hourNow = new Date().getHours();
  const greeting = hourNow < 12 ? 'Good morning' : hourNow < 18 ? 'Good afternoon' : 'Good evening';
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const remainingHours = Math.max(0, Number(requiredHours || 0) - Number(totalRendered || 0));
  const firstName = user?.first_name || 'Trainee';
  const dutyStatus = isClockedIn
    ? { label: 'On duty', tone: 'on' }
    : isClockedOut
      ? { label: 'Day complete', tone: 'done' }
      : { label: 'Ready to clock in', tone: 'ready' };
  const motivation = progressPercent >= 100
    ? 'OJT hours complete — nice work!'
    : progressPercent >= 75
      ? 'Final stretch — finish strong.'
      : progressPercent >= 40
        ? 'Great momentum — keep it going.'
        : progressPercent > 0
          ? 'Good start — every hour counts.'
          : 'Clock in to start earning hours today.';

  const NAV = [
    { key: 'dashboard', icon: <VectorIcon name="home" size={20} />, label: 'Home' },
    { key: 'documents', icon: <VectorIcon name="document" size={20} />, label: 'Docs' },
    { key: 'tasks', icon: <VectorIcon name="clipboard" size={20} />, label: 'Tasks' },
    { key: 'attendance', icon: <VectorIcon name="calendar" size={20} />, label: 'Leave' },
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
        ) : activePage === 'tasks' ? (
          <Suspense fallback={<SkeletonPage variant="list" />}><StudentDailyTasks onToast={showToast} /></Suspense>
        ) : activePage === 'attendance' ? (
          <Suspense fallback={<SkeletonPage variant="list" />}><AttendanceExceptionsPage /></Suspense>
        ) : activePage === 'completion' ? (
          <Suspense fallback={<SkeletonPage variant="list" />}><CompletionPanel /></Suspense>
        ) : activePage === 'profile' ? (
          <Suspense fallback={<SkeletonPage variant="profile" />}><ProfilePage /></Suspense>
        ) : (
          <>
            <section className="ojt-hero" aria-label="OJT home summary">
              <div className="ojt-hero-bg" aria-hidden="true" />
              <div className="ojt-hero-top">
                <span className="ojt-hero-date"><VectorIcon name="calendar" size={13} /> {todayLabel}{deployment?.company_name ? ` · ${deployment.company_name}` : ''}</span>
              </div>
              <div className="ojt-hero-main">
                <div className="ojt-hero-copy">
                  <p className="ojt-greeting">{greeting},</p>
                  <h1 className="ojt-name">{firstName}</h1>
                  <p className="ojt-motivation">{motivation}</p>
                </div>
                <div className="ojt-hero-percent">
                  <strong>{progressPercent.toFixed(0)}%</strong>
                  <span>{totalRendered}h of {requiredHours}h</span>
                </div>
              </div>
              <div className="ojt-progress-track" role="progressbar" aria-valuenow={Math.round(progressPercent)} aria-valuemin={0} aria-valuemax={100} aria-label="OJT progress">
                <div className="ojt-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="ojt-hero-meta">
                <span><VectorIcon name="trending" size={13} /> {remainingHours}h remaining</span>
                <span><VectorIcon name="clock" size={13} /> In: {formatTime(todayRecord?.clock_in)} · Out: {formatTime(todayRecord?.clock_out)}</span>
              </div>
            </section>

            {/* Today's tasks — first, so you know the work before timing in */}
            <Suspense fallback={null}>
              <StudentDailyTasks compact onToast={showToast} onOpenAll={() => setActivePage('tasks')} />
            </Suspense>

            {/* Today's shift — the one place to time in / out */}
            <section className="card shift-card" aria-label="Today's shift">
              <div className="shift-head">
                <div>
                  <div className="card-title" style={{ marginBottom: '0.15rem' }}>Today's shift</div>
                  <div className="shift-times">
                    In {formatTime(todayRecord?.clock_in)} · Out {formatTime(todayRecord?.clock_out)}
                    {todayRecord?.clock_out ? ` · ${formatDurationHours(todayRecord.total_hours)}` : ''}
                  </div>
                </div>
                <span className={`ojt-status ojt-status-${dutyStatus.tone}`}>
                  <span className="ojt-status-dot" aria-hidden="true" />
                  {dutyStatus.label}
                </span>
              </div>
              <div className="shift-actions">
                <button
                  type="button"
                  className={`shift-btn shift-btn-in${!isClockedIn && !isClockedOut ? ' is-primary' : ''}`}
                  onClick={() => handleInitiateAction('in')}
                  disabled={!!isClockedIn || !!isClockedOut || actionLoading || gpsLoading || permissionBusy}
                >
                  <VectorIcon name="clock" size={20} />
                  <span><strong>{gpsLoading || permissionBusy ? 'Getting GPS…' : 'Time In'}</strong><small>Live selfie</small></span>
                </button>
                <button
                  type="button"
                  className={`shift-btn shift-btn-out${isClockedIn ? ' is-primary' : ''}`}
                  onClick={() => handleInitiateAction('out')}
                  disabled={!isClockedIn || actionLoading || gpsLoading || permissionBusy}
                >
                  <VectorIcon name="check" size={20} />
                  <span><strong>Time Out</strong><small>Live selfie</small></span>
                </button>
              </div>
              {(gpsLoading || actionLoading) && <p className="shift-hint" role="status">Working… please wait.</p>}
            </section>

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

            {/* Exit Warning Banner */}
{exitWarning && (
  <div className="exit-banner" role="alert">
    <div className="exit-banner-row">
      <VectorIcon name="alert" size={26} />
      <div>
        <div className="exit-banner-title">You left the worksite perimeter</div>
        <div className="exit-banner-sub">Your DTR was flagged automatically · {exitDistance}m from site.</div>
      </div>
    </div>
    <button type="button" className="exit-banner-dismiss" onClick={() => setExitWarning(false)}>Dismiss</button>
  </div>
)}

            {/* Live Map — always visible so you can check the geofence before timing in */}
            <div className={`card map-card${deployment?.latitude && coords && !isInside ? ' is-outside' : ''}`}>
              <div className="map-card-head">
                <div className="card-title icon-label" style={{ margin: 0 }}>
                  <VectorIcon name="map" size={15} /> Live map
                  {coords && <span className="live-dot" aria-label="Live" title="Live" />}
                </div>
                  {deployment?.latitude ? (
                    <span className={`range-pill${!coords ? '' : isInside ? ' is-inside' : ' is-outside'}`}>
                      <span className="icon-label">
                        <VectorIcon name={!coords ? 'clock' : isInside ? 'success' : 'alert'} size={13} />
                        {!coords ? 'Locating…' : isInside ? 'In range' : 'Out of range'}
                      </span>
                    </span>
                  ) : (
                    <span className="range-pill">No worksite yet</span>
                  )}
                </div>
                {!coords && (
                  <p className="map-waiting" role="status">Waiting for your GPS… the worksite geofence below shows where to stand before Time In.</p>
                )}
                {deployment?.latitude && coords && !isInside && (
                  <p className="map-outside-note" role="status">
                    You are outside {matchedLocation?.name ? `${matchedLocation.name} ` : 'all approved worksites '}
                    ({distance !== null ? `${distance}m away` : 'locating…'}). Clock-ins may be flagged.
                  </p>
                )}
                <Suspense fallback={<SkeletonPage variant="map" />}><LocationMap
                  studentLat={coords?.latitude}
                  studentLng={coords?.longitude}
                  accuracy={accuracy}
                  officeLat={matchedLocation?.latitude || deployment?.latitude}
                  officeLng={matchedLocation?.longitude || deployment?.longitude}
                  radiusMeters={matchedLocation?.geoRadiusMeters || deployment?.geo_radius_meters}
                  isInside={isInside}
                /></Suspense>
                <p className="map-foot">
                  <span className="icon-label"><VectorIcon name="map" size={13} /> Auto-recorded · you can't move this pin</span>
                  {deployment?.company_name && <span className="icon-label"><VectorIcon name="building" size={13} /> {deployment.company_name}</span>}
                </p>
                {coords ? (
                  <p className="map-accuracy">
                    <span className={`gps-dot${accuracy <= 10 ? ' is-great' : accuracy <= 30 ? ' is-good' : ' is-poor'}`} aria-hidden="true" />
                    <span>GPS ±{accuracy}m{accuracy <= 10 ? ' · Excellent' : accuracy <= 30 ? ' · Good' : accuracy <= 100 ? ' · Fair' : ' · Poor'}</span>
                  </p>
                ) : (
                  <p className="map-accuracy"><span>Enable location to see yourself on the map.</span></p>
                )}
              </div>

            {/* Anomaly */}
            {todayRecord?.anomaly_flag && (
              <div className="notice-banner is-warning" role="status">
                <span className="icon-label"><VectorIcon name="alert" size={15} /> {todayRecord.anomaly_flag}</span>
              </div>
            )}

            {/* GPS Error */}
            {(gpsError || (!coords && locationError)) && (
              <div className="notice-banner is-danger" role="alert">{gpsError || locationError}</div>
            )}

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
                ? 'Smartrack cannot verify attendance until location access is enabled. A company photo is also required.'
                : `To ${permissionPrompt.action === 'in' ? 'time in' : 'time out'}, Smartrack records your current location automatically and needs a photo as proof:`}
            </p>
            <div className="permission-list">
              <div className="permission-item">
                <div className="permission-icon" aria-hidden="true"><VectorIcon name="map" size={21} /></div>
                <div className="permission-copy">
                  <strong>Current location</strong>
                  <p>Your GPS position is recorded automatically. You cannot move or pick a different pin.</p>
                </div>
              </div>
              <div className="permission-item">
                <div className="permission-icon" aria-hidden="true"><VectorIcon name="camera" size={21} /></div>
                <div className="permission-copy">
                  <strong>Live selfie</strong>
                  <p>Face the front camera and take a selfie. Uploads are not accepted for Time In. Blurry photos and photos with no face are rejected automatically.</p>
                </div>
              </div>
            </div>
            {permissionPrompt.denied && (
              <div className="permission-help">
                Open this site in your device settings, allow Location and Camera, enable Precise Location, then return and try again. A live selfie is required.
              </div>
            )}
            {!permissionPrompt.denied && <p className="permission-privacy"><VectorIcon name="lock" size={14} /> Location is captured only for attendance. The map is view-only.</p>}
            <div className="modal-actions grid-2 attendance-modal-actions permission-actions">
              <button type="button" onClick={cancelAttendanceCapture} className="action-btn action-btn-gray" disabled={permissionBusy}>Not now</button>
              <button type="button" onClick={() => beginAttendanceCapture(permissionPrompt.action)} className="btn-primary permission-continue" disabled={permissionBusy} style={{ margin: 0 }}>
                {permissionBusy ? 'Getting location…' : permissionPrompt.denied ? 'Try again' : 'Continue'}
              </button>
            </div>
          </section>
        </div>
      )}

      {showCamera && (
        <div className="modal-overlay attendance-modal-overlay">
          <div className="modal-content attendance-modal-content">
            <div className="modal-handle" />
            <div className="modal-title">{currentAction === 'in' ? 'Time In' : 'Time Out'} — Live selfie</div>
            <p className="permission-summary" style={{ marginBottom: '0.85rem' }}>
              Take a live selfie with the front camera. Uploads are disabled{currentAction === 'in' ? ' for Time In' : ''}.
              Blurry photos and photos with no face are rejected automatically. Location is already recorded and cannot be changed.
            </p>
            <div className="selfie-ai-pills" aria-label="Selfie requirements">
              <span className="selfie-ai-pill"><VectorIcon name="user" size={13} /> Face required</span>
              <span className="selfie-ai-pill"><VectorIcon name="eye" size={13} /> No blur</span>
              <span className="selfie-ai-pill"><VectorIcon name="camera" size={13} /> Live only</span>
            </div>
            <video ref={videoRef} autoPlay playsInline muted style={{
              width: '100%', borderRadius: 'var(--radius-lg)', background: '#000', maxHeight: '42vh', objectFit: 'cover',
              transform: 'scaleX(-1)',
            }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            {selfieChecking && <div className="selfie-ai-checking" role="status">Checking selfie — blur and face detection…</div>}
            {cameraError && <div className="permission-help" role="alert">{cameraError}</div>}
            <div className="modal-actions grid-2 attendance-modal-actions" style={{ marginTop: '1rem' }}>
              <button type="button" onClick={cancelAttendanceCapture}
                className="action-btn action-btn-gray" style={{ padding: '0.875rem' }} disabled={selfieChecking}>Cancel</button>
              <button type="button" onClick={captureSelfie} className="btn-primary" style={{ margin: 0 }} disabled={selfieChecking}>
                <span className="icon-label"><VectorIcon name="camera" size={17} /> {selfieChecking ? 'Checking…' : 'Take selfie'}</span>
              </button>
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
            <img src={capturedSelfie} alt="Selfie attendance proof" style={{ width: '100%', borderRadius: 'var(--radius-lg)', marginBottom: '0.75rem' }} />
            {selfieReport?.ok && (
              <div className="selfie-ai-pass" role="status">
                <VectorIcon name="check" size={14} />
                <span>Selfie passed — face detected{selfieReport.faceSupported ? '' : ' (basic check)'}{typeof selfieReport.blurScore === 'number' ? ` · sharpness ${selfieReport.blurScore}` : ''}</span>
              </div>
            )}
            {gpsCoords && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: '1rem' }}>
                Recorded location ±{Math.round(gpsCoords.accuracy)}m · this pin cannot be moved
              </p>
            )}
            {submitError && <div className="permission-help attendance-submit-error" role="alert">{submitError}</div>}
            <div className="modal-actions grid-2 attendance-modal-actions">
              <button type="button" onClick={() => { setCapturedSelfie(null); setSelfieReport(null); openProofCapture(); }}
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
