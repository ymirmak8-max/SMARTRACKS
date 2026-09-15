import Anthropic from '@anthropic-ai/sdk';
import pool from '../config/db.js';

const DEFAULT_MODELS = ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'];

const getAnthropicClient = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
};

const assignmentFilter = `(
  $2 = 'coordinator'
  OR ($2 = 'supervisor' AND d.supervisor_id = $3)
)`;

const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const startOfWeek = (value) => {
  const raw = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
  const date = new Date(raw);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
};

const weekKey = (value) => startOfWeek(value).toISOString().split('T')[0];

const dateKey = (value) => {
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().split('T')[0];
};

const businessDateKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const businessMinutesNow = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
};

export const summarizeAttendance = ({ dtr, expectedDateSet }) => {
  const verifiedDateSet = new Set(dtr
    .filter(record => record.is_valid && record.clock_in)
    .map(record => dateKey(record.date)));
  const scheduledPresentDateSet = new Set([...verifiedDateSet].filter(date => expectedDateSet.has(date)));
  const additionalVerifiedDateSet = new Set([...verifiedDateSet].filter(date => !expectedDateSet.has(date)));
  return {
    verifiedDateSet,
    scheduledPresentDateSet,
    additionalVerifiedDateSet,
    expectedDays: expectedDateSet.size,
    verifiedDays: verifiedDateSet.size,
    scheduledPresentDays: scheduledPresentDateSet.size,
    additionalVerifiedDays: additionalVerifiedDateSet.size,
    absentDays: Math.max(0, expectedDateSet.size - scheduledPresentDateSet.size),
  };
};

const calculatePerformanceScore = ({ attendanceRate, hoursProgress, documentRate, evaluationAverage, hasEvaluation }) => {
  const components = [
    { key: 'attendance', label: 'Attendance', score: clampScore(attendanceRate), weight: 30, available: true },
    { key: 'hours', label: 'Hours rendered', score: clampScore(hoursProgress), weight: 25, available: true },
    { key: 'documents', label: 'Document compliance', score: clampScore(documentRate), weight: 10, available: true },
    { key: 'evaluation', label: 'Supervisor evaluation', score: clampScore(evaluationAverage), weight: 35, available: hasEvaluation },
  ];
  const availableWeight = components.filter(item => item.available).reduce((sum, item) => sum + item.weight, 0);
  const score = components
    .filter(item => item.available)
    .reduce((sum, item) => sum + item.score * (item.weight / availableWeight), 0);
  return {
    score: Number(score.toFixed(1)),
    rating: score >= 90 ? 'Excellent' : score >= 80 ? 'Very Good' : score >= 70 ? 'Good' : score >= 60 ? 'Needs Improvement' : 'At Risk',
    components: components.map(item => ({
      ...item,
      effectiveWeight: item.available ? Number(((item.weight / availableWeight) * 100).toFixed(1)) : 0,
    })),
  };
};

const linearTrend = (values) => {
  if (values.length < 2) return { slope: 0, intercept: values[0] || 0 };
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  const numerator = values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0);
  const denominator = values.reduce((sum, _value, index) => sum + ((index - meanX) ** 2), 0);
  return { slope: denominator ? numerator / denominator : 0, intercept: meanY - (denominator ? numerator / denominator : 0) * meanX };
};

