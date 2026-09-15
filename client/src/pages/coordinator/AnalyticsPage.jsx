import { useState, useEffect, useCallback } from 'react';
import { getOverviewAnalytics, getStudentAnalytics } from '../../api/analytics';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import VectorIcon from '../../components/common/VectorIcon';
import SkeletonPage from '../../components/common/Skeleton';
import { MetricCard } from '../../components/common/DashboardUI';
import StudentTypeahead from '../../components/common/StudentTypeahead';

const formatWeek = (value) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
  month: 'short', day: 'numeric',
});

const scoreColor = (score) => score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--danger)';

const AccurateTooltip = ({ active, payload, label, type }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  const rows = type === 'attendance'
    ? [['Expected completed days', point.expectedDays], ['Scheduled present', point.scheduledPresentDays], ['Additional verified', point.additionalVerifiedDays], ['Total verified', point.presentDays], ['Schedule-derived absent', point.absentDays], ['Late arrivals', point.lateDays], ['Scheduled attendance rate', point.attendanceRate == null ? 'No completed days' : `${point.attendanceRate}%`]]
    : type === 'hours'
      ? [['Verified cumulative', `${point.cumulativeHours}h`], ['Planned pace', point.plannedHours == null ? 'No end date' : `${point.plannedHours}h`], ['Completed', `${point.hoursProgress}%`]]
      : type === 'documents'
        ? [['Submitted', `${point.documentsSubmitted}/${point.totalDocuments}`], ['Approved', `${point.documentsApproved}/${point.totalDocuments}`]]
        : type === 'prediction'
          ? [['Actual score', point.actualScore == null ? 'Future week' : `${point.actualScore}/100`], ['Predicted score', point.predictedScore == null ? 'Not forecast' : `${point.predictedScore}/100`]]
          : [['Actual score', point.evaluationScore == null ? 'No evaluation' : `${point.evaluationScore}/100`]];
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px',
      padding: '0.75rem 0.875rem', boxShadow: '0 10px 30px rgba(15,23,42,0.14)', minWidth: '165px',
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.78rem', marginBottom: '0.5rem', color: 'var(--text)' }}>
        Week of {formatWeek(label)}
      </div>
      {rows.map(([name, value]) => (
        <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-2)', marginTop: '0.25rem' }}>
          <span>{name}</span><strong style={{ color: 'var(--text)' }}>{value}</strong>
        </div>
      ))}
    </div>
  );
};

const chartCardStyle = {
  marginBottom: '0.875rem', overflow: 'hidden',
  background: 'linear-gradient(145deg, var(--surface) 0%, var(--surface-2) 160%)',
};

