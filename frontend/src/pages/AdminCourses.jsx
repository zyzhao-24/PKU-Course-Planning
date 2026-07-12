import React, { useEffect, useState, useRef } from 'react';
import axios from '../utils/axios';
import { useSemester } from '../contexts/SemesterContext';
import { DEPARTMENT_CODE_MAP, formatClassTimes, WEEK_DAYS, WEEK_TYPES } from '../utils';
import Modal from '../components/Modal';
import SemesterSelector from '../components/SemesterSelector';

// 课程时段编辑器组件
function ClassTimeEditor({ value = [], onChange }) {
  const [times, setTimes] = useState(value);

  useEffect(() => {
    setTimes(value || []);
  }, [value]);

  const handleChange = (newTimes) => {
    setTimes(newTimes);
    onChange(newTimes);
  };

  const addTime = () => {
    handleChange([...times, { day: 1, start_period: 1, end_period: 2, week_range: '1-16', week_type: 0 }]);
  };

  const removeTime = (index) => {
    const newTimes = times.filter((_, i) => i !== index);
    handleChange(newTimes);
  };

  const updateTime = (index, field, value) => {
    const newTimes = times.map((t, i) => i === index ? { ...t, [field]: value } : t);
    handleChange(newTimes);
  };

  return (
    <div>
      {times.map((time, index) => (
        <div key={index} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '10px', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '6px' }}>
          <div>
            <label style={{ fontSize: '11px' }}>星期</label>
            <select value={time.day} onChange={(e) => updateTime(index, 'day', parseInt(e.target.value))}>
              {[1,2,3,4,5,6,7].map(d => <option key={d} value={d}>{WEEK_DAYS[d]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px' }}>开始节</label>
            <select value={time.start_period} onChange={(e) => updateTime(index, 'start_period', parseInt(e.target.value))}>
              {Array.from({length: 12}, (_, i) => i + 1).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px' }}>结束节</label>
            <select value={time.end_period} onChange={(e) => updateTime(index, 'end_period', parseInt(e.target.value))}>
              {Array.from({length: 12}, (_, i) => i + 1).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px' }}>周次</label>
            <input 
              type="text" 
              value={time.week_range || ''} 
              onChange={(e) => updateTime(index, 'week_range', e.target.value)}
              placeholder="如: 1-16"
            />
          </div>
          <div>
            <label style={{ fontSize: '11px' }}>单双周</label>
            <select value={time.week_type || 0} onChange={(e) => updateTime(index, 'week_type', parseInt(e.target.value))}>
              <option value={0}>全周</option>
              <option value={1}>单周</option>
              <option value={2}>双周</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-danger btn-sm" onClick={() => removeTime(index)}>删除</button>
          </div>
        </div>
      ))}
      <button className="btn btn-secondary btn-sm" onClick={addTime}>+ 添加上课时段</button>
    </div>
  );
}

// 课程编辑表单
function CourseForm({ course, onSave, onCancel, semester }) {
  const [formData, setFormData] = useState({
    uuid: '',
    course_id: '',
    course_name: '',
    course_type: '',
    department_code: '',
    class_number: '',
    credits: 2,
    semester: semester,
    class_times: [],
    teachers: [],
    remarks: '',
    ...course
  });

  const [teacherInput, setTeacherInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const addTeacher = () => {
    if (teacherInput.trim()) {
      setFormData({ ...formData, teachers: [...(formData.teachers || []), teacherInput.trim()] });
      setTeacherInput('');
    }
  };

  const removeTeacher = (index) => {
    setFormData({ ...formData, teachers: formData.teachers.filter((_, i) => i !== index) });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px', marginBottom: '15px' }}>
        <div className="form-group">
          <label>执行计划编号 (UUID) *</label>
          <input 
            type="text" 
            value={formData.uuid} 
            onChange={(e) => setFormData({...formData, uuid: e.target.value})}
            disabled={!!course?.uuid}
            style={course?.uuid ? { backgroundColor: '#f5f5f5' } : {}}
            required
          />
        </div>
        <div className="form-group">
          <label>课程号 *</label>
          <input 
            type="text" 
            value={formData.course_id} 
            onChange={(e) => setFormData({...formData, course_id: e.target.value})}
            required
          />
        </div>
        <div className="form-group">
          <label>班号</label>
          <input 
            type="text" 
            value={formData.class_number || ''} 
            onChange={(e) => setFormData({...formData, class_number: e.target.value})}
          />
        </div>
        <div className="form-group" style={{ gridColumn: 'span 2' }}>
          <label>课程名称 *</label>
          <input 
            type="text" 
            value={formData.course_name} 
            onChange={(e) => setFormData({...formData, course_name: e.target.value})}
            required
          />
        </div>
        <div className="form-group">
          <label>课程类型</label>
          <input 
            type="text" 
            value={formData.course_type || ''} 
            onChange={(e) => setFormData({...formData, course_type: e.target.value})}
            placeholder="如: 专业必修"
          />
        </div>
        <div className="form-group">
          <label>学分</label>
          <input 
            type="number" 
            step="0.5"
            value={formData.credits} 
            onChange={(e) => setFormData({...formData, credits: parseFloat(e.target.value)})}
          />
        </div>
        <div className="form-group">
          <label>开课院系</label>
          <select value={formData.department_code || ''} onChange={(e) => setFormData({...formData, department_code: e.target.value})}>
            <option value="">请选择</option>
            {Object.entries(DEPARTMENT_CODE_MAP).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>学期</label>
          <input type="text" value={formData.semester} disabled />
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: '15px' }}>
        <label>教师</label>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <input 
            type="text" 
            value={teacherInput}
            onChange={(e) => setTeacherInput(e.target.value)}
            placeholder="输入教师姓名"
            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTeacher())}
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={addTeacher}>添加</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {(formData.teachers || []).map((teacher, i) => (
            <span key={i} style={{ background: '#e3f2fd', padding: '2px 8px', borderRadius: '4px', fontSize: '13px' }}>
              {teacher} <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#666' }} onClick={() => removeTeacher(i)}>×</button>
            </span>
          ))}
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: '15px' }}>
        <label>上课时段</label>
        <ClassTimeEditor 
          value={formData.class_times} 
          onChange={(times) => setFormData({...formData, class_times: times})} 
        />
      </div>

      <div className="form-group" style={{ marginBottom: '15px' }}>
        <label>备注</label>
        <input 
          type="text" 
          value={formData.remarks || ''} 
          onChange={(e) => setFormData({...formData, remarks: e.target.value})}
        />
      </div>

      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>取消</button>
        <button type="submit" className="btn btn-primary">{course?.uuid ? '保存修改' : '创建课程'}</button>
      </div>
    </form>
  );
}

