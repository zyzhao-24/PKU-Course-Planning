import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFixedBusyIndex,
  buildScheduleEventsForWeek,
  coursesHaveClassConflict,
  findCandidateCourseConflictOwners,
  findCandidateCourseConflictDetails,
  findFixedScheduleConflictOwners,
  groupOverlappingEvents,
} from './scheduleConflicts.js';

const firstWeekMonday = new Date(2026, 8, 7);

const course = (uuid, classTimes, examInfo = null) => ({
  uuid,
  course_id: uuid,
  class_number: '1',
  course_name: uuid,
  credits: 2,
  class_times: classTimes,
  exam_info: examInfo,
});

const classTime = (overrides = {}) => ({
  day: 1,
  start_period: 1,
  end_period: 2,
  week_range: '1-16',
  week_type: 0,
  ...overrides,
});

test('fixed-list scan finds course conflicts only in common active weeks', () => {
  const left = course('left', [classTime({ week_range: '1-3', week_type: 1 })]);
  const right = course('right', [classTime({ start_period: 2, end_period: 3, week_range: '2-3' })]);
  const conflicts = findFixedScheduleConflictOwners([left, right], {
    semester: '26-27-1',
    firstWeekMonday,
  });

  assert.deepEqual([...conflicts].sort(), ['left', 'right']);
});

test('missing week range consistently means every teaching week', () => {
  const fixed = course('fixed', [classTime({ week_range: '' })]);
  const candidate = course('candidate', [classTime({ start_period: 2, week_range: '12' })]);
  const busyIndex = buildFixedBusyIndex([fixed], {
    semester: '26-27-1',
    firstWeekMonday,
  });

  assert.deepEqual([...findCandidateCourseConflictOwners([candidate], busyIndex)], ['candidate']);
  assert.equal(coursesHaveClassConflict(fixed, candidate), true);
});

test('fixed-side independent exams conflict with candidate course times', () => {
  const fixed = course(
    'fixed',
    [classTime({ day: 2, start_period: 5, end_period: 6, week_range: '1' })],
    { date: '20260907', period: 1, location: '考场' },
  );
  const candidate = course('candidate', [
    classTime({ day: 1, start_period: 3, end_period: 4, week_range: '1' }),
  ]);
  const busyIndex = buildFixedBusyIndex([fixed], {
    semester: '26-27-1',
    firstWeekMonday,
  });

  assert.deepEqual([...findCandidateCourseConflictOwners([candidate], busyIndex)], ['candidate']);
  const details = findCandidateCourseConflictDetails(candidate, busyIndex);
  assert.equal(details.length, 1);
  assert.equal(details[0].fixedEvent.kind, 'exam');
  assert.equal(details[0].fixedEvent.course.uuid, 'fixed');
});

test('fixed-list scan includes independent exam conflicts between selected courses', () => {
  const examCourse = course(
    'exam-course',
    [classTime({ day: 2, start_period: 5, end_period: 6, week_range: '1' })],
    { date: '20260907', period: 1, location: '考场' },
  );
  const classCourse = course('class-course', [
    classTime({ day: 1, start_period: 3, end_period: 4, week_range: '1' }),
  ]);
  const conflicts = findFixedScheduleConflictOwners([examCourse, classCourse], {
    semester: '26-27-1',
    firstWeekMonday,
  });

  assert.deepEqual([...conflicts].sort(), ['class-course', 'exam-course']);
});

test('candidate-side exams are ignored before the course is selected', () => {
  const fixed = course('fixed', [classTime({ day: 2, week_range: '1' })]);
  const candidate = course(
    'candidate',
    [classTime({ day: 3, week_range: '1' })],
    { date: '20260908', period: 1, location: '考场' },
  );
  const busyIndex = buildFixedBusyIndex([fixed], {
    semester: '26-27-1',
    firstWeekMonday,
  });

  assert.equal(findCandidateCourseConflictOwners([candidate], busyIndex).size, 0);
});

test('in-class exam replaces its matching class event', () => {
  const selected = course(
    'selected',
    [classTime({ day: 1, start_period: 1, end_period: 2, week_range: '1' })],
    { date: '20260907', period: 1, location: '教室' },
  );
  const events = buildScheduleEventsForWeek([selected], 1, {
    firstWeekMonday,
    maxWeeks: 18,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'exam');
  assert.equal(events[0].isInClassExam, true);
  assert.equal(events[0].startMinute, 8 * 60);
  assert.equal(events[0].endMinute, 9 * 60 + 50);
});

test('current-week rendering merges transitively overlapping events', () => {
  const groups = groupOverlappingEvents([
    { id: 'a', startMinute: 480, endMinute: 600 },
    { id: 'b', startMinute: 540, endMinute: 660 },
    { id: 'c', startMinute: 630, endMinute: 720 },
    { id: 'd', startMinute: 720, endMinute: 780 },
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].events.map(event => event.id), ['a', 'b', 'c']);
  assert.equal(groups[0].startMinute, 480);
  assert.equal(groups[0].endMinute, 720);
  assert.deepEqual(groups[1].events.map(event => event.id), ['d']);
});
