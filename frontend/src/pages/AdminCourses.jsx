import React, { useEffect, useState, useRef } from 'react';
import axios from '../utils/axios';
import { useSemester } from '../contexts/SemesterContext';
import { DEPARTMENT_CODE_MAP, formatClassTimes, WEEK_DAYS, WEEK_TYPES } from '../utils';
import Modal from '../components/Modal';
import SemesterSelector from '../components/SemesterSelector';

// 课程时段编辑器组件
function ClassTimeEditor({ value = [], onChange }) {
  const [times, setTimes] = useState(value || []);

  useEffect(() => {
    setTimes(value || []);
  }, [value]);

  const handleChange = (newTimes) => {
    setTimes(newTimes);
    onChange(newTimes);
  };

  const addTime = () => {
    // Leave the day and periods for the user, while defaulting the common
    // semester range and full-week selection.
    // This button is inside CourseForm and must not submit the form.
    handleChange([...times, { day: '', start_period: '', end_period: '', week_range: '1-16', week_type: 0 }]);
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
            <select value={time.day ?? ''} onChange={(e) => updateTime(index, 'day', e.target.value ? parseInt(e.target.value) : '')}>
              <option value="">请选择</option>
              {[1,2,3,4,5,6,7].map(d => <option key={d} value={d}>{WEEK_DAYS[d]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px' }}>开始节</label>
            <select value={time.start_period ?? ''} onChange={(e) => updateTime(index, 'start_period', e.target.value ? parseInt(e.target.value) : '')}>
              <option value="">请选择</option>
              {Array.from({length: 12}, (_, i) => i + 1).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px' }}>结束节</label>
            <select value={time.end_period ?? ''} onChange={(e) => updateTime(index, 'end_period', e.target.value ? parseInt(e.target.value) : '')}>
              <option value="">请选择</option>
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
            <select value={time.week_type ?? ''} onChange={(e) => updateTime(index, 'week_type', e.target.value === '' ? '' : parseInt(e.target.value))}>
              <option value="">请选择</option>
              <option value={0}>全周</option>
              <option value={1}>单周</option>
              <option value={2}>双周</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeTime(index)}>删除</button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={addTime}>+ 添加上课时段</button>
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
          <label>执行计划编号 (UUID)</label>
          <input 
            type="text" 
            value={formData.uuid} 
            onChange={(e) => setFormData({...formData, uuid: e.target.value})}
            disabled={!!course?.uuid}
            style={course?.uuid ? { backgroundColor: '#f5f5f5' } : {}}
            placeholder="留空时自动生成"
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

function SemesterManager({ showModal, closeModal, onCreateCourse, onClearCourses }) {
  const {
    semesters,
    semesterConfigs,
    selectedSemester,
    setSelectedSemester,
    refreshSemesters,
  } = useSemester();
  const [showCreate, setShowCreate] = useState(false);
  const [academicYear, setAcademicYear] = useState('');
  const [term, setTerm] = useState('1');
  const [newMonday, setNewMonday] = useState('');
  const [monday, setMonday] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const config = semesterConfigs[selectedSemester] || {};
    setMonday(config.first_week_monday || '');
  }, [selectedSemester, semesterConfigs]);

  const createSemester = async (event) => {
    event.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      const name = `${academicYear}-${term}`;
      await axios.post('/api/admin/semesters', {
        name,
        academic_year: academicYear,
        term: Number(term),
        first_week_monday: newMonday,
      });
      await refreshSemesters();
      setSelectedSemester(name);
      setShowCreate(false);
      setAcademicYear('');
      setTerm('1');
      setNewMonday('');
      setStatus('学期创建成功');
    } catch (err) {
      setStatus(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateSemester = async () => {
    if (!selectedSemester) return;
    setSaving(true);
    setStatus('');
    try {
      await axios.put(`/api/admin/semesters/${selectedSemester}`, {
        first_week_monday: monday,
      });
      await refreshSemesters();
      setStatus('学期信息已保存');
    } catch (err) {
      setStatus(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteSemester = () => {
    if (!selectedSemester) return;
    const courseCount = semesterConfigs[selectedSemester]?.course_count || 0;
    showModal(
      '删除学期',
      `确定删除 ${selectedSemester}？该学期的 ${courseCount} 条开课记录将一并删除。`,
      async () => {
        try {
          await axios.delete(`/api/admin/semesters/${selectedSemester}`);
          closeModal();
          await refreshSemesters();
          setStatus('学期已删除');
        } catch (err) {
          closeModal();
          setStatus(err.response?.data?.message || err.message);
        }
      },
      true,
      'btn btn-danger',
    );
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>学期管理</h3>
            <SemesterSelector compact />
          </div>
          <div style={{ marginTop: '5px', color: '#64748b', fontSize: '13px' }}>
            {selectedSemester
              ? `${selectedSemester} · ${semesterConfigs[selectedSemester]?.course_count || 0} 条开课记录`
              : '尚未创建学期'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCreateCourse} disabled={!selectedSemester}>+ 创建课程</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreate(value => !value)}>
            {showCreate ? '取消创建' : '+ 新建学期'}
          </button>
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createSemester} style={{ marginTop: '18px', paddingTop: '18px', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div className="form-group">
              <label>学年</label>
              <input value={academicYear} onChange={event => setAcademicYear(event.target.value)} placeholder="26-27" required />
            </div>
            <div className="form-group">
              <label>学期</label>
              <select value={term} onChange={event => setTerm(event.target.value)}>
                <option value="1">第一学期</option>
                <option value="2">第二学期</option>
                <option value="3">第三学期</option>
              </select>
            </div>
            <div className="form-group">
              <label>第一周周一</label>
              <input type="date" value={newMonday} onChange={event => setNewMonday(event.target.value)} required />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>创建学期</button>
        </form>
      )}

      {selectedSemester && !showCreate && (
        <div style={{ marginTop: '18px', paddingTop: '18px', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            <div className="form-group">
              <label>第一周周一</label>
              <input type="date" value={monday} onChange={event => setMonday(event.target.value)} required />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" className="btn btn-primary" onClick={updateSemester} disabled={saving}>保存学期信息</button>
            <button type="button" className="btn btn-secondary" onClick={onClearCourses} disabled={saving}>清空课程</button>
            <button type="button" className="btn btn-danger" onClick={deleteSemester} disabled={saving}>删除学期</button>
          </div>
        </div>
      )}

      {status && <div style={{ marginTop: '12px', color: status.includes('成功') || status.includes('保存') || status.includes('删除') ? '#2f855a' : '#c62828', fontSize: '13px' }}>{status}</div>}
      {semesters.length === 0 && !showCreate && <div style={{ marginTop: '16px', color: '#64748b' }}>请先创建学期，再导入课程。</div>}
    </div>
  );
}

function CollegeEnglishPoolManager() {
  const [items, setItems] = useState([]);
  const [modules, setModules] = useState([]);
  const [moduleFilter, setModuleFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    course_id: '',
    course_name: '',
    module: 'C',
    active: true,
    notes: '',
    order_index: 0
  });
  const [courseSearch, setCourseSearch] = useState('');
  const [courseSearchResults, setCourseSearchResults] = useState([]);

  useEffect(() => {
    fetchPool();
  }, [moduleFilter]);

  const fetchPool = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/college-english/pool', {
        params: {
          module: moduleFilter || undefined,
          keyword: keyword || undefined,
          include_inactive: true
        }
      });
      setItems(res.data.items || []);
      setModules(res.data.modules || []);
    } catch (err) {
      setStatus('大学英语课程池加载失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      course_id: '',
      course_name: '',
      module: modules[0]?.value || 'C',
      active: true,
      notes: '',
      order_index: 0
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('');
    try {
      if (editingId) {
        await axios.put(`/api/college-english/pool/${editingId}`, formData);
        setStatus('大学英语课程池条目已更新');
      } else {
        await axios.post('/api/college-english/pool', formData);
        setStatus('大学英语课程池条目已新增');
      }
      resetForm();
      fetchPool();
    } catch (err) {
      setStatus('保存失败: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setFormData({
      course_id: item.course_id,
      course_name: item.course_name,
      module: item.module,
      active: item.active,
      notes: item.notes || '',
      order_index: item.order_index || 0
    });
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`确定删除 ${item.course_name} 吗？`)) return;
    try {
      await axios.delete(`/api/college-english/pool/${item.id}`);
      setStatus('已删除大学英语课程池条目');
      fetchPool();
    } catch (err) {
      setStatus('删除失败: ' + (err.response?.data?.message || err.message));
    }
  };

  const toggleActive = async (item) => {
    try {
      await axios.put(`/api/college-english/pool/${item.id}`, { active: !item.active });
      fetchPool();
    } catch (err) {
      setStatus('状态更新失败: ' + (err.response?.data?.message || err.message));
    }
  };

  const resetDefaults = async () => {
    if (!window.confirm('确定恢复默认大学英语课程池吗？当前课程池会被替换。')) return;
    try {
      const res = await axios.post('/api/college-english/pool/reset-defaults');
      setItems(res.data.items || []);
      setStatus(`已恢复默认课程池，共 ${res.data.created || 0} 条`);
      resetForm();
    } catch (err) {
      setStatus('恢复默认失败: ' + (err.response?.data?.message || err.message));
    }
  };

  const searchCourses = async () => {
    if (!courseSearch.trim()) {
      setCourseSearchResults([]);
      return;
    }
    try {
      const res = await axios.get('/api/courses', {
        params: {
          per_page: 10,
          distinct_mode: 'true',
          ...(courseSearch.trim().match(/^[A-Za-z0-9]+$/)
            ? { course_id: courseSearch.trim() }
            : { course_name: courseSearch.trim() })
        }
      });
      setCourseSearchResults(res.data.courses || []);
    } catch (err) {
      setStatus('课程搜索失败: ' + (err.response?.data?.message || err.message));
    }
  };

  const moduleName = (moduleValue) => modules.find(m => m.value === moduleValue)?.label || moduleValue;

  return (
    <div className="card requirement-pool">
      <div className="requirement-pool__header">
        <h2>大学英语课程池</h2>
        <button className="btn btn-secondary btn-sm" onClick={resetDefaults}>恢复默认</button>
      </div>

      <div className="requirement-pool__layout">
        <section className="requirement-pool__editor" aria-label="大学英语课程编辑">
          <h3>{editingId ? '编辑课程' : '新增课程'}</h3>
          <form onSubmit={handleSubmit} className="requirement-pool__form">
          <div className="form-group">
            <label>课程号</label>
            <input
              value={formData.course_id}
              onChange={e => setFormData({ ...formData, course_id: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>课程名称</label>
            <input
              value={formData.course_name}
              onChange={e => setFormData({ ...formData, course_name: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>模块</label>
            <select value={formData.module} onChange={e => setFormData({ ...formData, module: e.target.value })}>
              {modules.map(module => (
                <option key={module.value} value={module.value}>{module.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>排序</label>
            <input
              type="number"
              value={formData.order_index}
              onChange={e => setFormData({ ...formData, order_index: parseInt(e.target.value) || 0 })}
            />
          </div>
          <label className="requirement-pool__checkbox">
            <input
              type="checkbox"
              checked={formData.active}
              onChange={e => setFormData({ ...formData, active: e.target.checked })}
            />
            启用
          </label>
          <div className="form-group">
            <label>备注</label>
            <input
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>
          <div className="requirement-pool__form-actions">
            <button className="btn btn-primary btn-sm" type="submit">{editingId ? '保存修改' : '新增课程'}</button>
            {editingId && <button className="btn btn-secondary btn-sm" type="button" onClick={resetForm}>取消编辑</button>}
          </div>

          <div className="requirement-pool__lookup">
            <label>从课程主数据搜索</label>
            <div className="requirement-pool__lookup-controls">
              <input
                value={courseSearch}
                onChange={e => setCourseSearch(e.target.value)}
                placeholder="课程号或课程名"
              />
              <button type="button" className="btn btn-secondary btn-sm" onClick={searchCourses}>搜索</button>
            </div>
            {courseSearchResults.length > 0 && (
              <div className="requirement-pool__lookup-results">
                {courseSearchResults.map(course => (
                  <button
                    key={course.uuid}
                    type="button"
                    onClick={() => setFormData({ ...formData, course_id: course.course_id, course_name: course.course_name })}
                    className="requirement-pool__lookup-result"
                  >
                    {course.course_id} {course.course_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          </form>
        </section>

        <section className="requirement-pool__catalog" aria-label="大学英语课程列表">
          <h3>课程列表</h3>
          <div className="requirement-pool__filters">
            <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
              <option value="">全部模块</option>
              {modules.map(module => (
                <option key={module.value} value={module.value}>{module.label}</option>
              ))}
            </select>
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="搜索课程号或课程名"
            />
            <button className="btn btn-secondary btn-sm" onClick={fetchPool}>筛选</button>
          </div>

          {loading ? <div className="requirement-pool__state">加载中...</div> : (
            <div className="table-container requirement-pool__table-container">
              <table className="requirement-pool__table">
                <thead>
                  <tr>
                    <th>模块</th>
                    <th>课程号</th>
                    <th>课程名</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} style={{ opacity: item.active ? 1 : 0.55 }}>
                      <td>{moduleName(item.module)}</td>
                      <td>{item.course_id}</td>
                      <td>{item.course_name}</td>
                      <td>{item.active ? '启用' : '停用'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => handleEdit(item)}>编辑</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(item)}>
                            {item.active ? '停用' : '启用'}
                          </button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(item)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && <div className="requirement-pool__state">暂无课程池条目</div>}
            </div>
          )}
        </section>
      </div>

      {status && <div className={`requirement-pool__status${status.includes('失败') ? ' is-error' : ''}`} role="status">{status}</div>}
    </div>
  );
}

function LaborEducationPoolManager() {
  const [items, setItems] = useState([]);
  const [systems, setSystems] = useState([]);
  const [systemFilter, setSystemFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    course_id: '',
    course_name: '',
    course_system: '',
    credits: 0,
    labor_hours: 0,
  });

  const fetchPool = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/labor-education/pool', {
        params: {
          course_system: systemFilter || undefined,
          keyword: keyword || undefined,
        },
      });
      setItems(res.data.items || []);
      setSystems(res.data.course_systems || []);
    } catch (err) {
      setStatus('劳动教育课程池加载失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPool();
  }, [systemFilter]);

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      course_id: '',
      course_name: '',
      course_system: systems[0] || '',
      credits: 0,
      labor_hours: 0,
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus('');
    try {
      const payload = {
        ...formData,
        credits: Number(formData.credits),
        labor_hours: Number(formData.labor_hours),
      };
      if (editingId) {
        await axios.put(`/api/labor-education/pool/${editingId}`, payload);
        setStatus('劳动教育课程已更新');
      } else {
        await axios.post('/api/labor-education/pool', payload);
        setStatus('劳动教育课程已新增');
      }
      resetForm();
      fetchPool();
    } catch (err) {
      setStatus('保存失败: ' + (err.response?.data?.message || err.message));
    }
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setFormData({
      course_id: item.course_id,
      course_name: item.course_name,
      course_system: item.course_system,
      credits: item.credits,
      labor_hours: item.labor_hours,
    });
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`确定删除 ${item.course_name} 吗？`)) return;
    try {
      await axios.delete(`/api/labor-education/pool/${item.id}`);
      setStatus('劳动教育课程已删除');
      fetchPool();
    } catch (err) {
      setStatus('删除失败: ' + (err.response?.data?.message || err.message));
    }
  };

  const resetDefaults = async () => {
    if (!window.confirm('确定恢复默认劳动教育课程池吗？当前课程池会被替换。')) return;
    try {
      const res = await axios.post('/api/labor-education/pool/reset-defaults');
      setItems(res.data.items || []);
      setStatus(`已恢复默认课程池，共 ${res.data.created || 0} 条`);
      resetForm();
    } catch (err) {
      setStatus('恢复默认失败: ' + (err.response?.data?.message || err.message));
    }
  };

  return (
    <div className="card requirement-pool">
      <div className="requirement-pool__header">
        <h2>劳动教育课程池</h2>
        <button className="btn btn-secondary btn-sm" onClick={resetDefaults}>恢复默认</button>
      </div>

      <div className="requirement-pool__layout">
        <section className="requirement-pool__editor" aria-label="劳动教育课程编辑">
          <h3>{editingId ? '编辑课程' : '新增课程'}</h3>
          <form onSubmit={handleSubmit} className="requirement-pool__form">
          <div className="form-group">
            <label>课程号</label>
            <input value={formData.course_id} onChange={e => setFormData({ ...formData, course_id: e.target.value })} required maxLength={8} />
          </div>
          <div className="form-group">
            <label>课程名称</label>
            <input value={formData.course_name} onChange={e => setFormData({ ...formData, course_name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>课程体系</label>
            <input value={formData.course_system} onChange={e => setFormData({ ...formData, course_system: e.target.value })} required list="labor-course-systems" />
            <datalist id="labor-course-systems">
              {systems.map(system => <option key={system} value={system} />)}
            </datalist>
          </div>
          <div className="requirement-pool__field-row">
            <div className="form-group">
              <label>学分</label>
              <input type="number" min="0" step="0.5" value={formData.credits} onChange={e => setFormData({ ...formData, credits: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>劳动学时</label>
              <input type="number" min="0" step="1" value={formData.labor_hours} onChange={e => setFormData({ ...formData, labor_hours: e.target.value })} required />
            </div>
          </div>
          <div className="requirement-pool__form-actions">
            <button className="btn btn-primary btn-sm" type="submit">{editingId ? '保存修改' : '新增课程'}</button>
            {editingId && <button className="btn btn-secondary btn-sm" type="button" onClick={resetForm}>取消编辑</button>}
          </div>
          </form>
        </section>

        <section className="requirement-pool__catalog" aria-label="劳动教育课程列表">
          <h3>课程列表</h3>
          <div className="requirement-pool__filters">
            <select value={systemFilter} onChange={e => setSystemFilter(e.target.value)}>
              <option value="">全部课程体系</option>
              {systems.map(system => <option key={system} value={system}>{system}</option>)}
            </select>
            <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="搜索课程号或课程名" />
            <button className="btn btn-secondary btn-sm" onClick={fetchPool}>筛选</button>
          </div>
          {loading ? <div className="requirement-pool__state">加载中...</div> : (
            <div className="table-container requirement-pool__table-container">
              <table className="requirement-pool__table">
                <thead>
                  <tr><th>课程体系</th><th>课程号</th><th>课程名称</th><th>学分</th><th>劳动学时</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id}>
                      <td>{item.course_system}</td>
                      <td>{item.course_id}</td>
                      <td>{item.course_name}</td>
                      <td>{item.credits}</td>
                      <td>{item.labor_hours}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => handleEdit(item)}>编辑</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(item)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && <div className="requirement-pool__state">暂无课程池条目</div>}
            </div>
          )}
        </section>
      </div>
      {status && <div className={`requirement-pool__status${status.includes('失败') ? ' is-error' : ''}`} role="status">{status}</div>}
    </div>
  );
}

function AdminCourses() {
  const {
    semesters,
    selectedSemester,
    setSelectedSemester,
    refreshSemesters,
  } = useSemester();
  const [courses, setCourses] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [sourceSemester, setSourceSemester] = useState('');
  const [targetMode, setTargetMode] = useState('source');
  const [targetAcademicYear, setTargetAcademicYear] = useState('');
  const [importMode, setImportMode] = useState('append');
  const [importMonday, setImportMonday] = useState('');
  const [importing, setImporting] = useState(false);
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

  const targetSemester = (() => {
    if (!sourceSemester) return '';
    if (targetMode === 'source') return sourceSemester;
    const term = sourceSemester.split('-')[2];
    return targetAcademicYear ? `${targetAcademicYear}-${term}` : '';
  })();
  const targetSemesterExists = !!targetSemester && semesters.includes(targetSemester);

  const handleFileSelection = async (file) => {
    if (!file) return;
    setImportStatus('');
    try {
      const payload = JSON.parse(await file.text());
      const semester = payload?.metadata?.yearandseme;
      if (!/^\d{2}-\d{2}-[123]$/.test(semester || '') || !Array.isArray(payload?.courses)) {
        throw new Error('JSON 必须包含 metadata.yearandseme 和 courses 数组');
      }
      setImportFile(file);
      setSourceSemester(semester);
      setTargetMode('source');
      setTargetAcademicYear('');
      setImportMonday('');
    } catch (err) {
      setImportFile(null);
      setSourceSemester('');
      setImportStatus(err.message || '无法读取 JSON');
    }
  };

  const handleImport = async () => {
    if (!importFile || !targetSemester) {
      setImportStatus('请选择课程 JSON 和目标学期');
      return;
    }
    if (!targetSemesterExists && !importMonday) {
      setImportStatus('目标学期不存在，请提供第一周周一日期');
      return;
    }

    setImporting(true);
    setImportStatus('正在导入...');
    const formData = new FormData();
    formData.append('file', importFile);
    formData.append('import_mode', targetSemesterExists ? importMode : 'append');
    if (targetMode === 'other') {
      formData.append('target_academic_year', targetAcademicYear);
    }
    if (!targetSemesterExists) {
      formData.append('first_week_monday', importMonday);
    }

    try {
      const res = await axios.post('/api/admin/courses/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setImportStatus(res.data.message);
      await refreshSemesters();
      setSelectedSemester(res.data.target_semester);
      setImportFile(null);
      setSourceSemester('');
      if (fileInputRef.current) fileInputRef.current.value = null;
    } catch (err) {
      setImportStatus(err.response?.data?.message || err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    handleFileSelection(e.dataTransfer.files?.[0]);
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

      <div className="card management-import-card">
        <div className="management-import-card__header">
          <h2>课程与学期管理</h2>
        </div>
        <section className="management-import-card__section" aria-labelledby="course-data-import-title">
          <h3 id="course-data-import-title" className="management-import-card__section-title">课程 JSON 导入</h3>
          <div
          className="import-area" 
          style={{ 
            border: isDragging ? '2px dashed #0067c0' : '2px dashed #e0e0e0', 
            borderRadius: '0 0 8px 8px',
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
            accept=".json,application/json"
            onChange={(e) => handleFileSelection(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
          <div style={{ fontWeight: '600', color: '#333', marginBottom: '5px' }}>
            {isDragging ? '释放以选择文件' : (importFile ? importFile.name : '点击或拖拽选择课程 JSON')}
          </div>
          <div style={{ fontSize: '13px', color: '#888' }}>
            {sourceSemester ? `JSON 标识学期：${sourceSemester}` : '格式参考 data/courses 下的课程文件'}
          </div>
        </div>

          {importFile && (
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
            <div className="form-group">
              <label>目标学期</label>
              <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden' }}>
                <button type="button" onClick={() => setTargetMode('source')} style={{ border: 'none', padding: '8px 14px', background: targetMode === 'source' ? '#0067c0' : '#fff', color: targetMode === 'source' ? '#fff' : '#334155', cursor: 'pointer' }}>按 JSON 学期</button>
                <button type="button" onClick={() => setTargetMode('other')} style={{ border: 'none', borderLeft: '1px solid #cbd5e1', padding: '8px 14px', background: targetMode === 'other' ? '#0067c0' : '#fff', color: targetMode === 'other' ? '#fff' : '#334155', cursor: 'pointer' }}>改用其他学年</button>
              </div>
            </div>

            {targetMode === 'other' && (
              <div className="form-group" style={{ maxWidth: '260px' }}>
                <label>目标学年</label>
                <input value={targetAcademicYear} onChange={event => setTargetAcademicYear(event.target.value)} placeholder="27-28" />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              {targetSemesterExists && (
                <div className="form-group">
                  <label>导入方式</label>
                  <select value={importMode} onChange={event => setImportMode(event.target.value)}>
                    <option value="append">追加：保留未出现在 JSON 中的班级</option>
                    <option value="overwrite">覆盖：删除未出现在 JSON 中的班级</option>
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>实际目标学期</label>
                <input value={targetSemester} disabled />
              </div>
              {!targetSemesterExists && targetSemester && (
                <div className="form-group">
                  <label>新学期第一周周一</label>
                  <input type="date" value={importMonday} onChange={event => setImportMonday(event.target.value)} required />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={handleImport} disabled={importing || !targetSemester}>
                {importing
                  ? '导入中...'
                  : (!targetSemesterExists ? '导入并创建学期' : (importMode === 'overwrite' ? '覆盖导入' : '追加导入'))}
              </button>
              <span style={{ color: targetSemesterExists ? '#2f855a' : '#b45309', fontSize: '13px' }}>
                {targetSemester
                  ? (targetSemesterExists ? '目标学期已存在' : '目标学期不存在，将同时创建')
                  : '请输入目标学年'}
              </span>
            </div>
          </div>
        )}

          {importStatus && <p style={{ marginTop: '12px', color: importStatus.includes('完成') ? '#2f855a' : '#c62828', fontSize: '14px', whiteSpace: 'pre-line' }}>{importStatus}</p>}
        </section>
      </div>

      <SemesterManager
        showModal={showModal}
        closeModal={closeModal}
        onCreateCourse={handleCreate}
        onClearCourses={handleClearSemester}
      />

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

export { CollegeEnglishPoolManager, LaborEducationPoolManager };
export default AdminCourses;
