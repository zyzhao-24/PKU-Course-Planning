export const PERIODS = {
  1: { start: '08:00', end: '08:50' },
  2: { start: '09:00', end: '09:50' },
  3: { start: '10:10', end: '11:00' },
  4: { start: '11:10', end: '12:00' },
  5: { start: '13:00', end: '13:50' },
  6: { start: '14:00', end: '14:50' },
  7: { start: '15:10', end: '16:00' },
  8: { start: '16:10', end: '17:00' },
  9: { start: '17:10', end: '18:00' },
  10: { start: '18:40', end: '19:30' },
  11: { start: '19:40', end: '20:30' },
  12: { start: '20:40', end: '21:30' },
};

export const EXAM_PERIODS = {
  1: { start: '08:30', end: '10:30', label: '上午', minPeriod: 1, maxPeriod: 4 },
  2: { start: '14:00', end: '16:00', label: '下午', minPeriod: 5, maxPeriod: 9 },
  3: { start: '18:30', end: '20:30', label: '晚上', minPeriod: 10, maxPeriod: 12 },
};

export const timeToMinutes = (time) => {
  const [hour, minute] = String(time).split(':').map(Number);
  return hour * 60 + minute;
};

export const getSemesterMaxWeeks = (semester) => {
  const term = String(semester || '').split('-').at(-1);
  return term === '3' ? 5 : 18;
};

const integer = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

export const getClassTimeWeeks = (classTime, maxWeeks) => {
  const weekType = integer(classTime?.week_type) ?? 0;
  const rawRange = String(classTime?.week_range || '').trim();
  const weeks = new Set();

  const addWeek = (week) => {
    if (week < 0 || week > maxWeeks) return;
    if (weekType === 1 && week % 2 === 0) return;
    if (weekType === 2 && week % 2 !== 0) return;
    weeks.add(week);
  };

  if (!rawRange) {
    for (let week = 1; week <= maxWeeks; week += 1) addWeek(week);
    return weeks;
  }

  rawRange.split(',').forEach(part => {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) return;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (start > end) return;
    for (let week = start; week <= end; week += 1) addWeek(week);
  });

  return weeks;
};

const normalizeClassTime = (classTime) => {
  const day = integer(classTime?.day);
  const startPeriod = integer(classTime?.start_period);
  const endPeriod = integer(classTime?.end_period);
  if (
    day === null || day < 1 || day > 7 ||
    startPeriod === null || endPeriod === null ||
    startPeriod < 1 || endPeriod > 12 || startPeriod > endPeriod
  ) {
    return null;
  }

  return {
    day,
    startPeriod,
    endPeriod,
    startMinute: timeToMinutes(PERIODS[startPeriod].start),
    endMinute: timeToMinutes(PERIODS[endPeriod].end),
  };
};

const courseOwnerId = (course, index = 0) => (
  course.uuid || `${course.course_id || 'course'}:${course.class_number || index}`
);

export const examDateToWeekDay = (dateValue, firstWeekMonday) => {
  const match = String(dateValue || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match || !firstWeekMonday) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const dayOfMonth = Number(match[3]);
  const examDate = new Date(year, month - 1, dayOfMonth);
  if (
    examDate.getFullYear() !== year ||
    examDate.getMonth() !== month - 1 ||
    examDate.getDate() !== dayOfMonth
  ) {
    return null;
  }

  const mondayValue = new Date(firstWeekMonday);
  if (Number.isNaN(mondayValue.getTime())) return null;
  const monday = new Date(
    mondayValue.getFullYear(),
    mondayValue.getMonth(),
    mondayValue.getDate(),
  );
  const diffDays = Math.round((examDate - monday) / 86400000);

  return {
    week: Math.floor(diffDays / 7) + 1,
    day: ((diffDays % 7) + 7) % 7 + 1,
  };
};

const buildClassEventsForWeek = (course, courseIndex, week, maxWeeks) => {
  const ownerId = courseOwnerId(course, courseIndex);
  const events = [];

  (course.class_times || []).forEach((classTime, classTimeIndex) => {
    const normalized = normalizeClassTime(classTime);
    if (!normalized || !getClassTimeWeeks(classTime, maxWeeks).has(week)) return;
    events.push({
      id: `class:${ownerId}:${classTimeIndex}:${week}`,
      ownerId,
      kind: 'class',
      week,
      ...normalized,
      course,
      classTime,
      examInfo: null,
      isInClassExam: false,
    });
  });

  return events;
};

