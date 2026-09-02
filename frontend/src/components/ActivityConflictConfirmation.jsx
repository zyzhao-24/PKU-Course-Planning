import React, { useMemo } from 'react';
import { formatActivityTimeEntry } from '../utils/activityPresentation';
import { formatClassTimes, formatExamInfo } from '../utils';

const entryKey = (entry) => JSON.stringify({
  recurrence: entry?.recurrence || {},
  time: entry?.time || {},
  location: entry?.location || '',
});

const classTimeKey = (classTime) => JSON.stringify({
  day: classTime?.day,
  start_period: classTime?.start_period,
  end_period: classTime?.end_period,
  week_range: classTime?.week_range || '',
  week_type: classTime?.week_type ?? 0,
  location: classTime?.location || '',
});

const Row = ({ label, value, conflict }) => (
  <div style={{
    marginTop: '5px',
    padding: conflict ? '6px 8px' : '3px 8px',
    borderLeft: `3px solid ${conflict ? '#dc2626' : 'transparent'}`,
    borderRadius: '3px',
    background: conflict ? '#fef2f2' : 'transparent',
    color: conflict ? '#b91c1c' : '#64748b',
    fontSize: '12px',
  }}>
    <strong>{label}：</strong>{value}
  </div>
);

function ActivityConflictConfirmation({ activity, details }) {
  const data = useMemo(() => {
    const candidateEntries = new Set();
    const sources = new Map();
    details.forEach(detail => {
      candidateEntries.add(entryKey(detail.candidateEvent.activityEntry));
      const event = detail.fixedEvent;
      if (!sources.has(event.ownerId)) {
        sources.set(event.ownerId, {
          key: event.ownerId,
          course: event.course,
          activity: event.activity,
          title: event.course?.course_name || event.activity?.title || event.title || '日程',
          classTimes: new Set(),
          activityEntries: new Set(),
          examConflict: false,
        });
      }
      const source = sources.get(event.ownerId);
      if (event.kind === 'exam') {
        source.examConflict = true;
        if (event.classTime) source.classTimes.add(classTimeKey(event.classTime));
      } else if (event.kind === 'custom') {
        source.activityEntries.add(entryKey(event.activityEntry));
      } else if (event.classTime) {
        source.classTimes.add(classTimeKey(event.classTime));
      }
    });
    return { candidateEntries, sources: [...sources.values()] };
  }, [details]);

  return (
    <div>
      <div className="status-bar status-error" style={{ marginBottom: '14px' }}>
        活动“{activity.title}”存在时间冲突，是否仍要保存？
      </div>
      <div style={{ marginBottom: '14px' }}>
        <strong style={{ color: '#334155', fontSize: '13px' }}>待保存活动时间</strong>
        {(activity.time_entries || []).map((entry, index) => (
          <Row
            key={`${entryKey(entry)}:${index}`}
            label="活动"
            value={formatActivityTimeEntry(entry)}
            conflict={data.candidateEntries.has(entryKey(entry))}
          />
        ))}
      </div>
      <div style={{ borderTop: '1px solid #e2e8f0' }}>
        {data.sources.map(source => (
          <div key={source.key} style={{ padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
            <strong style={{ color: '#334155', fontSize: '13px' }}>{source.title}</strong>
            {(source.course?.class_times || []).map((classTime, index) => (
              <Row
                key={`${classTimeKey(classTime)}:${index}`}
                label="上课"
                value={formatClassTimes([classTime])}
                conflict={source.classTimes.has(classTimeKey(classTime))}
              />
            ))}
            {source.course?.exam_info?.date && (
              <Row label="考试" value={formatExamInfo(source.course.exam_info)} conflict={source.examConflict} />
            )}
            {(source.activity?.time_entries || []).map((entry, index) => (
              <Row
                key={`${entryKey(entry)}:${index}`}
                label="活动"
                value={formatActivityTimeEntry(entry)}
                conflict={source.activityEntries.has(entryKey(entry))}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ActivityConflictConfirmation;
