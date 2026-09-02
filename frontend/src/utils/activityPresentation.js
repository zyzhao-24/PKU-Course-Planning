const WEEK_DAYS = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

export const ACTIVITY_COLOR_SETS = {
  blue: { bg: '#e3f2fd', border: '#90caf9', text: '#1565c0' },
  green: { bg: '#e8f5e9', border: '#a5d6a7', text: '#2e7d32' },
  amber: { bg: '#fff3e0', border: '#ffcc80', text: '#b45309' },
  purple: { bg: '#f3e5f5', border: '#ce93d8', text: '#7b1fa2' },
  cyan: { bg: '#e0f7fa', border: '#80deea', text: '#0e7490' },
  rose: { bg: '#fce4ec', border: '#f48fb1', text: '#be123c' },
  yellow: { bg: '#fff8e1', border: '#ffe082', text: '#a16207' },
  lime: { bg: '#f1f8e9', border: '#c5e1a5', text: '#4d7c0f' },
};

export const createEmptyActivityTime = () => ({
  input_mode: 'weeks',
  date_input: '',
  date_error: '',
  recurrence: {
    type: 'weeks',
    day: 1,
    week_range: '1-16',
    week_type: 0,
  },
  time: {
    type: 'periods',
    start_period: 1,
    end_period: 2,
    start: '08:00',
    end: '09:00',
  },
  location: '',
  blocking: true,
});

const parseDateOnly = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) return null;
  return parsed;
};

export const dateToSemesterWeek = (dateValue, firstWeekMonday, maxWeeks) => {
  const selectedDate = parseDateOnly(dateValue);
  const firstMonday = parseDateOnly(firstWeekMonday);
  if (!selectedDate) return { valid: false, message: '请选择有效日期' };
  if (!firstMonday) return { valid: false, message: '学期缺少第一周周一日期，无法换算' };

  const diffDays = Math.round((selectedDate - firstMonday) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  const day = ((diffDays % 7) + 7) % 7 + 1;
  if (week < 0 || week > maxWeeks) {
    return { valid: false, message: `所选日期不在本学期第0-${maxWeeks}周范围内` };
  }
  return { valid: true, week, day };
};

export const createEmptyActivity = (semester) => ({
  semester,
  title: '',
  color: 'green',
  notes: '',
  time_entries: [createEmptyActivityTime()],
});

const weekTypeText = (weekType) => ({ 0: '每周', 1: '单周', 2: '双周' }[weekType] || '每周');

export const formatActivityTimeEntry = (entry) => {
  const recurrence = entry?.recurrence || {};
  const time = entry?.time || {};
  const recurrenceText = `${recurrence.week_range || ''}周 ${weekTypeText(recurrence.week_type)} ${WEEK_DAYS[recurrence.day] || ''}`.trim();
  const timeText = time.type === 'clock'
    ? `${time.start || ''}-${time.end || ''}`
    : `${time.start_period || ''}-${time.end_period || ''}节`;
  return [recurrenceText, timeText, entry?.location || ''].filter(Boolean).join(' ');
};
