import React, { useState, useEffect, useMemo } from 'react';
import { WEEK_DAYS, getWeekDate, formatDate } from '../utils';
import {
  PERIODS,
  EXAM_PERIODS,
  buildScheduleAdjustmentIndex,
  buildScheduleEventsForWeek,
  getSemesterMaxWeeks,
  groupOverlappingEvents,
  resolveActualScheduleDay,
  timeToMinutes,
} from '../utils/scheduleConflicts';
import { ACTIVITY_COLOR_SETS } from '../utils/activityPresentation';

// ==================== 常量定义 ====================

const COURSE_COLORS = [
  { bg: '#e3f2fd', border: '#90caf9', text: '#1565c0' },
  { bg: '#e8f5e9', border: '#a5d6a7', text: '#2e7d32' },
  { bg: '#fff3e0', border: '#ffcc80', text: '#ef6c00' },
  { bg: '#f3e5f5', border: '#ce93d8', text: '#7b1fa2' },
  { bg: '#e0f7fa', border: '#80deea', text: '#00838f' },
  { bg: '#fce4ec', border: '#f48fb1', text: '#ad1457' },
  { bg: '#fff8e1', border: '#ffe082', text: '#ff8f00' },
  { bg: '#f1f8e9', border: '#c5e1a5', text: '#558b2f' },
];

const getCourseColor = (id) => {
  if (!id) return COURSE_COLORS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COURSE_COLORS.length;
  return COURSE_COLORS[index];
};

const PIXELS_PER_HOUR = 85;  // 高度