const AnalyticsPage = ({ students, onOpenStudents, onOpenProgress, onOpenRisks }) => {
  const [view, setView] = useState('overview');
  const [overviewData, setOverviewData] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(''), 6000); }, []);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOverviewAnalytics();
      setOverviewData(res.data);
    } catch (error) {
      showToast(error.response?.data?.message || 'Could not reach the analytics service. Please try again.');
    }
    finally { setLoading(false); }
  }, [showToast]);

  const fetchStudentAnalytics = async (id) => {
    if (!id) return;
    setLoading(true);
    setStudentData(null);
    try {
      const res = await getStudentAnalytics(id);
      setStudentData(res.data);
    } catch (error) {
      showToast(error.response?.data?.message || 'Could not reach the analytics service. Please try again.');
    }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (view === 'overview') fetchOverview();
  }, [view, fetchOverview]);

  const formatAnalysis = (text) => {
    if (!text) return null;
    const normalized = String(text).replace(/\r\n/g, '\n').trim();
    const chunks = normalized.split(/\n(?=(?:\d+\.\s*)?(?:\*{1,2}|#{1,3}\s+)?[A-Z][A-Z /&-]{3,})/);
    const sections = chunks.filter(Boolean);
    return sections.map((section, i) => {
      const lines = section.trim().split('\n');
      const rawTitle = lines[0]
        .replace(/^\d+\.\s*/, '')
        .replace(/^#{1,3}\s*/, '')
        .replace(/\*/g, '')
        .trim();
      const content = lines.slice(1).join('\n').trim();
      const looksLikeHeading = rawTitle.length < 72 && /[A-Z]/.test(rawTitle);
      const title = content || looksLikeHeading ? rawTitle : 'Summary';
      const body = content || (title === 'Summary' ? rawTitle : '');

      const isRating = /RATING|SUMMARY|COHORT SUMMARY/i.test(title);
      const isBad = /At Risk|Needs Improvement|Needs Intervention/i.test(`${title}\n${body}`);
      const isGood = /Excellent|Very Good|Good/i.test(body) && !isBad;

      return (
        <div key={`${title}-${i}`} style={{
          marginBottom: '1rem',
          padding: '1rem 1.1rem',
          background: isRating ? (isBad ? 'var(--danger-light)' : isGood ? 'var(--success-light)' : 'var(--primary-light)') : 'var(--bg)',
          borderRadius: 'var(--radius-lg)',
          borderLeft: `3px solid ${isRating ? (isBad ? 'var(--danger)' : isGood ? 'var(--success)' : 'var(--primary)') : 'var(--border)'}`,
        }}>
          <div style={{
            fontWeight: 700, fontSize: '0.82rem', color: 'var(--primary)',
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: body ? '0.5rem' : 0,
          }}>{title}</div>
          {body && (
            <div style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {body}
            </div>
          )}
        </div>
      );
    });
  };

  const analysisSourceLabel = source => (
    source === 'claude'
      ? 'Claude analysis from live attendance, hours, documents, and evaluations'
      : 'Local report from live records. Claude is not connected on this server yet.'
  );

  const analyzableStudents = (students || []).filter(student => student.deployment_id);

  return (
    <div>
      {/* View Toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => setView('overview')} style={{
          padding: '0.5rem 1rem', fontWeight: 600, fontSize: '0.85rem',
          background: view === 'overview' ? 'var(--primary)' : 'var(--surface-2)',
          color: view === 'overview' ? '#fff' : 'var(--text-2)',
          border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
        }}>Cohort Overview</button>
        <button onClick={() => setView('student')} style={{
          padding: '0.5rem 1rem', fontWeight: 600, fontSize: '0.85rem',
          background: view === 'student' ? 'var(--primary)' : 'var(--surface-2)',
          color: view === 'student' ? '#fff' : 'var(--text-2)',
          border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
        }}>Individual Student</button>
      </div>

      {/* Overview */}
      {view === 'overview' && (
        <>
          {loading ? (
            <SkeletonPage variant="dashboard" label="Analyzing cohort" />
          ) : overviewData ? (
            <>
              {/* Stats */}
              <div className="stat-grid stat-grid-3" style={{ marginBottom: '0.875rem' }}>
                <MetricCard
                  label="Total Students"
                  value={overviewData.stats.totalStudents}
                  onClick={onOpenStudents}
                />
                <MetricCard
                  label="Avg Progress"
                  value={`${overviewData.stats.avgProgress}%`}
                  onClick={onOpenProgress || onOpenStudents}
                />
                <MetricCard
                  label="At Risk"
                  value={overviewData.stats.atRisk}
                  tone="danger"
                  onClick={onOpenRisks}
                />
              </div>

              {/* AI Analysis */}
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: 'var(--primary)', color: 'var(--on-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.9rem', flexShrink: 0,
                  }}><VectorIcon name="bot" size={18} /></div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                      {overviewData.analysisSource === 'claude' ? 'Claude analysis' : 'Cohort performance report'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                      {analysisSourceLabel(overviewData.analysisSource)}
                    </div>
                  </div>
                  <button onClick={fetchOverview} style={{
                    marginLeft: 'auto', padding: '0.35rem 0.75rem',
                    background: 'var(--primary-light)', color: 'var(--primary)',
                    border: 'none', borderRadius: 'var(--radius)',
                    cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                  }}><span className="icon-label"><VectorIcon name="refresh" size={15} /> Refresh</span></button>
                </div>
                {formatAnalysis(overviewData.analysis)}
              </div>
            </>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <button onClick={fetchOverview} className="btn-primary" style={{ width: 'auto', padding: '0.875rem 2rem' }}>
                Generate AI Analytics
              </button>
            </div>
          )}
        </>
      )}

      {/* Individual Student */}
      {view === 'student' && (
        <>
          <div className="card" style={{ marginBottom: '0.875rem' }}>
            <div className="card-title">Select a deployed student</div>
            <div className="analytics-student-controls">
              <StudentTypeahead
                id="analytics-find-student"
                students={analyzableStudents}
                value={studentSearch}
                onChange={(next) => {
                  setStudentSearch(next);
                  if (!next) {
                    setSelectedStudent('');
                    setStudentData(null);
                  }
                }}
                onSelect={(student) => {
                  setStudentSearch(`${student.first_name || ''} ${student.last_name || ''}`.trim());
                  setSelectedStudent(student.id);
                  setStudentData(null);
                }}
                label="Find student"
                placeholder="Type a name to see matching students"
              />
              <button onClick={() => fetchStudentAnalytics(selectedStudent)}
                disabled={!selectedStudent || loading || !analyzableStudents.length}
                type="button"
                className="btn-primary analytics-student-analyze" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                {loading ? 'Analyzing…' : 'Analyze student'}
              </button>
            </div>
          </div>

          {loading ? (
            <SkeletonPage variant="dashboard" label="Analyzing student" />
          ) : studentData ? (
            <>
              {/* Student Stats */}
              <div className="stat-grid stat-grid-3" style={{ marginBottom: '0.875rem' }}>
                {[
                  { label: 'Performance', value: `${studentData.performance.score}`, color: scoreColor(studentData.performance.score) },
                  { label: 'Hours', value: `${studentData.stats.totalHours}h`, color: 'var(--success)' },
                  { label: 'Flags', value: studentData.stats.anomalyDays, color: 'var(--danger)' },
                ].map(s => (
                  <div key={s.label} className="stat-card">
                    <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
                    <div className="stat-label">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ marginBottom: '0.875rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div>
                    <div className="card-title" style={{ marginBottom: '0.2rem' }}>Schedule-based Attendance</div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.75rem' }}>
                      {studentData.stats.attendance.workStartTime}–{studentData.stats.attendance.workEndTime} · {studentData.stats.attendance.lateGraceMinutes}-minute grace
                    </div>
                  </div>
                  <strong style={{ color: scoreColor(studentData.stats.attendance.attendanceRate), fontSize: '1.15rem' }}>
                    {studentData.stats.attendance.attendanceRate}%
                  </strong>
                </div>
                <div className="stat-grid stat-grid-2">
                  {[
                    { label: 'Verified DTR Days', value: studentData.stats.attendance.verifiedDays },
                    { label: 'Completed Schedule', value: `${studentData.stats.attendance.scheduledPresentDays}/${studentData.stats.attendance.expectedDays}` },
                    { label: 'Schedule-derived Absences', value: studentData.stats.attendance.absentDays },
                    { label: 'Punctuality', value: `${studentData.stats.attendance.punctualityRate}%` },
                  ].map(item => (
                    <div key={item.label} className="stat-card" style={{ padding: '0.7rem' }}>
                      <div style={{ fontWeight: 800, color: 'var(--primary)' }}>{item.value}</div>
                      <div className="stat-label">{item.label}</div>
                    </div>
                  ))}
                </div>
                {studentData.stats.attendance.additionalVerifiedDays > 0 && (
                  <div style={{ marginTop: '.65rem', color: 'var(--text-2)', fontSize: '.78rem' }}>
                    {studentData.stats.attendance.additionalVerifiedDays} additional verified day{studentData.stats.attendance.additionalVerifiedDays === 1 ? '' : 's'} counted as present, but outside the completed schedule (current/in-progress or off-schedule).
                  </div>
                )}
              </div>

              {/* Holistic performance score */}
              <div className="card" style={{ marginBottom: '0.875rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                  <div>
                    <div className="card-title" style={{ marginBottom: '0.2rem' }}>Automated Performance Score</div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.78rem' }}>
                      Weighted from attendance, rendered hours, documents, and supervisor evaluations
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '1.75rem', fontWeight: 800, color: scoreColor(studentData.performance.score) }}>
                      {studentData.performance.score}<span style={{ fontSize: '0.85rem' }}>/100</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: scoreColor(studentData.performance.score) }}>
                      {studentData.performance.rating}
                    </div>
                  </div>
                </div>
                {studentData.performance.components.map(component => (
                  <div key={component.key} style={{ marginBottom: '0.75rem', opacity: component.available ? 1 : 0.55 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
                      <span>{component.label} ({component.effectiveWeight}% weight)</span>
                      <strong>{component.available ? `${component.score.toFixed(1)}%` : 'Awaiting data'}</strong>
                    </div>
                    <div style={{ height: '7px', borderRadius: '999px', background: 'var(--surface-2)', overflow: 'hidden' }}>
                      <div style={{ width: `${component.available ? component.score : 0}%`, height: '100%', background: scoreColor(component.score), borderRadius: '999px' }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Predictive performance outlook */}
              <div className="card" style={{ ...chartCardStyle, borderTop: '3px solid #7C3AED' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div>
                    <div className="card-title" style={{ marginBottom: '0.2rem' }}>AI Performance Forecast</div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.78rem' }}>
                      Projected from the recent holistic-score trajectory through the OJT end date
                    </div>
                  </div>
                  <span className="badge" style={{
                    background: studentData.prediction.confidence === 'High' ? 'var(--success-light)' : studentData.prediction.confidence === 'Medium' ? 'var(--warning-light)' : 'var(--danger-light)',
                    color: studentData.prediction.confidence === 'High' ? 'var(--success)' : studentData.prediction.confidence === 'Medium' ? 'var(--warning)' : 'var(--danger)',
                    whiteSpace: 'nowrap',
                  }}>{studentData.prediction.confidence} confidence</span>
                </div>

                <div className="stat-grid stat-grid-3" style={{ marginBottom: '1rem' }}>
                  {[
                    { label: 'Projected Final', value: `${studentData.prediction.projectedScore}/100` },
                    { label: 'Direction', value: studentData.prediction.direction },
                    { label: 'Weekly Change', value: `${studentData.prediction.weeklyChange > 0 ? '+' : ''}${studentData.prediction.weeklyChange}` },
                  ].map(item => (
                    <div key={item.label} className="stat-card" style={{ padding: '0.75rem' }}>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: '#7C3AED' }}>{item.value}</div>
                      <div className="stat-label">{item.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ width: '100%', height: '280px', marginBottom: '0.75rem' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={studentData.prediction.forecast} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                      <Tooltip content={<AccurateTooltip type="prediction" />} />
                      <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                      <ReferenceLine y={75} stroke="#CBD5E1" strokeDasharray="4 4" label={{ value: '75 benchmark', position: 'insideTopRight', fill: '#94A3B8', fontSize: 11 }} />
                      <Line type="linear" dataKey="actualScore" name="Actual holistic score" stroke="#2563EB" strokeWidth={3} dot={{ r: 4 }} connectNulls={false} />
                      <Line type="linear" dataKey="predictedScore" name="AI projection" stroke="#7C3AED" strokeWidth={3} strokeDasharray="7 5" dot={{ r: 4, fill: '#7C3AED' }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div style={{
                  background: 'rgba(124,58,237,0.08)', borderRadius: '12px', padding: '0.875rem 1rem',
                  color: 'var(--text-2)', fontSize: '0.86rem', lineHeight: 1.65,
                }}>
                  {studentData.prediction.narrative}
                </div>
                <div style={{ color: 'var(--text-3)', fontSize: '0.7rem', lineHeight: 1.5, marginTop: '0.75rem' }}>
                  Forecasts are estimates based on current records and recent trajectory. They update whenever attendance, hours, documents, or evaluations change and should support—not replace—coordinator judgment.
                </div>
              </div>

              {/* Weekly natural-language report */}
              <div className="card" style={{ marginBottom: '0.875rem', borderLeft: '3px solid var(--primary)' }}>
                <div className="card-title" style={{ marginBottom: '0.5rem' }}>Weekly Performance Narrative</div>
                <p style={{ margin: 0, color: 'var(--text-2)', fontSize: '0.9rem', lineHeight: 1.7 }}>
                  {studentData.weeklyNarrative}
                </p>
              </div>

              {/* Accurate, source-specific performance charts */}
              {studentData.stats.weeklyTrend.length ? (
                <>
                  <div className="card" style={chartCardStyle}>
                    <div className="card-title">Scheduled Attendance</div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.78rem', marginBottom: '1rem' }}>
                      Presence and absence measured against configured workdays. The current day is counted only after the shift ends.
                    </div>
                    <div style={{ width: '100%', height: '250px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={studentData.stats.weeklyTrend} margin={{ top: 8, right: 8, left: -22, bottom: 8 }} barCategoryGap="24%">
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                          <Tooltip content={<AccurateTooltip type="attendance" />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
                          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                          <Bar dataKey="scheduledPresentDays" name="Scheduled present" stackId="attendance" fill="#2563EB" radius={[6, 6, 0, 0]} />
                          <Bar dataKey="additionalVerifiedDays" name="Additional verified" stackId="attendance" fill="#10B981" radius={[6, 6, 0, 0]} />
                          <Bar dataKey="absentDays" name="Absent" stackId="attendance" fill="#F97316" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="card" style={chartCardStyle}>
                    <div className="card-title">Verified Hours vs Planned Pace</div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.78rem', marginBottom: '1rem' }}>
                      Cumulative valid DTR hours compared with a calendar-based pace from deployment start to end date.
                    </div>
                    <div style={{ width: '100%', height: '280px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={studentData.stats.weeklyTrend} margin={{ top: 8, right: 8, left: -12, bottom: 8 }}>
                          <defs>
                            <linearGradient id="verifiedHoursFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#059669" stopOpacity={0.32} />
                              <stop offset="95%" stopColor="#059669" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                          <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} unit="h" />
                          <Tooltip content={<AccurateTooltip type="hours" />} />
                          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                          <ReferenceLine y={Number(studentData.student.required_hours)} stroke="#64748B" strokeDasharray="5 5" label={{ value: 'Required', position: 'insideTopRight', fill: '#64748B', fontSize: 11 }} />
                          <Area type="monotone" dataKey="cumulativeHours" name="Verified hours" stroke="#059669" strokeWidth={3} fill="url(#verifiedHoursFill)" dot={{ r: 3, fill: '#059669' }} />
                          <Line type="linear" dataKey="plannedHours" name="Planned pace" stroke="#94A3B8" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="card" style={chartCardStyle}>
                    <div className="card-title">Required Document Output</div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.78rem', marginBottom: '1rem' }}>
                      Exact cumulative counts of submitted and coordinator-approved requirements.
                    </div>
                    <div style={{ width: '100%', height: '240px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={studentData.stats.weeklyTrend} margin={{ top: 8, right: 8, left: -22, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                          <YAxis allowDecimals={false} domain={[0, Math.max(1, studentData.stats.totalDocs)]} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                          <Tooltip content={<AccurateTooltip type="documents" />} />
                          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                          <ReferenceLine y={studentData.stats.totalDocs} stroke="#94A3B8" strokeDasharray="5 5" />
                          <Line type="stepAfter" dataKey="documentsSubmitted" name="Submitted" stroke="#D97706" strokeWidth={3} dot={{ r: 3 }} />
                          <Line type="stepAfter" dataKey="documentsApproved" name="Approved" stroke="#0EA5E9" strokeWidth={3} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="card" style={chartCardStyle}>
                    <div className="card-title">Supervisor Evaluation Trajectory</div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.78rem', marginBottom: '1rem' }}>
                      Only actual submitted evaluation scores are plotted; missing weeks are never estimated.
                    </div>
                    <div style={{ width: '100%', height: '220px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={studentData.stats.weeklyTrend} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                          <Tooltip content={<AccurateTooltip type="evaluation" />} />
                          <ReferenceLine y={75} stroke="#CBD5E1" strokeDasharray="4 4" label={{ value: '75 benchmark', position: 'insideTopRight', fill: '#94A3B8', fontSize: 11 }} />
                          <Line type="linear" dataKey="evaluationScore" name="Evaluation score" stroke="#7C3AED" strokeWidth={3} dot={{ r: 6, fill: '#7C3AED', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 8 }} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </>
              ) : (
                <div className="card" style={{ color: 'var(--text-3)', textAlign: 'center', padding: '2rem', marginBottom: '0.875rem' }}>
                  No trend data available yet.
                </div>
              )}

              {/* AI Analysis */}
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: 'var(--primary)', color: 'var(--on-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.9rem', flexShrink: 0,
                  }}></div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                      {studentData.student.first_name} {studentData.student.last_name} — {
                        studentData.analysisSource === 'claude' ? 'Claude analysis' : 'Performance report'
                      }
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                      {analysisSourceLabel(studentData.analysisSource)}
                    </div>
                  </div>
                </div>
                {formatAnalysis(studentData.analysis)}
              </div>
            </>
          ) : !loading && selectedStudent && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-3)' }}>
              Choose a deployed student, then click <strong>Analyze student</strong> to generate the report.
            </div>
          )}
        </>
      )}

      {toast && (
        <div className="toast toast-error">{toast}</div>
      )}
    </div>
  );
};

export default AnalyticsPage;
