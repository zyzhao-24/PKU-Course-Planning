import test from 'node:test';
import assert from 'node:assert/strict';
import { dateToSemesterWeek } from './activityPresentation.js';

test('date input converts to semester week and weekday', () => {
  assert.deepEqual(dateToSemesterWeek('2026-09-07', '2026-09-07', 18), {
    valid: true,
    week: 1,
    day: 1,
  });
  assert.deepEqual(dateToSemesterWeek('2026-09-02', '2026-09-07', 18), {
    valid: true,
    week: 0,
    day: 3,
  });
});

test('date input outside week zero through max week is rejected', () => {
  const before = dateToSemesterWeek('2026-08-30', '2026-09-07', 18);
  const after = dateToSemesterWeek('2027-01-18', '2026-09-07', 18);

  assert.equal(before.valid, false);
  assert.match(before.message, /第0-18周/);
  assert.equal(after.valid, false);
  assert.match(after.message, /第0-18周/);
});
