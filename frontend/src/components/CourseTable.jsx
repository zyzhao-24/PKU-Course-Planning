import React, { useState, useEffect, useMemo } from 'react';
import axios from '../utils/axios';
import { WEEK_DAYS, WEEK_TYPES, getWeekDate, formatDate } from '../utils';
import Modal from './Modal';

// ==================== 常量定义 ====================

// 课程节次定义
const PERIODS = {
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
  12: { start: '20:40', end: '21:30' }
};

// 考试时段定义 (与后端一致：1=上午, 2=下午, 3=晚上)
const EXAM_PERIODS = {
  1: { start: '08:30', end: '10:30', label: '上午' },
  2: { start: '14:00', end: '16:00', label: '下午' },
  3: { start: '18:30', end: '20:30', label: '晚上' }
};

// 堂考判断：考试时段对应的课程节次范围
const EXAM_CLASS_PERIOD_RANGES = {
  1: { min: 1, max: 4 },
  2: { min: 5, max: 9 },
  3: { min: 10, max: 12 }
};

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

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function CourseTable({ courses, semester, firstWeekMonday, examInfos = [], onWeekChange }) {
  const [currentWeek, setCurrentWeek] = useState(1);
  
  const days = [1, 2, 3, 4, 5, 6, 7];

  // 当周次变化时通知父组件
  useEffect(() => {
    if (onWeekChange) {
      onWeekChange(currentWeek);
    }
  }, [currentWeek, onWeekChange]);

  const getMaxWeeks = (sem) => {
    if (!sem) return 18;
    const parts = sem.split('-');
    const lastPart = parts[parts.length - 1];
    return lastPart === '3' ? 5 : 18;
  };

  const maxWeeks = getMaxWeeks(semester);

  useEffect(() => {
    setCurrentWeek(1);
  }, [semester]);

  // ==================== 考试处理函数 ====================
  
  /**
   * 解析考试日期为周次和星期几
   */
  const parseExamDate = (dateStr) => {
    if (!dateStr || !firstWeekMonday) return null;
    
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = parseInt(dateStr.substring(6, 8));
    const examDate = new Date(year, month, day);
    
    // 第0周的星期一
    const baseMonday = new Date(firstWeekMonday);
    baseMonday.setDate(baseMonday.getDate() - 7);
    
    const diffDays = Math.round((examDate - baseMonday) / (24 * 60 * 60 * 1000));
    const week = Math.floor(diffDays / 7);
    const dayOfWeek = (diffDays % 7) + 1;
    
    if (week < 0 || week > maxWeeks) return null;
    return { week, day: dayOfWeek };
  };

  const isInClassExam = (examInfo, course, examDateInfo) => {
    if (!examInfo?.date || !course.class_times || !examDateInfo) return false;
    
    // 检查考试周次是否在课程的上课周次范围内
    // 如果课程在考试周没有课，则肯定不是堂考
    const hasClassInExamWeek = course.class_times.some(ct => {
      if (!ct.week_range) return true; // 无周次限制则认为有课
      const weeks = parseWeeks(ct.week_range);
      return weeks.includes(examDateInfo.week);
    });
    if (!hasClassInExamWeek) return false;
    
    // 检查考试日期当天是否有课
    const dayClasses = course.class_times.filter(t => t.day === examDateInfo.day);
    if (dayClasses.length === 0) return false;
    
    // 检查是否有课程时段与考试时段匹配
    const periodRange = EXAM_CLASS_PERIOD_RANGES[examInfo.period];
    if (!periodRange) return false;
    
    return dayClasses.some(ct => {
      // 检查该课程时段在考试周是否有效（单双周）
      if (ct.week_type === 1 && examDateInfo.week % 2 === 0) return false;
      if (ct.week_type === 2 && examDateInfo.week % 2 !== 0) return false;
      // 检查周次范围
      if (ct.week_range) {
        const weeks = parseWeeks(ct.week_range);
        if (!weeks.includes(examDateInfo.week)) return false;
      }
      // 检查时段是否匹配
      return Math.max(ct.start_period, periodRange.min) <= Math.min(ct.end_period, periodRange.max);
    });
  };

  const getExamTimeRange = (examInfo, isInClass, course, examDateInfo) => {
    if (isInClass && course && examDateInfo) {
      // 堂考：使用课程实际时间
      const dayClasses = course.class_times.filter(t => t.day === examDateInfo.day);
      // 找到与考试时段匹配的课程时段
      const periodRange = EXAM_CLASS_PERIOD_RANGES[examInfo.period];
      const matchedClass = dayClasses.find(ct => 
        Math.max(ct.start_period, periodRange.min) <= Math.min(ct.end_period, periodRange.max)
      );
      if (matchedClass) {
        const pStart = PERIODS[matchedClass.start_period];
        const pEnd = PERIODS[matchedClass.end_period];
        if (pStart && pEnd) {
          return { start: timeToMinutes(pStart.start), end: timeToMinutes(pEnd.end) };
        }
      }
    }
    // 非堂考：使用固定考试时段
    const ep = EXAM_PERIODS[examInfo.period];
    if (!ep) return null;
    return { start: timeToMinutes(ep.start), end: timeToMinutes(ep.end) };
  };

  // ==================== 统一事件处理 ====================
  
  /**
   * 创建统一格式的事件对象
   */
  const createEvent = (type, data) => {
    const base = {
      type, // 'course' | 'exam'
      course_id: data.course_id,
      class_number: data.class_number,
      credits: parseFloat(data.credits || 0),
      colorset: getCourseColor(data.course_id),
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
  const processDayEvents = (day, courses, exams, currentWeek) => {
    const events = [];
    
    // 1. 收集课程事件
    courses.forEach(course => {
      if (!course.class_times) return;
      course.class_times.forEach(ct => {
        // 检查单双周
        if (ct.week_type === 1 && currentWeek % 2 === 0) return;
        if (ct.week_type === 2 && currentWeek % 2 !== 0) return;
        // 检查周次范围
        if (ct.week_range) {
          const weeks = parseWeeks(ct.week_range);
          if (!weeks.includes(currentWeek)) return;
        }
        // 检查是否匹配当天
        if (ct.day !== day) return;
        
        const pStart = PERIODS[ct.start_period];
        const pEnd = PERIODS[ct.end_period];
        if (!pStart || !pEnd) return;
        
        events.push(createEvent('course', {
          course_id: course.course_id,
          class_number: course.class_number,
          credits: course.credits,
          name: course.course_name + (course.channel === 0 ? '（主）' : '（双）'),
          start_time: timeToMinutes(pStart.start),
          end_time: timeToMinutes(pEnd.end),
          location: ct.location || '',
          remarks: course.remarks || '',
          teachers: course.teachers || [],
          _original: { course, classTime: ct }
        }));
      });
    });
    
    // 2. 收集考试事件
    exams.forEach(({ examInfo, course, examDateInfo, isInClass, timeRange }) => {
      if (examDateInfo.day !== day) return;
      
      events.push(createEvent('exam', {
        course_id: course.course_id,
        class_number: course.class_number,
        credits: course.credits,
        name: course.course_name + (course.channel === 0 ? '（主）' : '（双）'),
        start_time: timeRange.start,
        end_time: timeRange.end,
        location: examInfo.location || '',
        remarks: '',
        teachers: course.teachers || [],
        exam_period: examInfo.period,
        _original: { course, examInfo, isInClass }
      }));
    });
    
    // 3. 按时间排序
    events.sort((a, b) => {
      if (a.start_time !== b.start_time) return a.start_time - b.start_time;
      return a.end_time - b.end_time;
    });
    
    // 4. 合并冲突事件为组
    const groups = [];
    let currentGroup = null;
    
    events.forEach(event => {
      if (!currentGroup) {
        // 开始新组
        currentGroup = {
          start: event.start_time,
          end: event.end_time,
          events: [event],
          isConflict: false
        };
      } else if (event.start_time < currentGroup.end) {
        // 时间重叠，加入当前组
        currentGroup.events.push(event);
        currentGroup.end = Math.max(currentGroup.end, event.end_time);
        currentGroup.isConflict = true;
      } else {
        // 无重叠，结束当前组，开始新组
        groups.push(currentGroup);
        currentGroup = {
          start: event.start_time,
          end: event.end_time,
          events: [event],
          isConflict: false
        };
      }
    });
    
    if (currentGroup) {
      groups.push(currentGroup);
    }
    
    return groups;
  };

  const parseWeeks = (weeksStr) => {
    if (!weeksStr) return [];
    const weeks = [];
    weeksStr.split(',').forEach(part => {
      if (part.includes('-')) {
        const [s, e] = part.split('-').map(Number);
        for (let i = s; i <= e; i++) weeks.push(i);
      } else {
        weeks.push(Number(part));
      }
    });
    return weeks;
  };

  // ==================== 主处理逻辑 ====================
  
  const { startHour, endHour, totalHeight, dayGroups } = useMemo(() => {
    // 处理考试
    const currentWeekExams = [];
    examInfos.forEach(examInfo => {
      const examDateInfo = parseExamDate(examInfo.date);
      if (!examDateInfo || examDateInfo.week !== currentWeek) return;
      const course = courses.find(c => c.course_id === examInfo.courseId);
      if (!course) return;
      const isInClass = isInClassExam(examInfo, course, examDateInfo);
      const timeRange = getExamTimeRange(examInfo, isInClass, course, examDateInfo);
      if (!timeRange) return;
      currentWeekExams.push({ examInfo, course, examDateInfo, isInClass, timeRange });
    });

    // 按天处理事件组
    const groupsByDay = {};
    days.forEach(day => {
      groupsByDay[day] = processDayEvents(day, courses, currentWeekExams, currentWeek);
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
  }, [courses, currentWeek, examInfos, firstWeekMonday]);

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
    for (const examInfo of examInfos) {
      const examDateInfo = parseExamDate(examInfo.date);
      if (!examDateInfo || examDateInfo.week !== currentWeek) continue;
      const course = courses.find(c => c.course_id === examInfo.courseId);
      if (!course) continue;
      const isInClass = isInClassExam(examInfo, course, examDateInfo);
      if (!isInClass) return true; // 有非堂考考试
    }
    return false;
  }, [examInfos, courses, currentWeek]);

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
        key={`${event.type}-${event.start_time}`}
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
          boxSizing: 'border-box'
        }}
      >
        {/* 课号-班号 xx学分 */}
        <div style={{ 
          fontSize: '10px', 
          fontWeight: 'bold', 
          color: textColor,
          marginBottom: '2px'
        }}>
          {event.course_id}-{event.class_number} {event.credits.toFixed(1)}学分
        </div>
        
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
          backgroundColor: '#ffebee',
          border: `2px solid #c62828`,
          borderRadius: '4px',
          padding: '4px',
          fontSize: '11px',
          overflow: 'hidden',
          zIndex: 3,
          boxShadow: '0 0 8px rgba(198, 40, 40, 0.4)',
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
              key={`evt-${idx}`}
              style={{
                flexShrink: 0,
                paddingBottom: isLast ? 0 : '4px',
                borderBottom: isLast ? 'none' : `1px dashed ${event.colorset.border}`,
                minHeight: 0
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
                <span>⚠</span>
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
        <div style={{ display: 'flex', height: '40px', borderBottom: '1px solid #ddd', position: 'sticky', top: 0, background: '#fff', zIndex: 10 }}>
          <div style={{ width: '60px', flexShrink: 0, borderRight: '1px solid #ddd', background: '#f9f9f9', zIndex: 11 }}></div>
          {days.map(day => (
            <div key={day} style={{ flex: 1, minWidth: '100px', textAlign: 'center', borderRight: '1px solid #ddd', fontWeight: 'bold', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span>{WEEK_DAYS[day]}</span>
              {weekDates[day] && (
                <span style={{ fontSize: '11px', color: '#666', fontWeight: 'normal' }}>
                  {formatDate(weekDates[day])}
                </span>
              )}
            </div>
          ))}
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
              <div key={day} style={{ flex: 1, minWidth: '100px', borderRight: '1px solid #eee', position: 'relative' }}>
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