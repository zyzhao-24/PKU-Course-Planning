import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFixedBusyIndex,
  buildScheduleAdjustmentIndex,
  buildScheduleEventsForWeek,
  coursesHaveClassConflict,
  findCandidateCourseConflictOwners,
  findCandidateCourseConflictDetails,
  findFixedScheduleConflictOwners,
  groupOverlappingEvents,
  resolveActualScheduleDay,
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

test('activities use week and weekday for recurring and one-off times', () => {
  const activities = [
    {
      uuid: 'weekly',
      title: '组会',
      blocking: true,
      time_entries: [{
        recurrence: { type: 'weeks', day: 3, week_range: '1-16', week_type: 0 },
        time: { type: 'clock', start: '12:30', end: '13:30' },
        location: '会议室',
      }],
    },
    {
      uuid: 'one-off',
      title: '讲座',
      blocking: true,
      time_entries: [{
        recurrence: { type: 'weeks', day: 1, week_range: '0', week_type: 0 },
        time: { type: 'periods', start_period: 5, end_period: 6 },
        location: '礼堂',
      }],
    },
  ];
  const events = [
    ...buildScheduleEventsForWeek([], 1, {
      firstWeekMonday,
      maxWeeks: 18,
      activities,
    }),
    ...buildScheduleEventsForWeek([], 0, {
      firstWeekMonday,
      maxWeeks: 18,
      activities,
    }),
  ];

  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'custom');
  assert.equal(events[0].startMinute, 12 * 60 + 30);
  assert.equal(events[1].startMinute, 13 * 60);
});

test('non-blocking activities render but do not enter candidate conflict index', () => {
  const activity = {
      uuid: 'info',
      title: '提醒',
      time_entries: [{
      recurrence: { type: 'weeks', day: 1, week_range: '1', week_type: 0 },
      time: { type: 'periods', start_period: 1, end_period: 2 },
      location: '',
      blocking: false,
    }],
  };
  const candidate = course('candidate', [classTime({ week_range: '1' })]);
  const busyIndex = buildFixedBusyIndex([], {
    semester: '26-27-1',
    firstWeekMonday,
    activities: [activity],
  });
  const rendered = buildScheduleEventsForWeek([], 1, {
    firstWeekMonday,
    maxWeeks: 18,
    activities: [activity],
  });

  assert.equal(rendered.length, 1);
  assert.equal(findCandidateCourseConflictOwners([candidate], busyIndex).size, 0);
  const groups = groupOverlappingEvents([
    { id: 'course', startMinute: 480, endMinute: 590, blocking: true },
    { id: 'info', startMinute: 500, endMinute: 540, blocking: false },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].isConflict, false);
});

test('mapped course days use the source week eligibility and actual destination day', () => {
  const selected = course('mapped', [classTime({ day: 1, week_range: '1', week_type: 1 })]);
  const adjustments = [{
    id: 1,
    name: '调休',
    entries: [{
      actual: { week: 2, day: 7 },
      mode: 'mapped',
      use_schedule_of: { week: 1, day: 1 },
    }],
  }];
  const events = buildScheduleEventsForWeek([selected], 2, {
    maxWeeks: 18,
    adjustments,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].week, 2);
  assert.equal(events[0].day, 7);
  assert.equal(events[0].normalWeek, 1);
  assert.equal(events[0].normalDay, 1);
});

test('off days remove courses but keep activities and independent exams', () => {
  const independentExam = course(
    'exam',
    [classTime({ day: 2, week_range: '1' })],
    { date: '20260907', period: 1, location: '考场' },
  );
  const mondayCourse = course('holiday-course', [classTime({ day: 1, week_range: '1' })]);
  const activity = {
    uuid: 'holiday-activity',
    title: '活动',
    time_entries: [{
      recurrence: { type: 'weeks', day: 1, week_range: '1', week_type: 0 },
      time: { type: 'periods', start_period: 5, end_period: 6 },
      blocking: true,
    }],
  };
  const adjustments = [{
    id: 1,
    name: '放假',
    entries: [{ actual: { week: 1, day: 1 }, mode: 'off' }],
  }];
  const events = buildScheduleEventsForWeek([independentExam, mondayCourse], 1, {
    firstWeekMonday,
    maxWeeks: 18,
    activities: [activity],
    adjustments,
  });

  assert.deepEqual(events.map(event => event.kind).sort(), ['class', 'custom', 'exam']);
  assert.equal(events.some(event => event.course?.uuid === 'holiday-course'), false);
  assert.equal(events.find(event => event.kind === 'exam').isInClassExam, false);
  assert.equal(events.find(event => event.kind === 'exam').day, 1);
  assert.equal(events.find(event => event.kind === 'custom').day, 1);
});

test('in-class exams follow their projected course occurrence', () => {
  const selected = course(
    'in-class-moved',
    [classTime({ day: 1, start_period: 1, end_period: 2, week_range: '1' })],
    { date: '20260907', period: 1, location: '教室' },
  );
  const adjustments = [{
    id: 1,
    name: '调休',
    entries: [
      { actual: { week: 1, day: 1 }, mode: 'off' },
      {
        actual: { week: 1, day: 7 },
        mode: 'mapped',
        use_schedule_of: { week: 1, day: 1 },
      },
    ],
  }];
  const events = buildScheduleEventsForWeek([selected], 1, {
    firstWeekMonday,
    maxWeeks: 18,
    adjustments,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'exam');
  assert.equal(events[0].isInClassExam, true);
  assert.equal(events[0].day, 7);
});

test('candidate conflict lookup uses adjusted actual course days', () => {
  const fixedActivity = {
    uuid: 'sunday-event',
    title: '周日活动',
    time_entries: [{
      recurrence: { type: 'weeks', day: 7, week_range: '1', week_type: 0 },
      time: { type: 'periods', start_period: 1, end_period: 2 },
      blocking: true,
    }],
  };
  const adjustments = [{
    id: 1,
    name: '调课',
    entries: [{
      actual: { week: 1, day: 7 },
      mode: 'mapped',
      use_schedule_of: { week: 1, day: 1 },
    }],
  }];
  const busyIndex = buildFixedBusyIndex([], {
    semester: '26-27-1',
    firstWeekMonday,
    activities: [fixedActivity],
    adjustments,
  });
  const candidate = course('candidate-adjusted', [classTime({ day: 1, week_range: '1' })]);

  assert.deepEqual(
    [...findCandidateCourseConflictOwners([candidate], busyIndex)],
    ['candidate-adjusted'],
  );
  const details = findCandidateCourseConflictDetails(candidate, busyIndex);
  assert.equal(details.length, 1);
  assert.equal(details[0].week, 1);
  assert.equal(details[0].day, 7);
});

test('adjustment lookup is direct and marks only explicit off actual days', () => {
  const index = buildScheduleAdjustmentIndex([{
    id: 1,
    name: '连续调整',
    entries: [
      { actual: { week: 1, day: 1 }, mode: 'off' },
      {
        actual: { week: 1, day: 2 },
        mode: 'mapped',
        use_schedule_of: { week: 1, day: 1 },
      },
    ],
  }]);

  assert.equal(resolveActualScheduleDay(index, 1, 1).mode, 'off');
  assert.deepEqual(resolveActualScheduleDay(index, 1, 2), {
    mode: 'mapped',
    normalWeek: 1,
    normalDay: 1,
    adjustment: index.get('1:2'),
  });
  assert.equal(resolveActualScheduleDay(index, 1, 3).mode, 'normal');
});