export const buildScheduleEventsForWeek = (
  courses,
  week,
  { firstWeekMonday = null, maxWeeks = 18 } = {},
) => {
  const events = [];

  (courses || []).forEach((course, courseIndex) => {
    const classEvents = buildClassEventsForWeek(course, courseIndex, week, maxWeeks);
    const examInfo = course.exam_info;
    const examDate = examDateToWeekDay(examInfo?.date, firstWeekMonday);
    const examPeriod = EXAM_PERIODS[integer(examInfo?.period)];

    if (examDate?.week === week && examPeriod) {
      const matchingClassIndex = classEvents.findIndex(event => (
        event.day === examDate.day &&
        Math.max(event.startPeriod, examPeriod.minPeriod) <=
          Math.min(event.endPeriod, examPeriod.maxPeriod)
      ));

      if (matchingClassIndex >= 0) {
        const matchedClass = classEvents[matchingClassIndex];
        classEvents[matchingClassIndex] = {
          ...matchedClass,
          id: `exam:${matchedClass.ownerId}:${week}`,
          kind: 'exam',
          examInfo,
          isInClassExam: true,
        };
      } else {
        const ownerId = courseOwnerId(course, courseIndex);
        classEvents.push({
          id: `exam:${ownerId}:${week}`,
          ownerId,
          kind: 'exam',
          week,
          day: examDate.day,
          startPeriod: null,
          endPeriod: null,
          startMinute: timeToMinutes(examPeriod.start),
          endMinute: timeToMinutes(examPeriod.end),
          course,
          classTime: null,
          examInfo,
          isInClassExam: false,
        });
      }
    }

    events.push(...classEvents);
  });

  return events;
};

const buildAllScheduleEvents = (courses, options) => {
  const events = [];
  for (let week = 0; week <= options.maxWeeks; week += 1) {
    events.push(...buildScheduleEventsForWeek(courses, week, options));
  }
  return events;
};

const bucketKey = (week, day) => `${week}:${day}`;

const bucketEvents = (events) => {
  const buckets = new Map();
  events.forEach(event => {
    const key = bucketKey(event.week, event.day);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(event);
  });
  return buckets;
};

const byStartThenEnd = (left, right) => (
  left.startMinute - right.startMinute || left.endMinute - right.endMinute
);

export const findFixedScheduleConflictOwners = (
  courses,
  { semester = '', firstWeekMonday = null } = {},
) => {
  const maxWeeks = getSemesterMaxWeeks(semester);
  const buckets = bucketEvents(buildAllScheduleEvents(courses, { firstWeekMonday, maxWeeks }));
  const conflicts = new Set();

  buckets.forEach(bucket => {
    bucket.sort(byStartThenEnd);
    let active = [];
    bucket.forEach(event => {
      active = active.filter(item => item.endMinute > event.startMinute);
      active.forEach(item => {
        if (item.ownerId === event.ownerId) return;
        conflicts.add(item.ownerId);
        conflicts.add(event.ownerId);
      });
      active.push(event);
    });
  });

  return conflicts;
};

export const buildFixedBusyIndex = (
  courses,
  { semester = '', firstWeekMonday = null } = {},
) => {
  const maxWeeks = getSemesterMaxWeeks(semester);
  const buckets = bucketEvents(buildAllScheduleEvents(courses, { firstWeekMonday, maxWeeks }));
  const index = new Map();
  const sourceBuckets = new Map();

  buckets.forEach((bucket, key) => {
    const sorted = [...bucket].sort(byStartThenEnd);
    sourceBuckets.set(key, sorted);
    const merged = [];
    sorted.forEach(event => {
      const last = merged.at(-1);
      if (!last || event.startMinute > last.endMinute) {
        merged.push({ startMinute: event.startMinute, endMinute: event.endMinute });
      } else {
        last.endMinute = Math.max(last.endMinute, event.endMinute);
      }
    });
    index.set(key, merged);
  });

  return { buckets: index, sourceBuckets, maxWeeks };
};

