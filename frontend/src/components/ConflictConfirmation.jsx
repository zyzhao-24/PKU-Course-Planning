import React, { useMemo } from 'react';
import { formatClassTimes, formatExamInfo } from '../utils';

const classTimeKey = (classTime) => [
  classTime?.day,
  classTime?.start_period,
  classTime?.end_period,
  classTime?.week_range || '',
  classTime?.week_type ?? 0,
  classTime?.location || '',
].join(':');

const TimeRow = ({ label, value, conflict }) => (
  <div style={{
    marginTop: '5px',
    padding: conflict ? '6px 8px' : '3px 8px',
    borderLeft: `3px solid ${conflict ? '#dc2626' : 'transparent'}`,
    borderRadius: '3px',
    background: conflict ? '#fef2f2' : 'transparent',
    color: conflict ? '#b91c1c' : '#64748b',
    fontSize: '12px',
    lineHeight: 1.5,
    whiteSpace: 'pre-line',
  }}>
    <span style={{ fontWeight: conflict ? 600 : 500 }}>{label}：</span>{value}
  </div>
);

function ConflictConfirmation({ course, channel, details }) {
  const conflictData = useMemo(() => {
    const candidateClassTimes = new Set();
    const sources = new Map();

    details.forEach(detail => {
      candidateClassTimes.add(classTimeKey(detail.candidate.classTime));
      const event = detail.fixedEvent;
      const sourceKey = event.ownerId;
      if (!sources.has(sourceKey)) {
        sources.set(sourceKey, {
          key: sourceKey,
          course: event.course,
          title: event.course?.course_name || event.title || '自定义事件',
          classTimes: new Set(),
          examConflict: false,
          customEvents: [],
        });
      }

      const source = sources.get(sourceKey);
      if (event.kind === 'exam') {
        source.examConflict = true;
        if (event.classTime) source.classTimes.add(classTimeKey(event.classTime));
      } else if (event.kind === 'custom') {
        source.customEvents.push(event);
      } else if (event.classTime) {
        source.classTimes.add(classTimeKey(event.classTime));
      }
    });

    return {
      candidateClassTimes,
      sources: [...sources.values()].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')),
    };
  }, [details]);

  return (
    <div>
      <div style={{
        marginBottom: '14px',
        padding: '10px 12px',
        border: '1px solid #fbbf24',
        borderRadius: '6px',
        background: '#fffbeb',
        color: '#92400e',
        fontSize: '13px',
      }}>
        {course.course_name}（{channel === 0 ? '主修' : '辅双'}）存在时间冲突，是否仍要选课？
      </div>

      <div style={{ marginBottom: '14px' }}>
        <div style={{ color: '#334155', fontSize: '13px', fontWeight: 600 }}>待选课程时间</div>
        {(course.class_times || []).map((classTime, index) => (
          <TimeRow
            key={`${classTimeKey(classTime)}:${index}`}
            label="上课"
            value={formatClassTimes([classTime]) || '未提供上课时间'}
            conflict={conflictData.candidateClassTimes.has(classTimeKey(classTime))}
          />
        ))}
      </div>

      <div style={{ borderTop: '1px solid #e2e8f0' }}>
        {conflictData.sources.map(source => (
          <div key={source.key} style={{ padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ color: '#334155', fontSize: '13px', fontWeight: 600 }}>
              {source.title}
            </div>
            {(source.course?.class_times || []).map((classTime, index) => (
              <TimeRow
                key={`${classTimeKey(classTime)}:${index}`}
                label="上课"
                value={formatClassTimes([classTime]) || '未提供上课时间'}
                conflict={source.classTimes.has(classTimeKey(classTime))}
              />
            ))}
            {source.course?.exam_info?.date && (
              <TimeRow
                label="考试"
                value={formatExamInfo(source.course.exam_info)}
                conflict={source.examConflict}
              />
            )}
            {source.customEvents.map(event => (
              <TimeRow
                key={event.id}
                label="事件"
                value={event.title || '自定义事件'}
                conflict
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ConflictConfirmation;
