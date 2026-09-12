const DEFAULT_BREAK_MINUTES = Number(process.env.UNPAID_BREAK_MINUTES || 60);
const BREAK_THRESHOLD_HOURS = 6;
const LONG_SHIFT_GRACE_HOURS = 2;

const timeMinutes = value => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
};

export const calculateCreditedHours = ({
  clockIn, clockOut, workStartTime = '08:00', workEndTime = '17:00',
  unpaidBreakMinutes = DEFAULT_BREAK_MINUTES, maximumCreditedHours = null,
}) => {
  const elapsedHours = Math.max(0, (new Date(clockOut) - new Date(clockIn)) / 3_600_000);
  const start = timeMinutes(workStartTime);
  const end = timeMinutes(workEndTime);
  let scheduledGrossHours = start == null || end == null ? 9 : (end - start) / 60;
  if (scheduledGrossHours <= 0) scheduledGrossHours += 24;

  const safeBreakMinutes = Math.max(0, Number(unpaidBreakMinutes) || 0);
  const breakHours = elapsedHours >= BREAK_THRESHOLD_HOURS ? safeBreakMinutes / 60 : 0;
  const scheduledNetHours = Math.max(0, scheduledGrossHours - (scheduledGrossHours >= BREAK_THRESHOLD_HOURS ? safeBreakMinutes / 60 : 0));
  const cap = Number(maximumCreditedHours) > 0 ? Math.min(scheduledNetHours, Number(maximumCreditedHours)) : scheduledNetHours;
  const creditedHours = Math.max(0, Math.min(elapsedHours - breakHours, cap));

  return {
    elapsedHours: Number(elapsedHours.toFixed(2)),
    creditedHours: Number(creditedHours.toFixed(2)),
    breakMinutes: breakHours ? safeBreakMinutes : 0,
    scheduledNetHours: Number(scheduledNetHours.toFixed(2)),
    unusuallyLong: elapsedHours > scheduledGrossHours + LONG_SHIFT_GRACE_HOURS,
  };
};