const buildCandidateBuckets = (courses, maxWeeks) => {
  const buckets = new Map();
  (courses || []).forEach((course, courseIndex) => {
    const ownerId = courseOwnerId(course, courseIndex);
    (course.class_times || []).forEach(classTime => {
      const normalized = normalizeClassTime(classTime);
      if (!normalized) return;
      getClassTimeWeeks(classTime, maxWeeks).forEach(week => {
        const key = bucketKey(week, normalized.day);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ ownerId, week, course, classTime, ...normalized });
      });
    });
  });
  return buckets;
};

export const findCandidateCourseConflictOwners = (courses, busyIndex) => {
  const conflicts = new Set();
  const candidateBuckets = buildCandidateBuckets(courses, busyIndex.maxWeeks);

  candidateBuckets.forEach((candidates, key) => {
    const fixed = busyIndex.buckets.get(key);
    if (!fixed?.length) return;
    candidates.sort(byStartThenEnd);
    let fixedIndex = 0;

    candidates.forEach(candidate => {
      while (
        fixedIndex < fixed.length &&
        fixed[fixedIndex].endMinute <= candidate.startMinute
      ) {
        fixedIndex += 1;
      }
      const fixedInterval = fixed[fixedIndex];
      if (
        fixedInterval &&
        fixedInterval.startMinute < candidate.endMinute &&
        candidate.startMinute < fixedInterval.endMinute
      ) {
        conflicts.add(candidate.ownerId);
      }
    });
  });

  return conflicts;
};

export const findCandidateCourseConflictDetails = (course, busyIndex) => {
  const details = [];
  const candidateBuckets = buildCandidateBuckets([course], busyIndex.maxWeeks);

  candidateBuckets.forEach((candidates, key) => {
    const fixed = busyIndex.sourceBuckets.get(key);
    if (!fixed?.length) return;
    candidates.sort(byStartThenEnd);
    let firstPossibleFixed = 0;

    candidates.forEach(candidate => {
      while (
        firstPossibleFixed < fixed.length &&
        fixed[firstPossibleFixed].endMinute <= candidate.startMinute
      ) {
        firstPossibleFixed += 1;
      }

      for (let index = firstPossibleFixed; index < fixed.length; index += 1) {
        const fixedEvent = fixed[index];
        if (fixedEvent.startMinute >= candidate.endMinute) break;
        if (candidate.startMinute >= fixedEvent.endMinute) continue;
        details.push({
          week: candidate.week,
          day: candidate.day,
          startMinute: Math.max(candidate.startMinute, fixedEvent.startMinute),
          endMinute: Math.min(candidate.endMinute, fixedEvent.endMinute),
          candidate,
          fixedEvent,
        });
      }
    });
  });

  return details;
};

export const groupOverlappingEvents = (events) => {
  const sorted = [...(events || [])].sort(byStartThenEnd);
  const groups = [];

  sorted.forEach(event => {
    const current = groups.at(-1);
    if (!current || event.startMinute >= current.endMinute) {
      groups.push({
        startMinute: event.startMinute,
        endMinute: event.endMinute,
        events: [event],
      });
      return;
    }
    current.events.push(event);
    current.endMinute = Math.max(current.endMinute, event.endMinute);
  });

  return groups;
};

export const coursesHaveClassConflict = (left, right, maxWeeks = 18) => {
  const leftBuckets = buildCandidateBuckets([left], maxWeeks);
  const rightBuckets = buildCandidateBuckets([right], maxWeeks);

  for (const [key, leftEvents] of leftBuckets) {
    const rightEvents = rightBuckets.get(key);
    if (!rightEvents?.length) continue;
    leftEvents.sort(byStartThenEnd);
    rightEvents.sort(byStartThenEnd);
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < leftEvents.length && rightIndex < rightEvents.length) {
      const leftEvent = leftEvents[leftIndex];
      const rightEvent = rightEvents[rightIndex];
      if (leftEvent.endMinute <= rightEvent.startMinute) {
        leftIndex += 1;
      } else if (rightEvent.endMinute <= leftEvent.startMinute) {
        rightIndex += 1;
      } else {
        return true;
      }
    }
  }

  return false;
};
