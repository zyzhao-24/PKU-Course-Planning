import React, { useEffect, useState, useRef } from 'react';
import axios from '../utils/axios';
import { useSemester } from '../contexts/SemesterContext';
import CourseTable from '../components/CourseTable';
import { formatClassTimes, DEPARTMENT_CODE_MAP, WEEK_DAYS, formatExamInfo } from '../utils';
import {
  buildFixedBusyIndex,
  findActivityConflictDetails,
  findFixedScheduleConflictOwners,
  getSemesterMaxWeeks,
} from '../utils/scheduleConflicts';
import Modal from '../components/Modal';
import PortalConnectModal from '../components/PortalConnectModal';
import SemesterSelector from '../components/SemesterSelector';
import ActivityEditorModal from '../components/ActivityEditorModal';
import ActivityConflictConfirmation from '../components/ActivityConflictConfirmation';
import { useActivities } from '../contexts/ActivityContext';
import { formatActivityTimeEntry } from '../utils/activityPresentation';

function StudentSchedule() {
  const { selectedSemester, semesterConfigs, getFirstWeekMonday } = useSemester();
  const firstWeekMonday = getFirstWeekMonday();
  const scheduleAdjustments = semesterConfigs[selectedSemester]?.schedule_adjustments || [];
  const {
    activities,
    loading: activitiesLoading,
    error: activitiesError,
    createActivity,
    updateActivity,
    deleteActivity,
  } = useActivities();
  const [courseDetails, setCourseDetails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [conflicts, setConflicts] = useState(new Set());
  const [selectedIds, setSelectedIds] = useState({});
  const [programNodes, setProgramNodes] = useState([]);
  const [portalConnectOpen, setPortalConnectOpen] = useState(false);
  const [autoSelectedUuids, setAutoSelectedUuids] = useState(new Set()); // 自动选课的课程
  const [activityEditor, setActivityEditor] = useState({ isOpen: false, activity: null });

  const [modal, setModal] = useState({
    isOpen: false,
    title: '',
    content: null,
    onConfirm: () => {},
    showCancel: true,
    confirmButtonClass: 'btn btn-primary'
  });

  const showModal = (title, content, onConfirm, showCancel = true, confirmButtonClass = 'btn btn-primary') => {
    setModal({ isOpen: true, title, content, onConfirm, showCancel, confirmButtonClass });
  };

  const closeModal = () => {
    setModal(prev => ({ ...prev, isOpen: false }));
  };

  useEffect(() => {
    fetchProgramNodes();
  }, []);

  useEffect(() => {
    if (selectedSemester) {
      fetchData();
    }
  }, [selectedSemester]);

  const fetchProgramNodes = async () => {
    // 新API：/api/student/progress 返回 { major: {...}, minor: {...} }
    try {
      const res = await axios.get('/api/student/progress');
      if (res.data.success) {
        // 合并主修和辅双的所有节点
        const allNodes = [];
        if (res.data.progress?.major?.categories) {
          res.data.progress.major.categories.forEach(cat => {
            if (cat.nodes) allNodes.push(...cat.nodes);
          });
        }
        if (res.data.progress?.minor?.categories) {
          res.data.progress.minor.categories.forEach(cat => {
            if (cat.nodes) allNodes.push(...cat.nodes);
          });
        }
        setProgramNodes(allNodes);
      }
    } catch (err) {
      console.error("Failed to fetch program nodes", err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. 获取成绩单，识别自动选课的课程
      const transcriptRes = await axios.get('/api/student/transcript');
      let transcriptCourseIds = new Set();
      if (transcriptRes.data.success) {
        const transcripts = transcriptRes.data.transcripts || [];
        const allTranscriptCourses = [];
        transcripts.forEach(term => {
          if (term.courses) {
            allTranscriptCourses.push(...term.courses);
          }
        });
        // 记录成绩单中的课程号（排除W成绩）
        transcriptCourseIds = new Set(
          allTranscriptCourses
            .filter(c => c.score !== 'W')
            .map(c => c.course_id)
        );
      }

      const res = await axios.get(`/api/student/selected?semester=${selectedSemester}`);
      const details = res.data.selected_details || [];
      
      const idMap = {};
      const newAutoSelectedUuids = new Set();
      details.forEach(d => {
        idMap[d.course_uuid] = d.id;
        // 检查是否来自成绩单自动选课
        if (transcriptCourseIds.has(d.course_id)) {
          newAutoSelectedUuids.add(d.course_uuid);
        }
      });
      setSelectedIds(idMap);
      setAutoSelectedUuids(newAutoSelectedUuids);

      const uuids = details.map(d => d.course_uuid).filter(Boolean);
      let fullCourses = [];
      
      if (uuids.length > 0) {
        const batchRes = await axios.post('/api/courses/batch', { uuids });
        const courseMap = {};
        batchRes.data.courses.forEach(c => {
          courseMap[c.uuid] = c;
        });
        
      fullCourses = details.map(d => ({
          ...(courseMap[d.course_uuid] || {}),
          // 使用选课记录的 class_times（包含地点）和 exam_info
          class_times: d.class_times || courseMap[d.course_uuid]?.class_times || [],
          exam_info: d.exam_info || {},
          channel: d.channel,  // 添加 channel 字段
          // 确保 credits 从课程信息中获取
          credits: d.credits || courseMap[d.course_uuid]?.credits || 0
        }));
      }
      
      const allCourses = [...fullCourses];
      setCourseDetails(allCourses);
    } catch (error) {
      console.error("获取课表失败", error);
    } finally {
      setLoading(false);
    }
  };

  const checkConflicts = (courses) => {
    setConflicts(findFixedScheduleConflictOwners(courses, {
      semester: selectedSemester,
      firstWeekMonday,
      activities,
      adjustments: scheduleAdjustments,
    }));
  };

  useEffect(() => {
    checkConflicts(courseDetails);
  }, [courseDetails, activities, selectedSemester, semesterConfigs]);

  const closeActivityEditor = () => setActivityEditor({ isOpen: false, activity: null });

  const persistActivity = async (payload) => {
    if (activityEditor.activity?.uuid) {
      await updateActivity(activityEditor.activity.uuid, payload);
    } else {
      await createActivity(payload);
    }
    closeActivityEditor();
  };

  const handleSaveActivity = async (payload) => {
    const draft = {
      ...payload,
      uuid: activityEditor.activity?.uuid || 'activity-draft',
    };
    const otherActivities = activities.filter(item => item.uuid !== activityEditor.activity?.uuid);
    const busyIndex = buildFixedBusyIndex(courseDetails, {
      semester: selectedSemester,
      firstWeekMonday,
      activities: otherActivities,
      adjustments: scheduleAdjustments,
    });
    const conflictDetails = findActivityConflictDetails(draft, busyIndex);
    if (!conflictDetails.length) {
      await persistActivity(payload);
      return;
    }

    showModal(
      '确认时间冲突',
      <ActivityConflictConfirmation activity={draft} details={conflictDetails} />,
      async () => {
        closeModal();
        try {
          await persistActivity(payload);
        } catch (error) {
          showModal('错误', error.response?.data?.message || error.message, closeModal, false, 'btn btn-danger');
        }
      },
      true,
      'btn btn-warning',
    );
  };

  const requestDeleteActivity = (activity) => {
    showModal(
      '删除活动',
      `确定删除“${activity.title}”吗？`,
      async () => {
        try {
          await deleteActivity(activity.uuid);
          closeModal();
          closeActivityEditor();
        } catch (error) {
          closeModal();
          showModal('错误', error.response?.data?.message || error.message, closeModal, false, 'btn btn-danger');
        }
      },
      true,
      'btn btn-danger',
    );
  };

  const handleClearAll = () => {
    showModal('确认清空', '确定要清空当前学期的所有已选课程吗？此操作不可恢复！', async () => {
      try {
        await axios.delete(`/api/student/selected?semester=${selectedSemester}`);
        fetchData();
        closeModal();
      } catch (error) {
        closeModal();
        showModal('错误', '清空失败', closeModal, false);
      }
    }, true, 'btn btn-danger');
  };

  const handleDropCourse = (uuid) => {
    showModal('确认退课', '确定要退选这门课吗？', async () => {
      try {
        await axios.delete(`/api/student/selected?semester=${selectedSemester}&course_uuid=${uuid}`);
        fetchData();
        closeModal();
      } catch (error) {
        closeModal();
        showModal('错误', '退课失败', closeModal, false);
      }
    }, true, 'btn btn-danger');
  };

  const pdfContentRef = useRef(null);
  
  const handleExportPDF = async () => {
    // 获取课程表容器元素
    const tableContainer = document.getElementById('course-table-scroll-container');
    if (!tableContainer) {
      alert('无法找到课程表元素');
      return;
    }

    try {
      // 收集课程表的 HTML 内容（只收集表格部分，不包括周次选择器）
      const tableHtml = tableContainer.innerHTML;
      
      // 计算总学分和课程数
      const totalCredits = courseDetails.reduce((sum, c) => sum + parseFloat(c.credits || 0), 0);
      const courseCount = courseDetails.length;
      
      // 发送请求到后端生成 PDF
      const response = await axios.post('/api/student/schedule/pdf', {
        html: tableHtml,
        semester: selectedSemester,
        week: currentWeek,
        total_credits: totalCredits.toFixed(1),
        course_count: courseCount
      }, {
        responseType: 'blob'  // 重要：接收二进制数据
      });

      // 创建下载链接
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `课表_${selectedSemester}_第${currentWeek}周.pdf`);
      document.body.appendChild(link);
      link.click();
      
      // 清理
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('PDF导出失败:', error);
      alert('PDF导出失败: ' + (error.response?.data?.message || error.message));
    }
  };

  // 获取当前周次状态（从 CourseTable 组件获取）
  const [currentWeek, setCurrentWeek] = useState(1);
  
  // 处理周次变化回调
  const handleWeekChange = (week) => {
    setCurrentWeek(week);
  };

  // 同步课程表（自动调用，不显示按钮）
  const syncSchedule = async () => {
    // 解析学期格式 "25-26-1" -> year="25-26", semester="1"
    const parts = selectedSemester.split('-');
    if (parts.length !== 3) {
      console.error('学期格式错误');
      return;
    }
    const year = `${parts[0]}-${parts[1]}`;
    const semester = parts[2];
    
    setSyncing(true);
    try {
      const res = await axios.post('/api/student/schedule/sync', {
        year,
        semester,
        target_semester: selectedSemester
      });
      
      if (res.data.success) {
        console.log('课表同步成功:', res.data.message);
        fetchData(); // 刷新数据
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      if (err.response?.data?.portal_required) {
        setPortalConnectOpen(true);
        return;
      }
      console.error('同步课表失败:', errorMsg);
    } finally {
      setSyncing(false);
    }
  };

  // 手动同步按钮（保留但改为自动调用）
  const handleSyncSchedule = async () => {
    await syncSchedule();
  };

  if (!selectedSemester) return <div className="card">请先选择学期</div>;

  return (
    <div>
      <ActivityEditorModal
        isOpen={activityEditor.isOpen}
        activity={activityEditor.activity}
        semester={selectedSemester}
        maxWeeks={getSemesterMaxWeeks(selectedSemester)}
        firstWeekMonday={firstWeekMonday}
        onCancel={closeActivityEditor}
        onSave={handleSaveActivity}
        onDelete={requestDeleteActivity}
      />
      <Modal 
        isOpen={modal.isOpen} 
        title={modal.title} 
        onConfirm={modal.onConfirm} 
        onCancel={closeModal}
        showCancel={modal.showCancel}
        confirmButtonClass={modal.confirmButtonClass}
      >
        {modal.content}
      </Modal>
      <PortalConnectModal
        isOpen={portalConnectOpen}
        onCancel={() => setPortalConnectOpen(false)}
        onConnected={async () => {
          setPortalConnectOpen(false);
          await syncSchedule();
        }}
      />

      <div className="card" id="schedule-card">
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: '15px',
          borderBottom: '1px solid #edf2f7',
          paddingBottom: '12px'
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>我的课表</h3>
            <SemesterSelector compact />
          </div>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'bold', color: '#555' }}>
              总学分: <span style={{ color: '#2c3e50', fontSize: '1.2em' }}>{courseDetails.reduce((sum, c) => sum + parseFloat(c.credits || 0), 0)}</span>
            </span>
            <span style={{ fontWeight: 'bold', color: '#555' }}>
              课程数: <span style={{ color: '#2c3e50', fontSize: '1.2em' }}>{courseDetails.length}</span>
            </span>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setActivityEditor({ isOpen: true, activity: null })}
              >
                添加活动
              </button>
              <button className="btn btn-secondary" onClick={handleSyncSchedule} disabled={syncing}>
                {syncing ? '同步中...' : '同步课表'}
              </button>
              <button className="btn btn-primary" onClick={handleExportPDF}>导出PDF</button>
              <button className="btn btn-danger" onClick={handleClearAll}>清空所有课程</button>
            </div>
          </div>
        </div>
        
        {loading ? <div>加载中...</div> : (
          <CourseTable 
            courses={courseDetails} 
            activities={activities}
            adjustments={scheduleAdjustments}
            semester={selectedSemester} 
            firstWeekMonday={firstWeekMonday}
            onWeekChange={handleWeekChange}
            onActivityClick={activity => setActivityEditor({ isOpen: true, activity })}
          />
        )}
      </div>

      <div className="card">
        <h3>活动列表</h3>
        {activitiesError && <div className="status-bar status-error">{activitiesError}</div>}
        {activitiesLoading ? <div>加载中...</div> : activities.length === 0 ? (
          <div style={{ padding: '14px 0', color: '#64748b', fontSize: '13px' }}>暂无活动</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>活动</th>
                  <th>时间及地点</th>
                  <th>冲突检查</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {activities.map(activity => (
                  <tr key={activity.uuid} className={conflicts.has(activity.uuid) ? 'conflict-row' : ''}>
                    <td>{activity.title}</td>
                    <td style={{ whiteSpace: 'pre-line' }}>
                      {(activity.time_entries || []).map(formatActivityTimeEntry).join('\n')}
                    </td>
                    <td>{(() => {
                      const blockingCount = (activity.time_entries || []).filter(entry => entry.blocking !== false).length;
                      if (blockingCount === 0) return '不参与';
                      if (blockingCount === (activity.time_entries || []).length) return '全部参与';
                      return '部分参与';
                    })()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => setActivityEditor({ isOpen: true, activity })}>编辑</button>
                        <button className="btn btn-danger btn-sm" onClick={() => requestDeleteActivity(activity)}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>已选课程列表</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>课程号</th>
                <th>班号</th>
                <th>课程名称</th>
                <th>类型</th>
                <th>选课类别</th>
                <th>学分</th>
                <th>开课院系</th>
                <th>教师</th>
                <th>上课时间</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {courseDetails.map(course => (
                <tr key={course.uuid} className={conflicts.has(course.uuid) ? 'conflict-row' : ''}>
                  <td>{course.course_id}</td>
                  <td>{course.class_number}</td>
                  <td>{course.course_name}</td>
                  <td>{course.course_type}</td>
                  <td>
                    <span style={{ 
                      padding: '2px 8px', 
                      borderRadius: '4px', 
                      fontSize: '12px',
                      backgroundColor: course.channel === 0 ? '#f5f5f5' : '#e3f2fd',
                      color: course.channel === 0 ? '#333' : '#1565c0',
                      border: `1px solid ${course.channel === 0 ? '#e0e0e0' : '#90caf9'}`
                    }}>
                      {course.channel === 0 ? '主修' : '辅双'}
                    </span>
                  </td>
                  <td>{course.credits}</td>
                  <td>{DEPARTMENT_CODE_MAP[course.department_code] || course.department_code}</td>
                  <td>{course.teachers?.join(', ')}</td>
                  <td style={{ whiteSpace: 'pre-line' }}>{formatClassTimes(course.class_times)}</td>
                  <td>{course.remarks}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      {autoSelectedUuids.has(course.uuid) ? (
                        <span style={{ color: '#666', fontSize: '12px', padding: '4px 8px' }}>已有成绩</span>
                      ) : (
                        <button className="btn btn-danger btn-sm" onClick={() => handleDropCourse(course.uuid)}>退课</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 考试信息表格 */}
      <div className="card">
        <h3>考试信息</h3>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>课程名称</th>
                <th>考试日期</th>
                <th>时段</th>
                <th>地点</th>
              </tr>
            </thead>
            <tbody>
              {courseDetails.filter(c => c.exam_info && c.exam_info.date).length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', color: '#666' }}>
                    暂无考试安排
                  </td>
                </tr>
              ) : (
                courseDetails
                  .filter(c => c.exam_info && c.exam_info.date)
                  .map(course => {
                    // 使用已有函数计算周次和星期
                    const examDateStr = course.exam_info.date; // YYYYMMDD
                    const year = parseInt(examDateStr.substring(0, 4));
                    const month = parseInt(examDateStr.substring(4, 6));
                    const day = parseInt(examDateStr.substring(6, 8));
                    
                    // 计算周次和星期（复用CourseTable逻辑）
                    let weekInfo = '';
                    if (firstWeekMonday) {
                      const examDate = new Date(year, month - 1, day);
                      const baseMonday = new Date(firstWeekMonday);
                      baseMonday.setDate(baseMonday.getDate() - 7); // 第0周
                      const diffDays = Math.round((examDate - baseMonday) / (24 * 60 * 60 * 1000));
                      const week = Math.floor(diffDays / 7);
                      const dayOfWeek = (diffDays % 7) + 1;
                      weekInfo = ` 第${week}周 ${WEEK_DAYS[dayOfWeek]}`;
                    }
                    
                    return (
                      <tr key={`exam-${course.uuid}`}>
                        <td>{course.course_name}</td>
                        <td>{`${year}年${month}月${day}日${weekInfo}`}</td>
                        <td>{formatExamInfo(course.exam_info).split(' ')[1] || '-'}</td>
                        <td>{course.exam_info.location || '-'}</td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default StudentSchedule;