function AdminCourses() {
  const { selectedSemester } = useSemester();
  const [courses, setCourses] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef();

  // Search States
  const [searchId, setSearchId] = useState('');
  const [searchName, setSearchName] = useState('');
  const [searchDept, setSearchDept] = useState('');
  const [searchType, setSearchType] = useState('');
  const [searchDay, setSearchDay] = useState('');
  const [searchPeriod, setSearchPeriod] = useState('');
  const [courseTypes, setCourseTypes] = useState([]);

  // Debounce state
  const [debouncedSearchId, setDebouncedSearchId] = useState(searchId);
  const [debouncedSearchName, setDebouncedSearchName] = useState(searchName);

  // Debounce effect
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchId(searchId);
      setDebouncedSearchName(searchName);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchId, searchName]);

  const [modal, setModal] = useState({
    isOpen: false,
    title: '',
    content: null,
    onConfirm: () => {},
    showCancel: true,
    confirmButtonClass: 'btn btn-primary',
    hideFooter: false
  });

  const showModal = (title, content, onConfirm, showCancel = true, confirmButtonClass = 'btn btn-primary', hideFooter = false) => {
    setModal({ isOpen: true, title, content, onConfirm, showCancel, confirmButtonClass, hideFooter });
  };

  const closeModal = () => {
    setModal(prev => ({ ...prev, isOpen: false }));
  };

  const fetchCourseTypes = async () => {
    try {
      const res = await axios.get(`/api/course_types?semester=${selectedSemester}`);
      setCourseTypes(res.data.types);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (selectedSemester) {
      fetchCourses();
      fetchCourseTypes();
    }
  }, [selectedSemester, page, debouncedSearchId, debouncedSearchName, searchDept, searchType, searchDay, searchPeriod]);

  const fetchCourses = async () => {
    setLoading(true);
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
      
      const res = await axios.get('/api/courses', { params });
      setCourses(res.data.courses || []);
      setTotalPages(res.data.pages || 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    setImportStatus(`正在导入 ${fileList.length} 个文件...`);

    let successCount = 0;
    let errorMessages = [];

    for (const file of fileList) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await axios.post('/api/admin/courses/import', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        successCount++;
      } catch (err) {
        errorMessages.push(`${file.name}: ${err.response?.data?.message || err.message}`);
      }
    }

    if (errorMessages.length > 0) {
      setImportStatus(`导入完成: ${successCount}/${fileList.length} 成功\n错误:\n${errorMessages.join('\n')}`);
    } else {
      setImportStatus(`成功导入 ${successCount} 个文件`);
    }
    
    fetchCourses();
    fetchCourseTypes();
    
    // 重置文件输入
    if (fileInputRef.current) {
      fileInputRef.current.value = null;
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleClearSemester = () => {
    showModal('确认清空', `确定要清空${selectedSemester}学期的所有课程吗？此操作不可恢复！`, async () => {
      try {
        await axios.delete(`/api/admin/courses/clear?semester=${selectedSemester}`);
        fetchCourses();
        closeModal();
        setImportStatus('已清空');
      } catch (err) {
        closeModal();
        showModal('错误', '清空失败: ' + (err.response?.data?.message || err.message), closeModal, false);
      }
    }, true, 'btn btn-danger');
  };

  const handleDelete = (course) => {
    showModal('确认删除', `确定要删除课程 "${course.course_name}" 吗？`, async () => {
      try {
        await axios.delete(`/api/admin/courses/${course.uuid}`);
        fetchCourses();
        closeModal();
      } catch (err) {
        closeModal();
        showModal('错误', '删除失败: ' + (err.response?.data?.message || err.message), closeModal, false);
      }
    });
  };

  const handleCreate = () => {
    showModal('创建课程', 
      <CourseForm 
        semester={selectedSemester} 
        onSave={async (data) => {
          try {
            await axios.post('/api/admin/courses', data);
            fetchCourses();
            closeModal();
          } catch (err) {
            alert('创建失败: ' + (err.response?.data?.message || err.message));
          }
        }}
        onCancel={closeModal}
      />, 
      () => {}, 
      false,
      'btn btn-primary',
      true
    );
  };

  const handleEdit = (course) => {
    showModal('编辑课程', 
      <CourseForm 
        course={course}
        semester={selectedSemester}
        onSave={async (data) => {
          try {
            await axios.put(`/api/admin/courses/${course.uuid}`, data);
            fetchCourses();
            closeModal();
          } catch (err) {
            alert('保存失败: ' + (err.response?.data?.message || err.message));
          }
        }}
        onCancel={closeModal}
      />, 
      () => {}, 
      false,
      'btn btn-primary',
      true
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
        hideFooter={modal.hideFooter}
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
          marginBottom: '15px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>课程管理</h3>
            <SemesterSelector />
          </div>
          <button className="btn btn-primary" onClick={handleCreate}>+ 创建课程</button>
        </div>
      </div>

      <div className="card">
        <h3>数据导入</h3>
        <div 
          className="import-area" 
          style={{ 
            border: isDragging ? '2px dashed #0067c0' : '2px dashed #e0e0e0', 
            borderRadius: '8px', 
            padding: '30px 20px', 
            textAlign: 'center',
            backgroundColor: isDragging ? '#f0f7ff' : '#fafafa',
            cursor: 'pointer',
            transition: 'all 0.2s',
            marginBottom: '15px'
          }}
          onClick={() => fileInputRef.current.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onMouseOver={(e) => { if (!isDragging) { e.currentTarget.style.borderColor = '#0067c0'; e.currentTarget.style.backgroundColor = '#f0f7ff'; }}}
          onMouseOut={(e) => { if (!isDragging) { e.currentTarget.style.borderColor = '#e0e0e0'; e.currentTarget.style.backgroundColor = '#fafafa'; }}}
        >
          <input 
            type="file" 
            ref={fileInputRef}
            accept=".json"
            multiple
            onChange={(e) => handleFileUpload(e.target.files)}
            style={{ display: 'none' }}
          />
          <div style={{ fontSize: '32px', marginBottom: '10px' }}>📂</div>
          <div style={{ fontWeight: '600', color: '#333', marginBottom: '5px' }}>
            {isDragging ? '释放以上传文件' : '点击或拖拽上传课程数据文件'}
          </div>
          <div style={{ fontSize: '13px', color: '#888' }}>支持 .json 格式，可多选文件</div>
        </div>
        {importStatus && <p style={{ marginTop: '10px', color: '#666', fontSize: '14px' }}>{importStatus}</p>}
        
        <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
          <button className="btn btn-danger" onClick={handleClearSemester}>清空学期</button>
        </div>
      </div>

      <div className="card">
        <h3>筛选条件</h3>
        <div className="search-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
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

        <h3>课程列表</h3>
        {loading ? <div>加载中...</div> : (
          <>
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
                    <th>备注</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map(course => (
                    <tr key={course.uuid}>
                      <td>{course.course_id}</td>
                      <td>{course.class_number}</td>
                      <td>{course.course_name}</td>
                      <td>{course.course_type}</td>
                      <td>{course.credits}</td>
                      <td>{DEPARTMENT_CODE_MAP[course.department_code] || course.department_code}</td>
                      <td>{course.teachers?.join(', ')}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>{formatClassTimes(course.class_times)}</td>
                      <td>{course.remarks}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => handleEdit(course)}>编辑</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(course)}>删除</button>
                        </div>
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
          </>
        )}
      </div>
    </div>
  );
}

export default AdminCourses;
