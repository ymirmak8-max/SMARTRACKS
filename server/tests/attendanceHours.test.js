import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCreditedHours } from '../utils/attendanceHours.js';

test('deducts the standard break from a full scheduled day', () => {
  const result = calculateCreditedHours({
    clockIn: '2026-07-23T00:00:00.000Z',
    clockOut: '2026-07-23T09:00:00.000Z',
    workStartTime: '08:00',
    workEndTime: '17:00',
  });
  assert.equal(result.creditedHours, 8);
  assert.equal(result.breakMinutes, 60);
  assert.equal(result.unusuallyLong, false);
});

test('does not deduct a break from a short shift', () => {
  const result = calculateCreditedHours({
    clockIn: '2026-07-23T00:00:00.000Z',
    clockOut: '2026-07-23T05:30:00.000Z',
    workStartTime: '08:00',
    workEndTime: '17:00',
  });
  assert.equal(result.creditedHours, 5.5);
  assert.equal(result.breakMinutes, 0);
});

test('caps credited time and flags an abnormally long shift', () => {
  const result = calculateCreditedHours({
    clockIn: '2026-07-23T00:00:00.000Z',
    clockOut: '2026-07-23T14:00:00.000Z',
    workStartTime: '08:00',
    workEndTime: '17:00',
  });
  assert.equal(result.creditedHours, 8);
  assert.equal(result.unusuallyLong, true);
});

test('applies administrator break and daily-hour policy', () => {
  const result = calculateCreditedHours({
    clockIn: '2026-07-23T00:00:00.000Z',
    clockOut: '2026-07-23T09:00:00.000Z',
    workStartTime: '08:00',
    workEndTime: '17:00',
    unpaidBreakMinutes: 30,
    maximumCreditedHours: 7.5,
  });
  assert.equal(result.breakMinutes, 30);
  assert.equal(result.creditedHours, 7.5);
});