function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function CourseTable({
  courses,
  activities = [],
  adjustments = [],
  semester,
  firstWeekMonday,
  onWeekChange,
  onActivityClick,
}) {
  const [currentWeek, setCurrentWeek] = useState(1);
  
  const days = [1, 2, 3, 4, 5, 6, 7];

  // 当周次变化时通知父组件
  useEffect(() => {
    if (onWeekChange) {
      onWeekChange(currentWeek);
    }
  }, [currentWeek, onWeekChange]);

  const maxWeeks = getSemesterMaxWeeks(semester);
  const adjustmentIndex = useMemo(
    () => buildScheduleAdjustmentIndex(adjustments),
    [adjustments],
  );
  const currentDaySchedules = useMemo(() => {
    const result = {};
    days.forEach(day => {
      result[day] = resolveActualScheduleDay(adjustmentIndex, currentWeek, day);
    });
    return result;
  }, [adjustmentIndex, currentWeek]);

  useEffect(() => {
    setCurrentWeek(1);
  }, [semester]);

  // ==================== 统一事件处理 ====================
  
  /**
   * 创建统一格式的事件对象
   */
  const createEvent = (type, data) => {
    const base = {
      id: data.id,
      type, // 'course' | 'exam'
      course_id: data.course_id,
      class_number: data.class_number,
      credits: parseFloat(data.credits || 0),
      colorset: data.colorset || getCourseColor(data.course_id),
      name: data.name,
      start_time: data.start_time, // minutes
      end_time: data.end_time,     // minutes
      location: data.location || '',
      remarks: data.remarks || '',
      teachers: data.teachers || [],
      channel: data.channel,  // 0=主修，1=辅双
      _original: data._original
    };
    
    if (type === 'exam') {
      base.exam_period = data.exam_period;
    }
    
    return base;
  };

  /**
   * 按天收集并合并冲突事件
   */
  const processDayEvents = (day, weekEvents) => {
    const events = weekEvents
      .filter(event => event.day === day)
      .map(event => {
        if (event.kind === 'custom') {
          const activity = event.activity;
          const displayEvent = createEvent('custom', {
            id: event.id,
            course_id: '',
            class_number: '',
            credits: 0,
            colorset: ACTIVITY_COLOR_SETS[activity.color] || ACTIVITY_COLOR_SETS.green,
            name: activity.title,
            start_time: event.startMinute,
            end_time: event.endMinute,
            location: event.location,
            remarks: activity.notes || '',
            _original: { activity, activityEntry: event.activityEntry },
          });
          return {
            ...displayEvent,
            startMinute: event.startMinute,
            endMinute: event.endMinute,
            blocking: event.blocking,
          };
        }
        const { course, classTime, examInfo } = event;
        const type = event.kind === 'exam' ? 'exam' : 'course';
        const displayEvent = createEvent(type, {
          id: event.id,
          course_id: course.course_id,
          class_number: course.class_number,
          credits: course.credits,
          name: course.course_name + (course.channel === 0 ? '（主）' : '（双）'),
          start_time: event.startMinute,
          end_time: event.endMinute,
          location: type === 'exam'
            ? (examInfo?.location || classTime?.location || '')
            : (classTime?.location || ''),
          remarks: type === 'exam' ? '' : (course.remarks || ''),
          teachers: course.teachers || [],
          exam_period: examInfo?.period,
          _original: {
            course,
            classTime,
            examInfo,
            isInClass: event.isInClassExam,
          },
        });
        return {
          ...displayEvent,
          startMinute: event.startMinute,
          endMinute: event.endMinute,
          blocking: true,
        };
      });

    return groupOverlappingEvents(events).map(group => ({
      start: group.startMinute,
      end: group.endMinute,
      events: group.events,
      isConflict: group.isConflict,
    }));
  };

  // ==================== 主处理逻辑 ====================

  const currentWeekEvents = useMemo(() => buildScheduleEventsForWeek(
    courses,
    currentWeek,
    { firstWeekMonday, maxWeeks, activities, adjustments },
  ), [courses, activities, adjustments, currentWeek, firstWeekMonday, maxWeeks]);

  const { startHour, endHour, totalHeight, dayGroups } = useMemo(() => {
    // 按天处理事件组
    const groupsByDay = {};
    days.forEach(day => {
      groupsByDay[day] = processDayEvents(day, currentWeekEvents);
    });

    // 计算时间范围
    let minMin = 24 * 60, maxMin = 0;
    let hasItems = false;
    
    Object.values(groupsByDay).forEach(groups => {
      groups.forEach(g => {
        hasItems = true;
        minMin = Math.min(minMin, g.start);
        maxMin = Math.max(maxMin, g.end);
      });
    });

    if (!hasItems) {
      return { startHour: 8, endHour: 18, totalHeight: 600, dayGroups: groupsByDay };
    }

    let s = Math.floor(minMin / 60) - 1;
    let e = Math.ceil(maxMin / 60) + 1;
    s = Math.max(0, s);
    e = Math.min(24, e);
    if (e - s < 8) e = Math.min(24, s + 8);

    return { 
      startHour: s, 
      endHour: e, 
      totalHeight: (e - s) * PIXELS_PER_HOUR,
      dayGroups: groupsByDay
    };
  }, [currentWeekEvents]);

  const getWeekDates = () => {
    if (!firstWeekMonday) return {};
    const dates = {};
    for (let day = 1; day <= 7; day++) {
      dates[day] = getWeekDate(firstWeekMonday, currentWeek, day);
    }
    return dates;
  };

  const weekDates = getWeekDates();

  // ==================== 渲染函数 ====================
  
  const renderGridLines = () => {
    const lines = [];
    for (let i = startHour; i <= endHour; i++) {
      lines.push(
        <div key={i} style={{ 
          position: 'absolute', 
          top: (i - startHour) * PIXELS_PER_HOUR, 
          width: '100%', 
          borderTop: '1px dashed #eee',
          zIndex: 0
        }} />
      );
    }
    return lines;
  };

  /**
   * 检查当前周是否有非堂考期末考试
   */
  const hasNonInClassExam = useMemo(() => {
    return currentWeekEvents.some(event => (
      event.kind === 'exam' && !event.isInClassExam
    ));
  }, [currentWeekEvents]);

  const renderTimeLabels = () => {
    // 如果有非堂考考试，显示3个考试时段标签
    if (hasNonInClassExam) {
      return Object.entries(EXAM_PERIODS).map(([period, time]) => {
        const startMin = timeToMinutes(time.start);
        const endMin = timeToMinutes(time.end);
        if (startMin < startHour * 60 || endMin > endHour * 60) return null;
        const top = (startMin / 60 - startHour) * PIXELS_PER_HOUR;
        const height = ((endMin - startMin) / 60) * PIXELS_PER_HOUR;
        return (
          <div key={`exam-${period}`} style={{ 
            position: 'absolute', 
            top, 
            height,
            width: '100%', 
            textAlign: 'center',
            fontSize: '11px',
            color: '#333',
            background: '#fff3e0', // 考试时段用橙色背景
            borderTop: '1px solid #ffcc80',
            borderBottom: '1px solid #ffcc80',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            boxSizing: 'border-box'
          }}>
            <span style={{fontWeight: 'bold'}}>{time.label}</span>
            <span style={{fontSize: '9px', color: '#666'}}>{time.start}</span>
            <span style={{fontSize: '9px', color: '#666'}}>{time.end}</span>
          </div>
        );
      });
    }
    
    // 默认显示12个节次标签
    return Object.entries(PERIODS).map(([p, time]) => {
      const startMin = timeToMinutes(time.start);
      const endMin = timeToMinutes(time.end);
      if (startMin < startHour * 60 || endMin > endHour * 60) return null;
      const top = (startMin / 60 - startHour) * PIXELS_PER_HOUR;
      const height = ((endMin - startMin) / 60) * PIXELS_PER_HOUR;
      return (
        <div key={p} style={{ 
          position: 'absolute', 
          top, 
          height,
          width: '100%', 
          textAlign: 'center',
          fontSize: '11px',
          color: '#333',
          background: '#f5f5f5',
          borderTop: '1px solid #ddd',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          boxSizing: 'border-box'
        }}>
          <span style={{fontWeight: 'bold'}}>#{p}</span>
          <span style={{fontSize: '9px', color: '#666'}}>{time.start}</span>
          <span style={{fontSize: '9px', color: '#666'}}>{time.end}</span>
        </div>
      );
    });
  };

  /**
   * 渲染单个事件（完整信息）
   */
  const renderSingleEvent = (event, top, height) => {
    const textColor = event.colorset.text;
    const examPeriodLabel = event.exam_period ? EXAM_PERIODS[event.exam_period]?.label : '';
    
    return (
      <div
        key={event.id || `${event.type}-${event.start_time}`}
        onClick={event.type === 'custom' ? () => onActivityClick?.(event._original.activity) : undefined}
        style={{
          position: 'absolute',
          top,
          height,
          left: '2px',
          right: '2px',
          backgroundColor: event.colorset.bg,
          border: `1px solid ${event.colorset.border}`,
          borderRadius: '4px',
          padding: '3px',
          fontSize: '11px',
          overflow: 'hidden',
          zIndex: 1,
          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
          boxSizing: 'border-box',
          cursor: event.type === 'custom' ? 'pointer' : 'default',
        }}
      >
        {/* 课号-班号 xx学分 */}
        {event.type !== 'custom' && <div style={{
          fontSize: '10px', 
          fontWeight: 'bold', 
          color: textColor,
          marginBottom: '2px'
        }}>
          {event.course_id}-{event.class_number} {event.credits.toFixed(1)}学分
        </div>}
        
        {/* 课程名称 */}
        <div style={{ 
          fontWeight: 'bold', 
          color: textColor,
          fontSize: '12px',
          marginBottom: event.type === 'exam' ? '2px' : '3px',
          lineHeight: '1.3'
        }}>
          {event.name}
        </div>
        
        {/* 期末考试（仅考试显示） */}
        {event.type === 'exam' && (
          <div style={{ 
            fontSize: '11px', 
            fontWeight: 'bold',
            color: textColor,
            marginBottom: '2px'
          }}>
            📝 期末考试
          </div>
        )}
        {event.type === 'custom' && (
          <div style={{ fontSize: '10px', fontWeight: 600, color: textColor, marginBottom: '2px' }}>
            活动
          </div>
        )}
        
        {/* 时间 */}
        <div style={{ fontSize: '11px', marginBottom: '2px' }}>
          ⌛ {formatTime(event.start_time)} - {formatTime(event.end_time)}
          {examPeriodLabel && ` (${examPeriodLabel})`}
        </div>
        
        {/* 教师 */}
        {event.teachers && event.teachers.length > 0 && (
          <div style={{ fontSize: '11px', marginBottom: '2px' }}>
            👨‍🏫 {event.teachers.join(', ')}
          </div>
        )}
        
        {/* 地点 */}
        {event.location && (
          <div style={{ fontSize: '11px', marginBottom: '2px' }}>
            📍 {event.location}
          </div>
        )}
        
        {/* 备注（考试不显示） */}
        {event.type !== 'exam' && event.remarks && (
          <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
            {event.remarks}
          </div>
        )}
      </div>
    );
  };

  /**
   * 渲染冲突组（简化信息）
   */
  const renderConflictGroup = (group, groupIdx) => {
    const { start, end, events, isConflict } = group;
    const top = (start / 60 - startHour) * PIXELS_PER_HOUR;
    const height = ((end - start) / 60) * PIXELS_PER_HOUR;
    
    // 如果只有一个事件，渲染完整信息
    if (events.length === 1) {
      return renderSingleEvent(events[0], top, height);
    }
    
    // 多个事件冲突，使用简化信息
    return (
      <div
        key={`group-${groupIdx}`}
        style={{
          position: 'absolute',
          top,
          height,
          left: '2px',
          right: '2px',
          backgroundColor: isConflict ? '#ffebee' : '#f8fafc',
          border: `2px solid ${isConflict ? '#c62828' : '#cbd5e1'}`,
          borderRadius: '4px',
          padding: '4px',
          fontSize: '11px',
          overflow: 'hidden',
          zIndex: isConflict ? 3 : 2,
          boxShadow: isConflict ? '0 0 8px rgba(198, 40, 40, 0.4)' : '0 1px 2px rgba(0,0,0,0.08)',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}
      >
        {events.map((event, idx) => {
          const textColor = event.colorset.text;
          const isLast = idx === events.length - 1;
          
          return (
            <div 
              key={event.id || `evt-${idx}`}
              onClick={event.type === 'custom' ? () => onActivityClick?.(event._original.activity) : undefined}
              style={{
                flexShrink: 0,
                paddingBottom: isLast ? 0 : '4px',
                borderBottom: isLast ? 'none' : `1px dashed ${event.colorset.border}`,
                minHeight: 0,
                cursor: event.type === 'custom' ? 'pointer' : 'default',
              }}
            >
              {/* 课程名（颜色，加粗）+ 考试标识 */}
              <div style={{ 
                fontWeight: 'bold', 
                color: textColor,
                fontSize: '12px',
                lineHeight: '1.3',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                {isConflict && <span>⚠</span>}
                <span>{event.name}</span>
                {event.type === 'exam' && (
                  <span style={{ 
                    fontSize: '10px', 
                    fontWeight: 'bold',
                    color: textColor,
                    opacity: 0.8
                  }}>
                    期末考试
                  </span>
                )}
                {event.type === 'custom' && <span style={{ fontSize: '10px', opacity: 0.8 }}>活动</span>}
              </div>
              
              {/* 时间 */}
              <div style={{ fontSize: '10px', color: '#555', marginTop: '1px' }}>
                ⌛ {formatTime(event.start_time)} - {formatTime(event.end_time)}
              </div>
              
              {/* 地点 */}
              {event.location && (
                <div style={{ fontSize: '10px', color: '#555' }}>
                  📍 {event.location}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="course-table-container">
      <div className="week-selector" style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button className="btn btn-secondary" disabled={currentWeek <= 0} onClick={() => setCurrentWeek(p => p - 1)}>上一周</button>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input type="range" min="0" max={maxWeeks} value={currentWeek} onChange={(e) => setCurrentWeek(parseInt(e.target.value))} style={{ flex: 1 }} />
          <span style={{ fontWeight: 'bold', minWidth: '60px' }}>第 {currentWeek} 周</span>
        </div>
        <button className="btn btn-secondary" disabled={currentWeek >= maxWeeks} onClick={() => setCurrentWeek(p => p + 1)}>下一周</button>
      </div>

      <div id="course-table-scroll-container" style={{ position: 'relative', border: '1px solid #ddd', overflowX: 'auto', overflowY: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', minHeight: '46px', borderBottom: '1px solid #ddd', position: 'sticky', top: 0, background: '#fff', zIndex: 10 }}>
          <div style={{ width: '60px', flexShrink: 0, borderRight: '1px solid #ddd', background: '#f9f9f9', zIndex: 11 }}></div>
          {days.map(day => {
            const daySchedule = currentDaySchedules[day];
            const isOff = daySchedule.mode === 'off';
            return (
            <div key={day} title={daySchedule.adjustment?.adjustmentReason || daySchedule.adjustment?.adjustmentName || ''} style={{ flex: 1, minWidth: '100px', textAlign: 'center', borderRight: '1px solid #ddd', fontWeight: 'bold', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: isOff ? '#e5e7eb' : '#fff' }}>
              <span>{WEEK_DAYS[day]}</span>
              {weekDates[day] && (
                <span style={{ fontSize: '11px', color: '#666', fontWeight: 'normal' }}>
                  {formatDate(weekDates[day])}
                </span>
              )}
              {isOff && <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>放假</span>}
              {daySchedule.mode === 'mapped' && (
                <span style={{ fontSize: '9px', color: '#475569', fontWeight: 'normal' }}>
                  采用第{daySchedule.normalWeek}周{WEEK_DAYS[daySchedule.normalDay]}课表
                </span>
              )}
            </div>
          );})}
        </div>

        {/* Body */}
        <div style={{ position: 'relative', height: totalHeight }}>
          {/* Time Axis & Grid Lines */}
          <div style={{ position: 'absolute', width: '100%', height: '100%', pointerEvents: 'none' }}>
             {renderGridLines()}
          </div>

          {/* Columns */}
          <div style={{ display: 'flex', height: '100%', position: 'absolute', width: '100%', top: 0 }}>
            <div style={{ width: '60px', flexShrink: 0, borderRight: '1px solid #ddd', background: '#f9f9f9', position: 'sticky', left: 0, zIndex: 5 }}>
              {renderTimeLabels()}
            </div>
            {days.map(day => (
              <div key={day} style={{ flex: 1, minWidth: '100px', borderRight: '1px solid #eee', position: 'relative', background: currentDaySchedules[day].mode === 'off' ? 'rgba(148, 163, 184, 0.2)' : 'transparent' }}>
                {/* Render Conflict Groups for this day */}
                {(dayGroups[day] || []).map((group, idx) => renderConflictGroup(group, idx))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CourseTable;