const generateAnalysis = async (prompt, fallback) => {
  const client = getAnthropicClient();
  if (!client) return { text: fallback, source: 'local' };

  const models = [
    process.env.ANTHROPIC_MODEL,
    ...DEFAULT_MODELS,
  ].filter((model, index, list) => model && list.indexOf(model) === index);

  let lastError = '';
  for (const model of models) {
    try {
      const message = await client.messages.create({
        model,
        max_tokens: 1800,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = message.content?.find(item => item.type === 'text')?.text;
      if (text?.trim()) return { text, source: 'claude' };
    } catch (error) {
      lastError = error.message;
      const retryable = error.status === 404 || /not_found|model/i.test(error.message || '');
      if (!retryable) break;
    }
  }

  console.error('AI analysis unavailable:', lastError || 'empty response');
  return { text: fallback, source: 'local' };
};

const buildStudentFallback = ({
  student, progress, totalHours, attendanceRate, absentDays, anomalyDays,
  approvedDocs, pendingDocs, docs, evals, performance, prediction,
}) => `**OVERALL PERFORMANCE SUMMARY**
${student.first_name} ${student.last_name} is at ${progress}% of required hours (${totalHours}h of ${student.required_hours}h) with a holistic score of ${performance.score}/100 (${performance.rating}). Attendance on completed workdays is ${attendanceRate.toFixed(1)}%.

**ATTENDANCE TREND ANALYSIS**
${absentDays} completed workday${absentDays === 1 ? '' : 's'} have no valid time-in, and ${anomalyDays} record${anomalyDays === 1 ? '' : 's'} still need review. Additional verified days outside the finished schedule are counted as present, not absent.

**PROGRESS TREND**
${Number(progress) >= 80 ? 'Hours are on track for completion if the current pace holds.' : Number(progress) >= 40 ? 'Hours are moving, but the student should keep a steady weekly pace to finish on time.' : 'Hours are still early or behind. A company assignment, regular time-in, and weekly hour targets will move this faster.'}

**STRENGTHS IDENTIFIED**
- ${approvedDocs} of ${docs.length} required document${docs.length === 1 ? '' : 's'} already approved
- Holistic rating: ${performance.rating}
- ${evals.length ? 'At least one supervisor evaluation is on file' : 'Attendance records can still be built before the first evaluation'}

**AREAS FOR IMPROVEMENT**
- ${anomalyDays ? 'Clear flagged attendance records with the coordinator' : 'Keep time-in and time-out consistent each scheduled day'}
- ${pendingDocs ? `${pendingDocs} document${pendingDocs === 1 ? '' : 's'} waiting for review` : 'Submit remaining requirements before the deadline'}
- ${absentDays ? 'Reduce schedule-derived absences' : 'Maintain the current attendance pattern'}

**DOCUMENT COMPLIANCE ANALYSIS**
${approvedDocs} approved, ${pendingDocs} pending review, and ${docs.filter(doc => doc.status === 'not_submitted').length} not submitted.

**EVALUATION PERFORMANCE**
${evals.length === 0 ? 'No supervisor evaluation has been submitted yet. Midterm and final scores will strengthen this report.' : evals.map(item => `- ${String(item.period).toUpperCase()}: ${item.total_score}/100${item.comments ? ` — ${item.comments}` : ''}`).join('\n')}

**AI RECOMMENDATIONS**
- Review flagged or missing attendance before the next week starts
- Ask the supervisor to submit an evaluation if one is due
- Keep weekly rendered hours aligned with the remaining required hours
- Finish outstanding documents so compliance does not lag hours

**PERFORMANCE PREDICTION**
Projected finish near ${prediction.projectedScore}/100 (${prediction.projectedRating}), ${prediction.direction.toLowerCase()} over about ${prediction.remainingWeeks} remaining week${prediction.remainingWeeks === 1 ? '' : 's'}. Confidence is ${prediction.confidence.toLowerCase()} because this is based on current records, not a guarantee.

**OVERALL PERFORMANCE RATING**
${performance.rating}`;

const buildOverviewFallback = ({ totalStudents, avgProgress, onTrack, atRisk, anomalies, students }) => `**COHORT SUMMARY**
${totalStudents ? `${totalStudents} active student${totalStudents === 1 ? '' : 's'} with ${avgProgress}% average hour progress.` : 'No students are on an active deployment yet. Approved students still need a company and supervisor before monitoring starts.'}

**ATTENDANCE TRENDS**
${anomalies ? `${anomalies} attendance flag${anomalies === 1 ? '' : 's'} in the last 30 days should be reviewed first.` : 'No recent attendance flags in the last 30 days.'}

**TOP PERFORMERS**
${students.length
    ? students
      .slice()
      .sort((a, b) => (Number(b.hours_rendered) / Math.max(1, Number(b.required_hours))) - (Number(a.hours_rendered) / Math.max(1, Number(a.required_hours))))
      .slice(0, 3)
      .map(student => `- ${student.first_name} ${student.last_name}: ${((Number(student.hours_rendered) / Math.max(1, Number(student.required_hours))) * 100).toFixed(1)}% of required hours`)
      .join('\n')
    : '- None yet — deploy a student to start the cohort'}

**STUDENTS NEEDING ATTENTION**
${atRisk ? `${atRisk} student${atRisk === 1 ? '' : 's'} are under 30% hours with very few attendance records.` : 'No deployed students currently meet the at-risk rule (under 30% hours with low attendance). Undeployed students appear under Awaiting assignment, not here.'}

**DOCUMENT COMPLIANCE OVERVIEW**
Review pending submissions after attendance flags so students are not blocked on requirements.

**TREND INSIGHTS**
${onTrack} student${onTrack === 1 ? '' : 's'} are at or above 50% hours. Use weekly hour pace and document deadlines to keep the rest moving.

**COORDINATOR RECOMMENDATIONS**
- Deploy approved students who are still waiting for a company
- Inspect open anomalies before they age past a week
- Ask supervisors for evaluations once students have enough attendance history

**OVERALL COHORT RATING**
${totalStudents === 0 ? 'Needs Intervention' : atRisk > onTrack ? 'Needs Intervention' : Number(avgProgress) >= 70 ? 'Good' : 'Fair'}`;

// GET /api/analytics/student/:id
export const getStudentAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const accessParams = [id, req.user.role, req.user.id];

    // Fetch all student data
    const [studentRes, dtrRes, docsRes, evalsRes, exceptionsRes] = await Promise.all([
      pool.query(`
        SELECT u.first_name, u.last_name, u.email, u.course, u.school,
               d.required_hours, d.start_date, d.end_date, d.work_days,
               d.work_start_time, d.work_end_time, d.late_grace_minutes,
               c.name AS company_name
        FROM users u
        JOIN deployments d ON d.student_id = u.id
        JOIN companies c ON c.id = d.company_id
        WHERE u.id = $1 AND u.role = 'student' AND d.status = 'active' AND ${assignmentFilter}
      `, accessParams),
      pool.query(`
        SELECT tr.date, tr.clock_in, tr.clock_out, tr.total_hours, tr.is_valid,
               tr.anomaly_flag, tr.is_late, tr.late_minutes
        FROM time_records tr
        JOIN deployments d ON d.id = tr.deployment_id
        WHERE tr.student_id = $1 AND ${assignmentFilter}
        ORDER BY tr.date ASC
      `, accessParams),
      pool.query(`
        SELECT dr.name, COALESCE(sd.status, 'not_submitted') AS status,
               sd.submitted_at, sd.reviewed_at
        FROM deployments d
        CROSS JOIN document_requirements dr
        LEFT JOIN student_documents sd
          ON sd.requirement_id = dr.id AND sd.student_id = d.student_id
        WHERE d.student_id = $1 AND d.status = 'active' AND ${assignmentFilter}
      `, accessParams),
      pool.query(`
        SELECT e.period, e.total_score, e.scores, e.comments, e.submitted_at
        FROM evaluations e
        JOIN deployments d ON d.id = e.deployment_id
        WHERE d.student_id = $1 AND ${assignmentFilter}
        ORDER BY e.submitted_at ASC
      `, accessParams),
      pool.query(`
        SELECT ae.exception_type, ae.date_from, ae.date_to, ae.reason
        FROM attendance_exceptions ae
        JOIN deployments d ON d.student_id = $1 AND d.status = 'active'
        WHERE ae.status = 'approved' AND ${assignmentFilter}
          AND (ae.student_id = $1 OR (
            ae.exception_type IN ('holiday', 'closure')
            AND (ae.company_id IS NULL OR ae.company_id = d.company_id)
          ))
      `, accessParams),
    ]);

    if (studentRes.rows.length === 0)
      return res.status(404).json({ message: 'This student is not on an active deployment. Assign them to a company first.' });

    const student = studentRes.rows[0];
    const dtr = dtrRes.rows;
    const docs = docsRes.rows;
    const evals = evalsRes.rows;
    const exceptions = exceptionsRes.rows;

    // Calculate stats
    const totalHours = dtr
      .filter(record => record.is_valid)
      .reduce((sum, record) => sum + (parseFloat(record.total_hours) || 0), 0)
      .toFixed(2);
    const validDays = new Set(dtr.filter(r => r.is_valid && r.clock_in).map(r => dateKey(r.date))).size;
    const anomalyDays = dtr.filter(r => r.anomaly_flag).length;
    const approvedDocs = docs.filter(d => d.status === 'approved').length;
    const pendingDocs = docs.filter(d => d.status === 'pending').length;
    const requiredHours = Number(student.required_hours);
    const progress = (requiredHours > 0 ? (Number(totalHours) / requiredHours) * 100 : 0).toFixed(1);
    const scheduledDays = Array.isArray(student.work_days) ? student.work_days.map(Number) : [1, 2, 3, 4, 5];
    const scheduleStart = new Date(`${dateKey(student.start_date || dtr[0]?.date || businessDateKey())}T00:00:00.000Z`);
    const todayKey = businessDateKey();
    const [endHour, endMinute] = String(student.work_end_time || '17:00').split(':').map(Number);
    const latestCompletedDate = new Date(`${todayKey}T00:00:00.000Z`);
    if (businessMinutesNow() < endHour * 60 + endMinute) latestCompletedDate.setUTCDate(latestCompletedDate.getUTCDate() - 1);
    const latestCompletedKey = latestCompletedDate.toISOString().split('T')[0];
    const scheduleEndKey = student.end_date && dateKey(student.end_date) < latestCompletedKey
      ? dateKey(student.end_date) : latestCompletedKey;
    const scheduleEnd = new Date(`${scheduleEndKey}T00:00:00.000Z`);
    const expectedDateSet = new Set();
    for (let cursor = new Date(scheduleStart); cursor <= scheduleEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      if (scheduledDays.includes(cursor.getUTCDay())) expectedDateSet.add(cursor.toISOString().split('T')[0]);
    }
    const excusedDateSet = new Set();
    exceptions.forEach(exception => {
      const from = new Date(`${dateKey(exception.date_from)}T00:00:00.000Z`);
      const to = new Date(`${dateKey(exception.date_to)}T00:00:00.000Z`);
      for (let cursor = from; cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const key = cursor.toISOString().split('T')[0];
        if (expectedDateSet.has(key)) excusedDateSet.add(key);
      }
    });
    excusedDateSet.forEach(key => expectedDateSet.delete(key));
    const attendanceSummary = summarizeAttendance({ dtr, expectedDateSet });
    const {
      verifiedDateSet, scheduledPresentDateSet, additionalVerifiedDateSet,
      expectedDays, verifiedDays, scheduledPresentDays, additionalVerifiedDays, absentDays,
    } = attendanceSummary;
    const lateDays = dtr.filter(record => record.is_late && expectedDateSet.has(dateKey(record.date))).length;
    const attendanceRate = expectedDays > 0 ? (scheduledPresentDays / expectedDays) * 100 : 0;
    const punctualityRate = scheduledPresentDays > 0 ? ((scheduledPresentDays - lateDays) / scheduledPresentDays) * 100 : 0;
    const documentRate = docs.length > 0 ? (approvedDocs / docs.length) * 100 : 0;
    const evaluationScores = evals.map(e => Number(e.total_score)).filter(Number.isFinite);
    const evaluationAverage = evaluationScores.length
      ? evaluationScores.reduce((sum, value) => sum + value, 0) / evaluationScores.length
      : 0;
    const performance = calculatePerformanceScore({
      attendanceRate,
      hoursProgress: Number(progress),
      documentRate,
      evaluationAverage,
      hasEvaluation: evaluationScores.length > 0,
    });

    // Weekly hours trend
    const weeklyHours = {};
    dtr.forEach(r => {
      if (!r.is_valid || !r.total_hours) return;
      const week = new Date(r.date);
      week.setDate(week.getDate() - week.getDay());
      const key = week.toISOString().split('T')[0];
      weeklyHours[key] = (weeklyHours[key] || 0) + parseFloat(r.total_hours);
    });

    // Build weekly trajectories from deployment start through the current week.
    const trendStart = startOfWeek(student.start_date || dtr[0]?.date || new Date());
    const trendEnd = startOfWeek(
      student.end_date && new Date(student.end_date) < new Date() ? student.end_date : new Date()
    );
    const deploymentStart = new Date(student.start_date || trendStart);
    const deploymentEnd = student.end_date ? new Date(student.end_date) : null;
    const deploymentDuration = deploymentEnd
      ? Math.max(1, deploymentEnd.getTime() - deploymentStart.getTime())
      : null;
    const weeklyTrend = [];
    let cumulativeHours = 0;
    let cumulativeExpectedDays = 0;
    let cumulativePresentDays = 0;
    let latestEvaluationScore = null;
    for (let cursor = new Date(trendStart), count = 0; cursor <= trendEnd && count < 104; cursor.setUTCDate(cursor.getUTCDate() + 7), count += 1) {
      const key = cursor.toISOString().split('T')[0];
      const weekRecords = dtr.filter(record => weekKey(record.date) === key);
      const weekExpectedDates = [...expectedDateSet].filter(date => weekKey(date) === key);
      const weekScheduledPresentDates = weekExpectedDates.filter(date => scheduledPresentDateSet.has(date));
      const weekAdditionalVerifiedDates = [...additionalVerifiedDateSet].filter(date => weekKey(date) === key);
      const weekVerifiedDates = [...verifiedDateSet].filter(date => weekKey(date) === key);
      const weekExcusedDates = [...excusedDateSet].filter(date => weekKey(date) === key);
      const validWeekRecords = weekRecords.filter(record => record.is_valid);
      const weekHours = validWeekRecords.reduce((sum, record) => sum + (Number(record.total_hours) || 0), 0);
      cumulativeHours += weekHours;
      const weekEvaluations = evals.filter(evaluation => weekKey(evaluation.submitted_at) === key);
      const evaluationScore = weekEvaluations.length
        ? weekEvaluations.reduce((sum, evaluation) => sum + Number(evaluation.total_score), 0) / weekEvaluations.length
        : null;
      if (Number.isFinite(evaluationScore)) latestEvaluationScore = evaluationScore;
      cumulativeExpectedDays += weekExpectedDates.length;
      cumulativePresentDays += weekScheduledPresentDates.length;
      const endOfWeek = new Date(cursor.getTime() + 7 * 86400000);
      const plannedHours = deploymentDuration
        ? requiredHours * Math.max(0, Math.min(1, (Math.min(endOfWeek.getTime(), deploymentEnd.getTime()) - deploymentStart.getTime()) / deploymentDuration))
        : null;
      const submittedByWeek = docs.filter(doc => doc.submitted_at && new Date(doc.submitted_at) < endOfWeek).length;
      const approvedByWeek = docs.filter(doc => doc.reviewed_at && doc.status === 'approved' && new Date(doc.reviewed_at) < endOfWeek).length;
      const weeklyPerformance = calculatePerformanceScore({
        attendanceRate: cumulativeExpectedDays ? (cumulativePresentDays / cumulativeExpectedDays) * 100 : 0,
        hoursProgress: requiredHours > 0 ? (cumulativeHours / requiredHours) * 100 : 0,
        documentRate: docs.length ? (approvedByWeek / docs.length) * 100 : 0,
        evaluationAverage: latestEvaluationScore || 0,
        hasEvaluation: Number.isFinite(latestEvaluationScore),
      });
      weeklyTrend.push({
        week: key,
        attendanceRate: weekExpectedDates.length ? Number(((weekScheduledPresentDates.length / weekExpectedDates.length) * 100).toFixed(1)) : null,
        expectedDays: weekExpectedDates.length,
        presentDays: weekVerifiedDates.length,
        scheduledPresentDays: weekScheduledPresentDates.length,
        additionalVerifiedDays: weekAdditionalVerifiedDates.length,
        absentDays: Math.max(0, weekExpectedDates.length - weekScheduledPresentDates.length),
        lateDays: weekRecords.filter(record => record.is_late).length,
        excusedDays: weekExcusedDates.length,
        validRecords: validWeekRecords.length,
        invalidRecords: weekRecords.length - validWeekRecords.length,
        totalRecords: weekRecords.length,
        renderedHours: Number(weekHours.toFixed(2)),
        cumulativeHours: Number(cumulativeHours.toFixed(2)),
        plannedHours: Number.isFinite(plannedHours) ? Number(plannedHours.toFixed(2)) : null,
        hoursProgress: requiredHours > 0 ? Number(Math.min(100, (cumulativeHours / requiredHours) * 100).toFixed(1)) : 0,
        documentOutput: docs.length ? Number(((submittedByWeek / docs.length) * 100).toFixed(1)) : 0,
        documentCompliance: docs.length ? Number(((approvedByWeek / docs.length) * 100).toFixed(1)) : 0,
        documentsSubmitted: submittedByWeek,
        documentsApproved: approvedByWeek,
        totalDocuments: docs.length,
        evaluationScore: Number.isFinite(evaluationScore) ? Number(evaluationScore.toFixed(1)) : null,
        performanceScore: weeklyPerformance.score,
      });
    }

    const recentScores = weeklyTrend.slice(-8).map(point => point.performanceScore);
    const scoreTrend = linearTrend(recentScores);
    const finalWeek = deploymentEnd ? startOfWeek(deploymentEnd) : trendEnd;
    const lastActualWeek = startOfWeek(weeklyTrend.at(-1)?.week || new Date());
    const remainingWeeks = Math.max(0, Math.min(26, Math.ceil((finalWeek - lastActualWeek) / (7 * 86400000))));
    const forecast = weeklyTrend.map(point => ({
      week: point.week,
      actualScore: point.performanceScore,
      predictedScore: null,
    }));
    if (forecast.length) forecast[forecast.length - 1].predictedScore = forecast.at(-1).actualScore;
    for (let index = 1; index <= remainingWeeks; index += 1) {
      const date = new Date(lastActualWeek);
      date.setUTCDate(date.getUTCDate() + index * 7);
      forecast.push({
        week: date.toISOString().split('T')[0],
        actualScore: null,
        predictedScore: Number(clampScore(recentScores.at(-1) + scoreTrend.slope * index).toFixed(1)),
      });
    }
    const projectedScore = forecast.at(-1)?.predictedScore ?? performance.score;
    const predictionConfidence = dtr.length >= 12 && evaluationScores.length >= 1
      ? 'High'
      : dtr.length >= 5 ? 'Medium' : 'Low';
    const prediction = {
      projectedScore,
      projectedRating: projectedScore >= 90 ? 'Excellent' : projectedScore >= 80 ? 'Very Good' : projectedScore >= 70 ? 'Good' : projectedScore >= 60 ? 'Needs Improvement' : 'At Risk',
      confidence: predictionConfidence,
      direction: scoreTrend.slope > 1 ? 'Improving' : scoreTrend.slope < -1 ? 'Declining' : 'Stable',
      weeklyChange: Number(scoreTrend.slope.toFixed(2)),
      remainingWeeks,
      forecast,
    };

    // Build prompt for Claude
    const prompt = `
You are an OJT (On-the-Job Training) performance analytics AI. Analyze the following student data and provide a comprehensive performance trends report.

STUDENT PROFILE:
- Name: ${student.first_name} ${student.last_name}
- Course: ${student.course || 'Not specified'}
- School: ${student.school || 'Not specified'}
- Company: ${student.company_name}
- Required Hours: ${student.required_hours}h
- Hours Rendered: ${totalHours}h (${progress}% complete)
- Start Date: ${student.start_date ? new Date(student.start_date).toLocaleDateString() : 'Not set'}

ATTENDANCE (verified DTR and completed schedule):
- Verified DTR Present Days: ${verifiedDays}
- Completed Scheduled Workdays: ${expectedDays}
- Present on Completed Scheduled Workdays: ${scheduledPresentDays}
- Additional Verified Days (current/in-progress or outside the configured schedule): ${additionalVerifiedDays}
- Schedule-derived Absences: ${absentDays}
- Unresolved Flag Days: ${anomalyDays}
- Completed-Schedule Attendance Rate: ${attendanceRate.toFixed(1)}%

Important interpretation rules:
- Verified DTR Present Days must match approved valid attendance records by unique date.
- Additional Verified Days are present days, not absences. They are separated only because the scheduled workday is not completed yet or the date is outside the configured work schedule.
- Schedule-derived Absences are completed expected workdays without a valid time-in. State that they are inferred from the configured deployment schedule.
- Never describe a coordinator-approved valid record as invalid, anomalous, or absent.

WEEKLY HOURS TREND:
${Object.entries(weeklyHours).slice(0, 6).map(([week, hours]) => `- Week of ${week}: ${hours.toFixed(2)}h`).join('\n') || 'No data yet'}

DOCUMENT COMPLIANCE:
- Total Requirements: ${docs.length}
- Approved: ${approvedDocs}
- Pending Review: ${pendingDocs}
- Not Submitted: ${docs.filter(d => d.status === 'not_submitted').length}
- Compliance Rate: ${docs.length > 0 ? ((approvedDocs / docs.length) * 100).toFixed(1) : 0}%

EVALUATION SCORES:
${evals.length === 0 ? 'No evaluations submitted yet.' : evals.map(e => {
  const scores = typeof e.scores === 'string' ? JSON.parse(e.scores) : e.scores;
  return `- ${e.period.toUpperCase()}: Overall ${e.total_score}/100
  Breakdown: ${Object.entries(scores).map(([k, v]) => `${k}=${v}`).join(', ')}
  Comments: ${e.comments || 'None'}`;
}).join('\n')}

Please provide a structured performance analytics report with the following sections:

1. **OVERALL PERFORMANCE SUMMARY** (2-3 sentences)
2. **ATTENDANCE TREND ANALYSIS** (analyze patterns, consistency, concerns)
3. **PROGRESS TREND** (is the student on track? ahead? behind?)
4. **STRENGTHS IDENTIFIED** (bullet points)
5. **AREAS FOR IMPROVEMENT** (bullet points)
6. **DOCUMENT COMPLIANCE ANALYSIS** (status and recommendation)
7. **EVALUATION PERFORMANCE** (if available, analyze scores and trends)
8. **AI RECOMMENDATIONS** (3-5 specific actionable recommendations)
9. **PERFORMANCE PREDICTION** (predict if student will complete OJT on time based on current trends)
10. **OVERALL PERFORMANCE RATING** (Excellent/Very Good/Good/Needs Improvement/At Risk)

Be specific, data-driven, and constructive. Format your response clearly with the section headers.
    `;

    const studentFallback = buildStudentFallback({
      student, progress, totalHours, attendanceRate, absentDays, anomalyDays,
      approvedDocs, pendingDocs, docs, evals, performance, prediction,
    });
    const narrativePrompt = `Write one concise weekly OJT performance narrative (2-3 sentences) for ${student.first_name} ${student.last_name}. Use this holistic score: ${performance.score}/100 (${performance.rating}); attendance: ${attendanceRate.toFixed(1)}%; hours completion: ${progress}%; document compliance: ${documentRate.toFixed(1)}%; supervisor evaluation average: ${evaluationScores.length ? evaluationAverage.toFixed(1) : 'not yet available'}. Supervisor feedback: ${evals.map(e => e.comments).filter(Boolean).join(' | ') || 'none provided'}. Mention one strength and one actionable improvement. Do not use headings or bullet points.`;
    const narrativeFallback = `${student.first_name} has completed ${progress}% of the required hours with ${attendanceRate.toFixed(1)}% valid attendance and a holistic performance score of ${performance.score}/100 (${performance.rating}). ${anomalyDays ? 'Improving punctuality and resolving flagged attendance records should be the next priority.' : 'Attendance is consistent; the next priority is maintaining progress and completing outstanding documents.'}`;
    const predictionPrompt = `Write a concise predictive OJT performance outlook (2-3 sentences) for ${student.first_name} ${student.last_name}. Current holistic score: ${performance.score}/100. Data-driven projected final score: ${prediction.projectedScore}/100 (${prediction.projectedRating}); direction: ${prediction.direction}; model confidence: ${prediction.confidence}; estimated weeks remaining: ${prediction.remainingWeeks}. Base the explanation on verified attendance ${attendanceRate.toFixed(1)}%, valid hours completion ${progress}%, document compliance ${documentRate.toFixed(1)}%, and evaluation average ${evaluationScores.length ? evaluationAverage.toFixed(1) : 'not available'}. Clearly state that this is a projection, mention the most important risk or opportunity, and do not claim certainty.`;
    const predictionFallback = `Based on the current verified records, the student is projected to finish near ${prediction.projectedScore}/100 (${prediction.projectedRating}), with ${prediction.confidence.toLowerCase()} confidence and a ${prediction.direction.toLowerCase()} trajectory. This is a projection rather than a guaranteed result; ${anomalyDays ? 'resolving attendance flags and maintaining valid weekly hours would improve the outlook.' : 'maintaining verified weekly hours and completing remaining document requirements would strengthen the outlook.'}`;

    const [analysisResult, narrativeResult, predictionResult] = await Promise.all([
      generateAnalysis(prompt, studentFallback),
      generateAnalysis(narrativePrompt, narrativeFallback),
      generateAnalysis(predictionPrompt, predictionFallback),
    ]);
    const analysis = analysisResult.text;
    const weeklyNarrative = narrativeResult.text;
    prediction.narrative = predictionResult.text;
    const analysisSource = [analysisResult, narrativeResult, predictionResult].every(item => item.source === 'claude')
      ? 'claude'
      : 'local';

    return res.status(200).json({
      student,
      stats: {
        totalHours: parseFloat(totalHours),
        progress: parseFloat(progress),
        validDays,
        anomalyDays,
        approvedDocs,
        pendingDocs,
        totalDocs: docs.length,
        weeklyHours,
        weeklyTrend,
        dataDefinitions: {
          verifiedDays: 'Unique dates with a coordinator-approved or otherwise valid DTR time-in, including the current day and valid off-schedule work.',
          attendanceRate: 'Completed scheduled workdays with a valid time-in divided by completed expected workdays. The current shift is excluded until its scheduled end time.',
          additionalVerifiedDays: 'Valid DTR days that are current/in-progress or outside the configured work schedule. These are present days, not absences.',
          absentDays: 'Completed scheduled workdays without a valid time-in, after approved leave, holidays, and closures are removed.',
          hoursProgress: 'Cumulative hours from valid DTR records divided by required OJT hours.',
          documentOutput: 'Requirements submitted by the end of each week divided by all document requirements.',
          documentCompliance: 'Requirements approved by the end of each week divided by all document requirements.',
          evaluationScore: 'Supervisor evaluation score recorded during that week; no score is inferred for other weeks.',
        },
        evaluations: evals,
        attendance: {
          expectedDays,
          presentDays: verifiedDays,
          verifiedDays,
          scheduledPresentDays,
          additionalVerifiedDays,
          absentDays, lateDays, excusedDays: excusedDateSet.size,
          attendanceRate: Number(attendanceRate.toFixed(1)),
          punctualityRate: Number(punctualityRate.toFixed(1)),
          workDays: scheduledDays,
          workStartTime: String(student.work_start_time).slice(0, 5),
          workEndTime: String(student.work_end_time).slice(0, 5),
          lateGraceMinutes: Number(student.late_grace_minutes),
          exceptions,
        },
      },
      performance,
      prediction,
      weeklyNarrative,
      analysis,
      analysisSource,
    });
  } catch (err) {
    console.error('Analytics error:', err);
    return res.status(500).json({ message: 'Failed to generate analytics.' });
  }
};

