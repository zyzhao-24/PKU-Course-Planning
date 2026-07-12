import React, { useEffect, useState } from 'react';
import axios from '../utils/axios';
import { useSemester } from '../contexts/SemesterContext';
import { DEPARTMENT_CODE_MAP, formatClassTimes, WEEK_DAYS, checkTimeConflict } from '../utils';
import Modal from '../components/Modal';
import SemesterSelector from '../components/SemesterSelector';

function StudentCourses() {
  const { selectedSemester } = useSemester();
  const [courses, setCourses] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  const [searchId, setSearchId] = useState('');
  const [searchName, setSearchName] = useState('');
  const [searchDept, setSearchDept] = useState('');
  const [searchType, setSearchType] = useState('');
  const [searchDay, setSearchDay] = useState('');
  const [searchPeriod, setSearchPeriod] = useState('');
  const [courseTypes, setCourseTypes] = useState([]);
  
  const [selectedCourseUuids, setSelectedCourseUuids] = useState(new Set());
  const [selectedCoursesDetails, setSelectedCoursesDetails] = useState([]);
  const [conflicts, setConflicts] = useState(new Set());
  const [transcriptCourseIds, setTranscriptCourseIds] = useState(new Set()); // 成绩单中的课程号（排除W）
  const [allSemesterSelectedCourses, setAllSemesterSelectedCourses] = useState([]); // 所有学期已选课程

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

  // 加载时自动选课和同步课表
  useEffect(() => {
    if (selectedSemester) {
      fetchCourseTypes();
      fetchSelectedCourses();
    }
  }, [selectedSemester]);

  // 自动选课并同步课表信息
  const autoSelectAndSync = async () => {
    try {
      // 1. 请求自动选课
      const autoSelectRes = await axios.post('/api/student/transcript/auto-select', {
        semester: selectedSemester
      });
      
      if (autoSelectRes.data.success && autoSelectRes.data.auto_selected_count > 0) {
        // 有新课程被选中，刷新列表
        await fetchSelectedCourses();
      }
      
      // 2. 请求更新课程地点和考试信息
      const parts = selectedSemester.split('-');
      if (parts.length === 3) {
        const year = `${parts[0]}-${parts[1]}`;
        const semester = parts[2];
        
        await axios.post('/api/student/schedule/sync', {
          year,
          semester,
          target_semester: selectedSemester
        });
        
        // 刷新以获取更新的地点信息
        await fetchSelectedCourses();
      }
    } catch (err) {
      console.error('自动选课或同步失败:', err);
    }
  };

  const fetchCourseTypes = async () => {
    try {
      const res = await axios.get(`/api/course_types?semester=${selectedSemester}`);
      setCourseTypes(res.data.types);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSelectedCourses = async () => {
    if (!selectedSemester) return;
    try {
      // 1. 获取成绩单，识别已有成绩的课程（排除W成绩）
      const transcriptRes = await axios.get('/api/student/transcript');
      let newTranscriptCourseIds = new Set();
      if (transcriptRes.data.success) {
        const transcripts = transcriptRes.data.transcripts || [];
        const allTranscriptCourses = [];
        transcripts.forEach(term => {
          if (term.courses) {
            allTranscriptCourses.push(...term.courses);
          }
        });
        // 记录成绩单中的课程号（排除W成绩）
        newTranscriptCourseIds = new Set(
          allTranscriptCourses
            .filter(c => c.score !== 'W')
            .map(c => c.course_id)
        );
      }
      setTranscriptCourseIds(newTranscriptCourseIds);

      // 2. 获取当前学期已选课程
      const res = await axios.get(`/api/student/selected?semester=${selectedSemester}`);
      const uuids = new Set(res.data.selected_uuids);
      setSelectedCourseUuids(uuids);
      
      const details = res.data.selected_details.map(d => ({
          uuid: d.course_uuid,
          course_name: d.course_name,
          class_times: d.class_times,
          week_range: d.week_range,
          course_id: d.course_id,
          department_code: d.department_code
      }));
      setSelectedCoursesDetails(details);

      // 3. 获取所有学期已选课程（用于检查同课号+同学院限制）
      const allRes = await axios.get('/api/student/selected');
      if (allRes.data.selected_details) {
        setAllSemesterSelectedCourses(allRes.data.selected_details.map(d => ({
          course_id: d.course_id,
          department_code: d.department_code,
          semester: d.semester
        })));
      }
    } catch (err) {
      console.error("获取已选课程失败", err);
    }
  };

  useEffect(() => {
    const newConflicts = new Set();
    if (selectedCoursesDetails.length > 0 && courses.length > 0) {
        courses.forEach(course => {
            if (selectedCourseUuids.has(course.uuid)) return;
            for (const selected of selectedCoursesDetails) {
                if (checkTimeConflict(course, selected)) {
                    newConflicts.add(course.uuid);
                    break; 
                }
            }
        });
    }
    setConflicts(newConflicts);
  }, [courses, selectedCoursesDetails, selectedCourseUuids]);

  const fetchCourses = async () => {
    if (!selectedSemester) return;
    try {
      const params = {
        page,
        per_page: 20,
        semester: selectedSemester,
        course_id: searchId,
        course_name: searchName,
        department_code: searchDept,
        course_type: searchType,
        day: searchDay || undefined,
        period: searchPeriod || undefined
      };
      
      const response = await axios.get('/api/courses', { params });
      setCourses(response.data.courses);
      setTotalPages(response.data.pages);
    } catch (error) {
      console.error("获取课程失败", error);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, [page, selectedSemester, searchId, searchName, searchDept, searchType, searchDay, searchPeriod]);

  const handleSelectCourse = async (courseUuid, channel = 0) => {
    try {
      const res = await axios.post('/api/student/selected', {
        semester: selectedSemester,
        course_uuid: courseUuid,
        channel: channel  // 0=主修，1=辅双
      });
      if (res.data.success) {
        fetchSelectedCourses();
      }
    } catch (error) {
      alert('选课失败: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleDropCourse = async (courseUuid) => {
    showModal('确认退课', '确定要退选这门课吗？', async () => {
      try {
        await axios.delete(`/api/student/selected?semester=${selectedSemester}&course_uuid=${courseUuid}`);
        fetchSelectedCourses();
        closeModal();
      } catch (error) {
        closeModal();
        showModal('错误', '退课失败: ' + (error.response?.data?.message || error.message), closeModal, false);
      }
    }, true, 'btn btn-danger');
  };

  /**
   * 检查课程是否已选（同课号+同学院编号）
   */
  const isAlreadySelected = (course) => {
    return allSemesterSelectedCourses.some(
      selected => selected.course_id === course.course_id && 
                  selected.department_code === course.department_code
    );
  };

  return (
    <div>
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

      <div className="card">
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
          <h3 style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>课程列表</h3>
          <SemesterSelector />
        </div>

        <div className="search-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginTop: '15px', marginBottom: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '12px' }}>课程号</label>
            <input type="text" value={searchId} onChange={(e) => { setSearchId(e.target.value); setPage(1); }} placeholder="输入课程号" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '12px' }}>课程名称</label>
            <input type="text" value={searchName} onChange={(e) => { setSearchName(e.target.value); setPage(1); }} placeholder="输入课程名称" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '12px' }}>开课院系</label>
            <select value={searchDept} onChange={(e) => { setSearchDept(e.target.value); setPage(1); }}>
              <option value="">全部院系</option>
              {Object.entries(DEPARTMENT_CODE_MAP).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '12px' }}>上课时间</label>
            <div style={{ display: 'flex', gap: '5px' }}>
              <select value={searchDay} onChange={(e) => { setSearchDay(e.target.value); setPage(1); }} style={{ flex: 1 }}>
                <option value="">星期</option>
                {[1,2,3,4,5,6,7].map(d => <option key={d} value={d}>{WEEK_DAYS[d]}</option>)}
              </select>
              <select value={searchPeriod} onChange={(e) => { setSearchPeriod(e.target.value); setPage(1); }} style={{ flex: 1 }}>
                <option value="">节次</option>
                {Array.from({length: 12}, (_, i) => i + 1).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', display: 'block', marginBottom: '5px' }}>课程类别</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}>
              <input type="radio" name="courseType" value="" checked={searchType === ''} onChange={(e) => { setSearchType(e.target.value); setPage(1); }} />
              全部
            </label>
            {courseTypes.map(type => (
              <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}>
                <input type="radio" name="courseType" value={type} checked={searchType === type} onChange={(e) => { setSearchType(e.target.value); setPage(1); }} />
                {type}
              </label>
            ))}
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>课程号</th>
                <th>班号</th>
                <th>课程名称</th>
                <th>类型</th>
                <th>学分</th>
                <th>开课院系</th>
                <th>教师</th>
                <th>上课时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {courses.map(course => (
                <tr key={course.uuid} className={conflicts.has(course.uuid) ? 'conflict-row' : ''}>
                  <td>{course.course_id}</td>
                  <td>{course.class_number}</td>
                  <td>{course.course_name}</td>
                  <td>{course.course_type}</td>
                  <td>{course.credits}</td>
                  <td>{DEPARTMENT_CODE_MAP[course.department_code] || course.department_code}</td>
                  <td>{course.teachers?.join(', ')}</td>
                  <td style={{ whiteSpace: 'pre-line' }}>{formatClassTimes(course.class_times)}{course.remarks ? <><br/>(备注：{course.remarks || ''})</> : ''}</td>
                  <td>
                    {selectedCourseUuids.has(course.uuid) ? (
                      transcriptCourseIds.has(course.course_id) ? (
                        <span style={{ color: '#666', fontSize: '12px', padding: '4px 8px' }}>已有成绩</span>
                      ) : (
                        <div style={{ display: 'flex', gap: '4px', minWidth: '110px' }}>
                          <button 
                            className="btn btn-danger btn-sm" 
                            onClick={() => handleDropCourse(course.uuid)}
                            title = "退课"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '12px' }}
                          >
                            退课
                          </button>
                        </div>
                      )
                    ) : isAlreadySelected(course) ? (
                      <span style={{ color: '#666', fontSize: '12px', padding: '4px 8px' }}>已选同名课程</span>
                    ) : (
                      <div style={{ display: 'flex', gap: '4px', minWidth: '110px' }}>
                        <button 
                          className={`btn btn-sm ${conflicts.has(course.uuid) ? 'btn-warning' : 'btn-primary'}`} 
                          onClick={() => handleSelectCourse(course.uuid, 0)} 
                          title={conflicts.has(course.uuid) ? "时间冲突" : "主修选课"}
                          style={{ flex: 1, padding: '4px 8px', fontSize: '12px' }}
                        >
                          {conflicts.has(course.uuid) ? "冲突（主）" : "主修"}
                        </button>
                        <button 
                          className={`btn btn-sm ${conflicts.has(course.uuid) ? 'btn-warning' : 'btn-secondary'}`} 
                          onClick={() => handleSelectCourse(course.uuid, 1)} 
                          title={conflicts.has(course.uuid) ? "时间冲突" : "辅双选课"}
                          style={{ flex: 1, padding: '4px 8px', fontSize: '12px' }}
                        >
                          {conflicts.has(course.uuid) ? "冲突（双）" : "辅双"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="pagination">
          <button className="btn btn-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          <span>第 {page} / {totalPages} 页</span>
          <button className="btn btn-secondary" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      </div>
    </div>
  );
}

export default StudentCourses;