// GET /api/analytics/overview — coordinator overview
export const getOverviewAnalytics = async (req, res) => {
  try {
    const coordinatorFilter = '';
    const queryParams = [];
    const [studentsRes, dtrRes, anomalyRes, docsRes] = await Promise.all([
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.course,
               d.required_hours,
               COALESCE(SUM(tr.total_hours), 0) AS hours_rendered,
               COUNT(tr.id) AS dtr_count
        FROM users u
        JOIN deployments d ON d.student_id = u.id AND d.status = 'active'
        LEFT JOIN time_records tr ON tr.student_id = u.id AND tr.is_valid = true
        WHERE u.role = 'student' ${coordinatorFilter}
        GROUP BY u.id, u.first_name, u.last_name, u.course, d.required_hours
      `, queryParams),
      pool.query(`
        SELECT DATE_TRUNC('week', tr.date) AS week, COUNT(*) AS total,
               SUM(CASE WHEN tr.is_valid THEN 1 ELSE 0 END) AS valid
        FROM time_records tr
        JOIN deployments d ON d.id = tr.deployment_id
        WHERE tr.date >= CURRENT_DATE - INTERVAL '8 weeks' ${coordinatorFilter}
        GROUP BY week ORDER BY week
      `, queryParams),
      pool.query(`
        SELECT COUNT(*) AS total FROM time_records tr
        JOIN deployments d ON d.id = tr.deployment_id
        WHERE tr.anomaly_flag IS NOT NULL
        AND tr.date >= CURRENT_DATE - INTERVAL '30 days' ${coordinatorFilter}
      `, queryParams),
      pool.query(`
        SELECT sd.status, COUNT(*) AS count FROM student_documents sd
        JOIN deployments d ON d.student_id = sd.student_id AND d.status = 'active'
        WHERE 1=1 ${coordinatorFilter}
        GROUP BY sd.status
      `, queryParams),
    ]);

    const students = studentsRes.rows;
    const totalStudents = students.length;
    const getProgressRatio = (student) => {
      const hours = Number(student.hours_rendered);
      const required = Number(student.required_hours);
      return Number.isFinite(hours) && Number.isFinite(required) && required > 0 ? hours / required : 0;
    };
    const avgProgress = totalStudents > 0
      ? (students.reduce((sum, student) => sum + getProgressRatio(student) * 100, 0) / totalStudents).toFixed(1)
      : 0;

    const atRisk = students.filter(s =>
      getProgressRatio(s) < 0.3 && Number(s.dtr_count) < 5
    ).length;

    const onTrack = students.filter(s =>
      getProgressRatio(s) >= 0.5
    ).length;

    const prompt = `
You are an OJT coordinator analytics AI. Analyze the following batch data and provide a cohort performance trends report.

COHORT OVERVIEW:
- Total Students: ${totalStudents}
- Average OJT Progress: ${avgProgress}%
- Students On Track (≥50%): ${onTrack}
- Students At Risk (<30% with low attendance): ${atRisk}
- Recent Anomalies (30 days): ${anomalyRes.rows[0]?.total || 0}

WEEKLY ATTENDANCE TREND (last 8 weeks):
${dtrRes.rows.map(r => `- Week ${new Date(r.week).toLocaleDateString()}: ${r.total} records, ${r.valid} valid`).join('\n') || 'No data'}

DOCUMENT STATUS:
${docsRes.rows.map(r => `- ${r.status}: ${r.count}`).join('\n') || 'No documents'}

STUDENT PROGRESS BREAKDOWN:
${students.map(s => {
  const pct = (getProgressRatio(s) * 100).toFixed(1);
  return `- ${s.first_name} ${s.last_name} (${s.course || 'N/A'}): ${pct}% (${Number(s.hours_rendered || 0).toFixed(1)}h/${s.required_hours || 0}h)`;
}).join('\n') || 'No students'}

Provide a cohort performance analytics report with:
1. **COHORT SUMMARY** (overall batch performance)
2. **ATTENDANCE TRENDS** (weekly patterns)
3. **TOP PERFORMERS** (based on progress)
4. **STUDENTS NEEDING ATTENTION** (at risk students)
5. **DOCUMENT COMPLIANCE OVERVIEW**
6. **TREND INSIGHTS** (what patterns do you see?)
7. **COORDINATOR RECOMMENDATIONS** (actionable steps)
8. **OVERALL COHORT RATING** (Excellent/Good/Fair/Needs Intervention)

Be specific and data-driven.
    `;

    const anomalies = parseInt(anomalyRes.rows[0]?.total || 0, 10);
    const analysisResult = await generateAnalysis(
      prompt,
      buildOverviewFallback({ totalStudents, avgProgress, onTrack, atRisk, anomalies, students }),
    );

    return res.status(200).json({
      stats: {
        totalStudents,
        avgProgress: parseFloat(avgProgress),
        atRisk,
        onTrack,
        anomalies,
        weeklyTrend: dtrRes.rows,
        docStatus: docsRes.rows,
        students,
      },
      analysis: analysisResult.text,
      analysisSource: analysisResult.source,
    });
  } catch (err) {
    console.error('Overview analytics error:', err);
    return res.status(500).json({ message: 'Failed to generate overview analytics.' });
  }
};

export const getRiskDashboard = async (req, res) => {
  try {
    const coordinatorId = null;
    const result = await pool.query(`
      SELECT
        u.id, u.first_name, u.last_name, u.email,
        d.end_date, d.required_hours,
        COALESCE(SUM(tr.total_hours) FILTER (WHERE tr.is_valid), 0)::numeric(10,2) AS rendered_hours,
        COUNT(tr.id) FILTER (WHERE tr.anomaly_flag IS NOT NULL)::int AS anomalies,
        COUNT(DISTINCT dr.id) FILTER (
          WHERE sd.id IS NULL OR sd.status IN ('not_submitted', 'returned')
        )::int AS missing_documents,
        COUNT(DISTINCT e.id)::int AS evaluations,
        COUNT(DISTINCT ax.id) FILTER (WHERE ax.status = 'pending')::int AS pending_requests
      FROM users u
      JOIN deployments d ON d.student_id = u.id AND d.status = 'active'
      LEFT JOIN time_records tr ON tr.student_id = u.id
      CROSS JOIN document_requirements dr
      LEFT JOIN student_documents sd ON sd.student_id = u.id AND sd.requirement_id = dr.id
      LEFT JOIN evaluations e ON e.deployment_id = d.id
      LEFT JOIN attendance_exceptions ax ON ax.student_id = u.id
      WHERE u.role = 'student' AND ($1::uuid IS NULL OR d.coordinator_id = $1)
      GROUP BY u.id, u.first_name, u.last_name, u.email, d.end_date, d.required_hours
      ORDER BY u.last_name, u.first_name
    `, [coordinatorId]);
    const students = result.rows.map(student => {
      const required = Number(student.required_hours || 0);
      const rendered = Number(student.rendered_hours || 0);
      const progress = required > 0 ? Math.min(100, rendered / required * 100) : 0;
      const daysRemaining = student.end_date
        ? Math.ceil((new Date(student.end_date).getTime() - Date.now()) / 86400000)
        : null;
      const reasons = [];
      if (Number(student.anomalies)) reasons.push(`${student.anomalies} attendance anomaly`);
      if (Number(student.missing_documents)) reasons.push(`${student.missing_documents} missing/returned document`);
      if (daysRemaining !== null && daysRemaining <= 30 && progress < 80) reasons.push('Hours behind schedule');
      if (Number(student.pending_requests)) reasons.push(`${student.pending_requests} pending attendance request`);
      return { ...student, progress: Number(progress.toFixed(1)), daysRemaining, reasons,
        risk: reasons.length >= 2 ? 'high' : reasons.length ? 'medium' : 'low' };
    });
    return res.status(200).json({
      summary: {
        high: students.filter(student => student.risk === 'high').length,
        medium: students.filter(student => student.risk === 'medium').length,
        low: students.filter(student => student.risk === 'low').length,
      },
      students: students.sort((a, b) =>
        ({ high: 0, medium: 1, low: 2 }[a.risk]) - ({ high: 0, medium: 1, low: 2 }[b.risk])),
    });
  } catch (error) {
    console.error('Risk dashboard error:', error);
    return res.status(500).json({ message: 'Unable to load the risk dashboard.' });
  }
};
