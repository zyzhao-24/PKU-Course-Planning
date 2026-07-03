import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from '../utils/axios';
import Modal from '../components/Modal';
import { DEPARTMENT_CODE_MAP, getFilterDescription, getCourseListRulesDescription, getNodeRulesDescription } from '../utils';

// ==================== 辅助组件：JSON编辑器 ====================

function JsonEditor({ value, onChange, placeholder = '{}' }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      setText(JSON.stringify(value || {}, null, 2));
      setError(null);
    } catch (e) {
      setText(String(value));
    }
  }, [value]);

  const handleChange = (newText) => {
    setText(newText);
    try {
      const parsed = JSON.parse(newText);
      setError(null);
      onChange(parsed);
    } catch (e) {
      setError('JSON格式错误');
    }
  };

  return (
    <div>
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder={placeholder}
        style={{ 
          width: '100%', 
          minHeight: '120px', 
          fontFamily: 'monospace',
          fontSize: '12px',
          borderColor: error ? '#dc3545' : undefined
        }}
      />
      {error && <div style={{ color: '#dc3545', fontSize: '12px', marginTop: '5px' }}>{error}</div>}
    </div>
  );
}

// ==================== 辅助组件：数组编辑器 ====================

function ArrayEditor({ value, onChange, placeholder = '[]' }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      setText(JSON.stringify(value || [], null, 2));
      setError(null);
    } catch (e) {
      setText(String(value));
    }
  }, [value]);

  const handleChange = (newText) => {
    setText(newText);
    try {
      const parsed = JSON.parse(newText);
      if (!Array.isArray(parsed)) {
        throw new Error('必须是数组');
      }
      setError(null);
      onChange(parsed);
    } catch (e) {
      setError(e.message || '格式错误');
    }
  };

  return (
    <div>
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder={placeholder}
        style={{ 
          width: '100%', 
          minHeight: '120px', 
          fontFamily: 'monospace',
          fontSize: '12px',
          borderColor: error ? '#dc3545' : undefined
        }}
      />
      {error && <div style={{ color: '#dc3545', fontSize: '12px', marginTop: '5px' }}>{error}</div>}
    </div>
  );
}

// ==================== 可搜索下拉框组件（修复版）====================
function SearchableSelect({ options, value, onChange, placeholder = '请选择...' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 安全处理
  const safeOptions = Array.isArray(options) ? options : [];
  const safeValue = value || '';
  
  const filteredOptions = safeOptions.filter(opt => 
    opt && opt.label && (
      opt.label.toLowerCase().includes((searchTerm || '').toLowerCase()) ||
      opt.value.toLowerCase().includes((searchTerm || '').toLowerCase())
    )
  );

  const selectedOption = safeOptions.find(opt => opt.value === safeValue);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '8px 12px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          cursor: 'pointer',
          backgroundColor: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>{selectedOption ? selectedOption.label : placeholder}</span>
        <span style={{ fontSize: '10px' }}>▼</span>
      </div>
      
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          backgroundColor: 'white',
          border: '1px solid #ccc',
          borderRadius: '4px',
          marginTop: '4px',
          zIndex: 1000,
          maxHeight: '250px',
          overflowY: 'auto',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          <div style={{ padding: '8px', borderBottom: '1px solid #eee' }}>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="搜索..."
              style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}
              autoFocus
            />
          </div>
          {filteredOptions.map(opt => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
                setSearchTerm('');
              }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                backgroundColor: opt.value === safeValue ? '#e3f2fd' : 'transparent',
                fontSize: '13px'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = opt.value === safeValue ? '#e3f2fd' : '#f5f5f5'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = opt.value === safeValue ? '#e3f2fd' : 'transparent'}
            >
              {opt.label}
            </div>
          ))}
          {filteredOptions.length === 0 && (
            <div style={{ padding: '12px', color: '#999', textAlign: 'center', fontSize: '13px' }}>
              无匹配结果
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== 可变数量下拉框组件 ====================
function MultiSelectDropdowns({ options, values, onChange, placeholder, searchable = false }) {
  const addDropdown = () => {
    onChange([...values, '']);
  };

  const removeDropdown = (index) => {
    const newValues = values.filter((_, i) => i !== index);
    onChange(newValues.length > 0 ? newValues : []);
  };

  const updateValue = (index, val) => {
    const newValues = [...values];
    newValues[index] = val;
    onChange(newValues);
  };

  return (
    <div>
      {(values || []).length === 0 ? (
        <div style={{ color: '#999', fontSize: '13px', marginBottom: '10px' }}>
          未选择任何条件，将匹配所有
        </div>
      ) : (
        values.map((val, index) => (
          <div key={index} style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' }}>
            {searchable ? (
              <div style={{ flex: 1 }}>
                <SearchableSelect
                  options={options}
                  value={val}
                  onChange={(newVal) => updateValue(index, newVal)}
                  placeholder={placeholder}
                />
              </div>
            ) : (
              <select
                value={val}
                onChange={(e) => updateValue(index, e.target.value)}
                style={{ flex: 1, padding: '8px' }}
              >
                <option value="">请选择...</option>
                {options.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
            <button 
              className="btn btn-danger btn-sm" 
              onClick={() => removeDropdown(index)}
              style={{ padding: '6px 12px' }}
            >
              删除
            </button>
          </div>
        ))
      )}
      <button 
        className="btn btn-secondary btn-sm" 
        onClick={addDropdown}
        style={{ marginTop: '5px' }}
      >
        + 添加条件
      </button>
    </div>
  );
}

// ==================== 筛选条件构建器 ====================

function FilterBuilder({ value, onChange, allCourses }) {
  const [filters, setFilters] = useState(value || {});
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [batchInput, setBatchInput] = useState('');
  const [showBatchInput, setShowBatchInput] = useState(false);

  // 提取所有唯一的院系、课程类型、教师
  const departments = [...new Set(allCourses.map(c => c.department_code).filter(Boolean))].sort();
  const departmentOptions = departments.map(code => ({
    value: code,
    label: `${DEPARTMENT_CODE_MAP[code] || '未知院系'} (${code})`
  }));
  
  const courseTypes = [...new Set(allCourses.map(c => c.course_type).filter(Boolean))].sort();
  
  // 提取所有教师
  const allTeachers = new Set();
  allCourses.forEach(c => {
    if (c.teachers) {
      c.teachers.forEach(t => allTeachers.add(t));
    }
  });
  const teachers = [...allTeachers].sort();
  const teacherOptions = teachers.map(t => ({ value: t, label: t }));

  const updateFilter = (key, val) => {
    const newFilters = { ...filters };
    if (val === null || val === undefined || (Array.isArray(val) && val.length === 0)) {
      delete newFilters[key];
    } else {
      newFilters[key] = val;
    }
    setFilters(newFilters);
    onChange(newFilters);
  };

  const addCourseId = (courseId) => {
    const currentIds = filters.course_id || [];
    if (!currentIds.includes(courseId)) {
      updateFilter('course_id', [...currentIds, courseId]);
    }
  };

  const removeCourseId = (courseId) => {
    const currentIds = filters.course_id || [];
    updateFilter('course_id', currentIds.filter(id => id !== courseId));
  };

  const handleBatchAdd = () => {
    const ids = batchInput.split(/[\n,，]/)
      .map(id => id.trim())
      .filter(id => id.length > 0);
    
    const currentIds = filters.course_id || [];
    const newIds = [...new Set([...currentIds, ...ids])];
    updateFilter('course_id', newIds);
    setBatchInput('');
    setShowBatchInput(false);
  };

  // 实时搜索
  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }
    const results = allCourses.filter(c => 
      c.course_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.course_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setSearchResults(
      results
      .filter(
        (item, index, self) => index === self.findIndex((t) => t.course_id === item.course_id)
      )
    );
  }, [searchTerm, allCourses]);

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '15px' }}>
      <h4 style={{ margin: '0 0 15px 0', fontSize: '14px' }}>筛选条件构建器</h4>
      
      {/* 课程号选择 */}
      <div style={{ marginBottom: '15px' }}>
        <label style={{ fontWeight: 'bold', fontSize: '13px', display: 'block', marginBottom: '8px' }}>
          指定课程号
        </label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="输入课程号或名称实时搜索..."
            style={{ flex: 1 }}
          />
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={() => setShowBatchInput(!showBatchInput)}
          >
            批量
          </button>
        </div>
        
        {/* 批量录入 */}
        {showBatchInput && (
          <div style={{ marginBottom: '10px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
              每行输入一个课程号，或逗号分隔：
            </div>
            <textarea
              value={batchInput}
              onChange={e => setBatchInput(e.target.value)}
              placeholder="001001&#10;001002, 001003"
              style={{ width: '100%', height: '80px', fontSize: '12px', marginBottom: '8px' }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-primary btn-sm" onClick={handleBatchAdd}>添加</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowBatchInput(false)}>取消</button>
            </div>
          </div>
        )}
        
        {/* 实时搜索结果 */}
        {searchResults.length > 0 && (
          <div style={{ 
            maxHeight: '200px', 
            overflowY: 'auto', 
            border: '1px solid #e0e0e0',
            borderRadius: '4px',
            marginBottom: '15px'
          }}>
            <div style={{ padding: '8px', backgroundColor: '#f8f9fa', fontSize: '12px', color: '#666', borderBottom: '1px solid #e0e0e0' }}>
              点击添加课程：
            </div>
            {searchResults.map(course => (
              <div 
                key={course.uuid}
                onClick={() => {
                  addCourseId(course.course_id);
                  setSearchTerm('');
                  setSearchResults([]);
                }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f0f0f0',
                  fontSize: '13px'
                }}
                onMouseEnter={e => e.target.style.backgroundColor = '#f5f5f5'}
                onMouseLeave={e => e.target.style.backgroundColor = 'transparent'}
              >
                <div style={{ fontWeight: 'bold' }}>{course.course_id}</div>
                <div style={{ color: '#666', fontSize: '12px' }}>{course.course_name}</div>
              </div>
            ))}
          </div>
        )}

        {/* 已选课程号标签 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '15px' }}>
          {(filters.course_id || []).map(id => (
            <span 
              key={id}
              style={{
                padding: '4px 8px',
                backgroundColor: '#e3f2fd',
                borderRadius: '4px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              {id}
              <button 
                onClick={() => removeCourseId(id)}
                style={{ 
                  border: 'none', 
                  background: 'none', 
                  cursor: 'pointer',
                  padding: '0 2px',
                  color: '#666'
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        {/* 已选课程详情 */}
        {(() => {
          // 检查是否有任何筛选条件
          const hasFilters = (filters.course_id?.length > 0) || 
                            (filters.dept?.length > 0) || 
                            (filters.course_type?.length > 0) || 
                            (filters.teachers?.length > 0);
          
          // 没有筛选条件时不显示列表，防止卡顿
          if (!hasFilters) return null;
          
          // 计算满足所有筛选条件的课程
          const filteredCourses = allCourses.filter(c => {
            // 检查课程号
            if (filters.course_id?.length > 0 && !filters.course_id.includes(c.course_id)) {
              return false;
            }
            // 检查院系
            if (filters.dept?.length > 0 && !filters.dept.includes(c.department_code)) {
              return false;
            }
            // 检查课程类型
            if (filters.course_type?.length > 0 && !filters.course_type.includes(c.course_type)) {
              return false;
            }
            // 检查教师
            if (filters.teachers?.length > 0) {
              const courseTeachers = c.teachers || [];
              const hasMatchingTeacher = filters.teachers.some(t => courseTeachers.includes(t));
              if (!hasMatchingTeacher) {
                return false;
              }
            }
            return true;
          }).filter(
            (item, index, self) => index === self.findIndex(
              (t) => t.course_id === item.course_id &&
              t.department_code === item.department_code &&
              t.course_type === item.course_type
            )
          );
          
          if (filteredCourses.length === 0) return null;
          
          return (
            <div style={{ 
              border: '1px solid #e0e0e0', 
              borderRadius: '4px', 
              marginBottom: '15px',
              maxHeight: '250px',
              overflowY: 'auto'
            }}>
              <div style={{ padding: '8px 12px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #e0e0e0', fontSize: '12px', fontWeight: 'bold' }}>
                已筛选的课程（{filteredCourses.length}门）：
              </div>
              {filteredCourses.map(course => (
                <div 
                  key={course.uuid}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid #f0f0f0',
                    fontSize: '13px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{course.course_id} - {course.course_name}</div>
                      <div style={{ color: '#666', fontSize: '12px', marginTop: '3px' }}>
                        {DEPARTMENT_CODE_MAP[course.department_code] || course.department_code} | {course.course_type} | {course.credits}学分
                      </div>
                    </div>
                    <button 
                      className="btn btn-danger btn-sm"
                      onClick={() => removeCourseId(course.course_id)}
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* 院系筛选 - 使用可变数量下拉框 */}
      <div style={{ marginBottom: '15px' }}>
        <label style={{ fontWeight: 'bold', fontSize: '13px', display: 'block', marginBottom: '8px' }}>
          开课院系
        </label>
        <MultiSelectDropdowns
          options={departmentOptions}
          values={filters.dept || []}
          onChange={(vals) => updateFilter('dept', vals)}
          placeholder="选择院系"
        />
      </div>

      {/* 课程类型筛选 */}
      <div style={{ marginBottom: '15px' }}>
        <label style={{ fontWeight: 'bold', fontSize: '13px', display: 'block', marginBottom: '8px' }}>
          课程类型
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {courseTypes.map(type => (
              <label key={type} style={{ 
                padding: '6px 12px',
                border: `1px solid ${(filters.course_type || []).includes(type) ? '#0067c0' : '#e0e0e0'}`,
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                backgroundColor: (filters.course_type || []).includes(type) ? '#e3f2fd' : 'white',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}>
                <input
                  type="checkbox"
                  checked={(filters.course_type || []).includes(type)}
                  onChange={(e) => {
                    const current = filters.course_type || [];
                    if (e.target.checked) {
                      updateFilter('course_type', [...current, type]);
                    } else {
                      updateFilter('course_type', current.filter(t => t !== type));
                    }
                  }}
                  style={{ width: '16px', height: '16px' }}
                />
                <span>{type}</span>
              </label>
          ))}
        </div>
      </div>

      {/* 教师筛选 - 使用带搜索的可变数量下拉框 */}
      <div style={{ marginBottom: '15px' }}>
        <label style={{ fontWeight: 'bold', fontSize: '13px', display: 'block', marginBottom: '8px' }}>
          授课教师
        </label>
        <MultiSelectDropdowns
          options={teacherOptions}
          values={filters.teachers || []}
          onChange={(vals) => updateFilter('teachers', vals)}
          placeholder="选择教师"
          searchable={true}
        />
      </div>

      {/* 预览当前筛选条件 */}
      <div style={{ 
        marginTop: '15px', 
        padding: '10px', 
        backgroundColor: '#f8f9fa', 
        borderRadius: '4px',
        fontSize: '12px'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>当前筛选条件：</div>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {JSON.stringify(filters, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ==================== 课程规则筛选构建器（用于合格规则） ====================
function CourseRuleFilterBuilder({ value, onChange, allCourses }) {
  const [filters, setFilters] = useState(value || {});
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  
  // 提取所有唯一的院系、课程类型、教师
  const departments = [...new Set(allCourses.map(c => c.department_code).filter(Boolean))].sort();
  const departmentOptions = departments.map(code => ({
    value: code,
    label: `${DEPARTMENT_CODE_MAP[code] || '未知院系'} (${code})`
  }));
  
  const courseTypes = [...new Set(allCourses.map(c => c.course_type).filter(Boolean))].sort();
  
  // 提取所有教师
  const allTeachers = new Set();
  allCourses.forEach(c => {
    if (c.teachers) {
      c.teachers.forEach(t => allTeachers.add(t));
    }
  });
  const teachers = [...allTeachers].sort();
  const teacherOptions = teachers.map(t => ({ value: t, label: t }));

  const updateFilter = (key, val) => {
    const newFilters = { ...filters };
    if (val === null || val === undefined || (Array.isArray(val) && val.length === 0)) {
      delete newFilters[key];
    } else {
      newFilters[key] = val;
    }
    setFilters(newFilters);
    onChange(newFilters);
  };

  const addCourseId = (courseId) => {
    const currentIds = filters.course_id || [];
    if (!currentIds.includes(courseId)) {
      updateFilter('course_id', [...currentIds, courseId]);
    }
  };

  const removeCourseId = (courseId) => {
    const currentIds = filters.course_id || [];
    updateFilter('course_id', currentIds.filter(id => id !== courseId));
  };

  // 实时搜索
  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }
    const results = allCourses.filter(c => 
      c.course_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.course_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setSearchResults(
      results
      .filter(
        (item, index, self) => index === self.findIndex((t) => t.course_id === item.course_id)
      )
    );
  }, [searchTerm, allCourses]);

  // 计算满足所有筛选条件的课程
  const filteredCourses = allCourses.filter(c => {
    // 检查课程号
    if (filters.course_id?.length > 0 && !filters.course_id.includes(c.course_id)) {
      return false;
    }
    // 检查院系
    if (filters.dept?.length > 0 && !filters.dept.includes(c.department_code)) {
      return false;
    }
    // 检查课程类型
    if (filters.course_type?.length > 0 && !filters.course_type.includes(c.course_type)) {
      return false;
    }
    // 检查教师
    if (filters.teachers?.length > 0) {
      const courseTeachers = c.teachers || [];
      const hasMatchingTeacher = filters.teachers.some(t => courseTeachers.includes(t));
      if (!hasMatchingTeacher) {
        return false;
      }
    }
    return true;
  });

  const hasFilters = (filters.course_id?.length > 0) || 
                    (filters.dept?.length > 0) || 
                    (filters.course_type?.length > 0) || 
                    (filters.teachers?.length > 0);

  return (
    <div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', padding: '15px', backgroundColor: '#f8f9fa' }}>
      <h5 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#666' }}>进一步筛选条件</h5>
      
      {/* 课程号搜索 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '6px' }}>
          指定课程号
        </label>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="输入课程号或名称实时搜索..."
          style={{ width: '100%', padding: '6px', fontSize: '12px', marginBottom: '6px' }}
        />
        
        {/* 实时搜索结果 */}
        {searchResults.length > 0 && (
          <div style={{ 
            maxHeight: '150px', 
            overflowY: 'auto', 
            border: '1px solid #e0e0e0',
            borderRadius: '4px',
            marginBottom: '8px'
          }}>
            <div style={{ padding: '4px 8px', backgroundColor: '#f8f9fa', fontSize: '11px', color: '#666' }}>
              点击添加课程：
            </div>
            {searchResults.map(course => (
              <div 
                key={course.uuid}
                onClick={() => {
                  addCourseId(course.course_id);
                  setSearchTerm('');
                  setSearchResults([]);
                }}
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f0f0f0',
                  fontSize: '12px'
                }}
                onMouseEnter={e => e.target.style.backgroundColor = '#f5f5f5'}
                onMouseLeave={e => e.target.style.backgroundColor = 'transparent'}
              >
                <div style={{ fontWeight: 'bold' }}>{course.course_id}</div>
                <div style={{ color: '#666', fontSize: '11px' }}>{course.course_name}</div>
              </div>
            ))}
          </div>
        )}

        {/* 已选课程号标签 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {(filters.course_id || []).map(id => {
            const course = allCourses.find(c => c.course_id === id);
            return (
              <span 
                key={id}
                style={{
                  padding: '2px 6px',
                  backgroundColor: '#e3f2fd',
                  borderRadius: '4px',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px'
                }}
              >
                {course ? `${id}(${course.course_name})` : id}
                <button 
                  onClick={() => removeCourseId(id)}
                  style={{ 
                    border: 'none', 
                    background: 'none', 
                    cursor: 'pointer',
                    padding: '0 2px',
                    color: '#666',
                    fontSize: '12px'
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      </div>

      {/* 院系筛选 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '6px' }}>
          开课院系
        </label>
        <MultiSelectDropdowns
          options={departmentOptions}
          values={filters.dept || []}
          onChange={(vals) => updateFilter('dept', vals)}
          placeholder="选择院系"
        />
      </div>

      {/* 课程类型筛选 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '6px' }}>
          课程类型
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {courseTypes.map(type => (
            <label key={type} style={{ 
              padding: '4px 10px',
              border: `1px solid ${(filters.course_type || []).includes(type) ? '#0067c0' : '#e0e0e0'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              backgroundColor: (filters.course_type || []).includes(type) ? '#e3f2fd' : 'white',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <input
                type="checkbox"
                checked={(filters.course_type || []).includes(type)}
                onChange={(e) => {
                  const current = filters.course_type || [];
                  if (e.target.checked) {
                    updateFilter('course_type', [...current, type]);
                  } else {
                    updateFilter('course_type', current.filter(t => t !== type));
                  }
                }}
                style={{ width: '14px', height: '14px' }}
              />
              <span>{type}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 教师筛选 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '6px' }}>
          授课教师
        </label>
        <MultiSelectDropdowns
          options={teacherOptions}
          values={filters.teachers || []}
          onChange={(vals) => updateFilter('teachers', vals)}
          placeholder="选择教师"
          searchable={true}
        />
      </div>

      {/* 已筛选课程列表预览 */}
      {hasFilters && (
        <div style={{ 
          marginTop: '12px',
          border: '1px solid #e0e0e0',
          borderRadius: '4px',
          maxHeight: '200px',
          overflowY: 'auto',
          backgroundColor: '#fff'
        }}>
          <div style={{ 
            padding: '8px 10px', 
            backgroundColor: '#f8f9fa', 
            borderBottom: '1px solid #e0e0e0', 
            fontSize: '12px', 
            fontWeight: 'bold',
            color: '#666'
          }}>
            已筛选的课程（{filteredCourses.length}门）：
          </div>
          {filteredCourses.map(course => (
            <div 
              key={course.uuid}
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #f0f0f0',
                fontSize: '12px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>{course.course_id} - {course.course_name}</div>
                  <div style={{ color: '#666', fontSize: '11px', marginTop: '2px' }}>
                    {DEPARTMENT_CODE_MAP[course.department_code] || course.department_code} | {course.course_type} | {course.credits}学分
                  </div>
                </div>
                {filters.course_id?.includes(course.course_id) && (
                  <button 
                    className="btn btn-danger btn-sm"
                    onClick={() => removeCourseId(course.course_id)}
                    style={{ padding: '2px 6px', fontSize: '10px' }}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 预览JSON */}
      <div style={{ 
        marginTop: '12px',
        padding: '8px', 
        backgroundColor: '#fff', 
        borderRadius: '4px',
        fontSize: '11px',
        border: '1px solid #e0e0e0'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '3px', color: '#666' }}>当前筛选JSON：</div>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '10px' }}>
          {JSON.stringify(filters, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ==================== 合格规则构建器 ====================

function RuleBuilder({ value, onChange, type = 'courselist', childNodes = [], allCourses = [] }) {
  const [rules, setRules] = useState(value || []);

  const addRule = () => {
    const newRule = type === 'node' 
      ? { 
          subnodes: [],      // 子节点ID列表
          sublists: [],      // 子列表ID列表
          node_filter: { min_credits: 0, min_courses: 0, require_qualified: false },
          sum_requirements: { min_credits: 0, min_courses: 0, qualified_count: null }
        }
      : { filters: {}, min_credits: null, min_courses: null };
    const newRules = [...rules, newRule];
    setRules(newRules);
    onChange(newRules);
  };

  const updateRule = (index, field, val) => {
    const newRules = rules.map((r, i) => i === index ? { ...r, [field]: val } : r);
    setRules(newRules);
    onChange(newRules);
  };

  const updateNodeFilter = (index, field, val) => {
    const rule = rules[index];
    const newNodeFilter = { ...(rule.node_filter || {}), [field]: val };
    updateRule(index, 'node_filter', newNodeFilter);
  };

  const updateSumRequirements = (index, field, val) => {
    const rule = rules[index];
    const newSumReq = { ...(rule.sum_requirements || {}), [field]: val };
    updateRule(index, 'sum_requirements', newSumReq);
  };

  const removeRule = (index) => {
    const newRules = rules.filter((_, i) => i !== index);
    setRules(newRules);
    onChange(newRules);
  };

  // 切换子节点选择（节点类型）
  const toggleSubnodeSelection = (index, nodeId) => {
    const rule = rules[index];
    const current = rule.subnodes || [];
    const newList = current.includes(nodeId)
      ? current.filter(id => id !== nodeId)
      : [...current, nodeId];
    updateRule(index, 'subnodes', newList.length > 0 ? newList : []);
  };

  // 切换子列表选择（课程列表类型）
  const toggleSublistSelection = (index, listId) => {
    const rule = rules[index];
    const current = rule.sublists || [];
    const newList = current.includes(listId)
      ? current.filter(id => id !== listId)
      : [...current, listId];
    updateRule(index, 'sublists', newList.length > 0 ? newList : []);
  };

  // 向后兼容：处理旧格式的 list_and_nodes
  const getSubnodes = (rule) => {
    // 优先使用新格式
    if (rule.subnodes !== undefined) return rule.subnodes || [];
    // 旧格式兼容：从 list_and_nodes 中筛选出节点ID
    if (rule.list_and_nodes) {
      return rule.list_and_nodes.filter(id => {
        const child = childNodes.find(c => c.id === id);
        return child && child.type === 'node';
      });
    }
    return [];
  };

  const getSublists = (rule) => {
    // 优先使用新格式
    if (rule.sublists !== undefined) return rule.sublists || [];
    // 旧格式兼容：从 list_and_nodes 中筛选出列表ID
    if (rule.list_and_nodes) {
      return rule.list_and_nodes.filter(id => {
        const child = childNodes.find(c => c.id === id);
        return child && child.type === 'courselist';
      });
    }
    return [];
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h4 style={{ margin: 0, fontSize: '14px' }}>合格规则构建器</h4>
      </div>

      <div>
        {rules.map((rule, index) => (
          <div key={index} style={{ 
            border: '1px solid #e0e0e0', 
            borderRadius: '8px', 
            padding: '15px',
            marginBottom: '15px',
            backgroundColor: '#fafafa'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '13px' }}>规则 {index + 1}</span>
              <button className="btn btn-danger btn-sm" onClick={() => removeRule(index)}>删除</button>
            </div>

            {type === 'node' && (
              <>
                {/* 1. 选择子节点 */}
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
                    指定子节点（空=全部）
                  </label>
                  {childNodes.filter(n => n.type === 'node').length === 0 ? (
                    <div style={{ color: '#999', fontSize: '12px', padding: '5px' }}>无子节点</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {childNodes.filter(n => n.type === 'node').map(node => (
                        <label key={node.id} style={{ 
                          padding: '6px 12px',
                          border: `1px solid ${getSubnodes(rule).includes(node.id) ? '#0067c0' : '#e0e0e0'}`,
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          backgroundColor: getSubnodes(rule).includes(node.id) ? '#e3f2fd' : 'white',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px'
                        }}>
                          <input
                            type="checkbox"
                            checked={getSubnodes(rule).includes(node.id)}
                            onChange={() => toggleSubnodeSelection(index, node.id)}
                            style={{ width: '16px', height: '16px' }}
                          />
                          <span>📁 {node.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. 选择子列表 */}
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
                    指定子课程列表（空=全部）
                  </label>
                  {childNodes.filter(n => n.type === 'courselist').length === 0 ? (
                    <div style={{ color: '#999', fontSize: '12px', padding: '5px' }}>无子课程列表</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {childNodes.filter(n => n.type === 'courselist').map(list => (
                        <label key={list.id} style={{ 
                          padding: '6px 12px',
                          border: `1px solid ${getSublists(rule).includes(list.id) ? '#28a745' : '#e0e0e0'}`,
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          backgroundColor: getSublists(rule).includes(list.id) ? '#e8f5e9' : 'white',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px'
                        }}>
                          <input
                            type="checkbox"
                            checked={getSublists(rule).includes(list.id)}
                            onChange={() => toggleSublistSelection(index, list.id)}
                            style={{ width: '16px', height: '16px' }}
                          />
                          <span>📚 {list.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. 节点筛选条件 */}
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>筛选：</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>学分≥</span>
                      <input
                        type="number"
                        value={rule.node_filter?.min_credits || 0}
                        onChange={e => updateNodeFilter(index, 'min_credits', parseFloat(e.target.value) || 0)}
                        style={{ width: '50px', fontSize: '12px', padding: '4px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>门数≥</span>
                      <input
                        type="number"
                        value={rule.node_filter?.min_courses || 0}
                        onChange={e => updateNodeFilter(index, 'min_courses', parseInt(e.target.value) || 0)}
                        style={{ width: '50px', fontSize: '12px', padding: '4px' }}
                      />
                    </div>
                    <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px', margin: 0, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={rule.node_filter?.require_qualified || false}
                        onChange={e => updateNodeFilter(index, 'require_qualified', e.target.checked)}
                      />
                      <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>只统计已合格的</span>
                    </label>
                  </div>
                </div>

                {/* 3. 求和要求 */}
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#e3f2fd', borderRadius: '4px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '10px' }}>
                    求和要求（对筛选后的节点求和）
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px' }}>总学分≥</label>
                      <input
                        type="number"
                        value={rule.sum_requirements?.min_credits ?? ''}
                        onChange={e => updateSumRequirements(index, 'min_credits', e.target.value ? parseFloat(e.target.value) : null)}
                        placeholder="不限"
                        style={{ width: '100%', fontSize: '12px' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px' }}>总门数≥</label>
                      <input
                        type="number"
                        value={rule.sum_requirements?.min_courses ?? ''}
                        onChange={e => updateSumRequirements(index, 'min_courses', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder="不限"
                        style={{ width: '100%', fontSize: '12px' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px' }}>
                        合格数要求≥
                      </label>
                      <input
                        type="number"
                        value={rule.sum_requirements?.qualified_count ?? ''}
                        onChange={e => updateSumRequirements(index, 'qualified_count', e.target.value === '' ? null : parseInt(e.target.value))}
                        placeholder="全部合格"
                        style={{ width: '100%', fontSize: '12px' }}
                      />
                      </div>
                  </div>
                </div>
              </>
            )}

            {type === 'courselist' && (
              <>
                {/* 使用可视化筛选构建器替代JSON编辑器 */}
                <div style={{ marginBottom: '15px' }}>
                  <CourseRuleFilterBuilder
                    value={rule.filters || {}}
                    onChange={v => updateRule(index, 'filters', v)}
                    allCourses={allCourses}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                      最小学分（空=不限）
                    </label>
                    <input
                      type="number"
                      value={rule.min_credits || ''}
                      onChange={e => updateRule(index, 'min_credits', e.target.value ? parseFloat(e.target.value) : null)}
                      placeholder="不限"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                      最小门数（空=不限）
                    </label>
                    <input
                      type="number"
                      value={rule.min_courses || ''}
                      onChange={e => updateRule(index, 'min_courses', e.target.value ? parseInt(e.target.value) : null)}
                      placeholder="不限"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          ))}
          
          <button className="btn btn-primary" onClick={addRule} style={{ width: '100%' }}>
            + 添加规则
          </button>
        </div>
    </div>
  );
}

// ==================== 主组件 ====================

function AdminProgramEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  // 程序基本信息
  const [program, setProgram] = useState(null);
  const [categories, setCategories] = useState([]);
  const [allCourses, setAllCourses] = useState([]);
  const [allNodes, setAllNodes] = useState([]);
  
  // 选中的节点
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedCourseList, setSelectedCourseList] = useState(null);
  
  // 加载状态
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // 编辑模式
  const [editMode, setEditMode] = useState('ui'); // 'ui' | 'json'
  
  // 描述模式（用于显示友好的文字描述）
  const [descriptionMode, setDescriptionMode] = useState(false);
  
  // 模态框
  const [modal, setModal] = useState({ isOpen: false, title: '', content: null, onConfirm: () => {} });
  
  // 展开状态
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  // 表单状态
  const [categoryForm, setCategoryForm] = useState({ name: '', order_index: 0 });
  const [nodeForm, setNodeForm] = useState({ name: '', order_index: 0, qualification_rules: [] });
  const [courseListForm, setCourseListForm] = useState({
    name: '',
    is_dissertation: false,
    filters: {},
    max_courses: null,
    is_repeatable: false,
    qualification_rules: []
  });
  // 子节点名称单独状态，避免与编辑节点名称联动
  const [childNodeName, setChildNodeName] = useState('');
  // 新课程列表名称单独状态，避免与编辑课程列表名称联动
  const [newCourseListName, setNewCourseListName] = useState('');
  // 根节点名称单独状态，避免与编辑节点名称联动
  const [newRootNodeName, setNewRootNodeName] = useState('');

  useEffect(() => {
    fetchData();
    fetchAllCourses();
  }, [id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [programRes, categoriesRes] = await Promise.all([
        axios.get(`/api/admin/programs/${id}`),
        axios.get(`/api/admin/programs/${id}/categories`)
      ]);
      
      setProgram(programRes.data.program);
      
      // 获取每个类别的节点树
      const categoriesList = categoriesRes.data.categories || [];
      const categoriesWithNodes = await Promise.all(
        categoriesList.map(async (cat) => {
          try {
            const nodesRes = await axios.get(`/api/admin/categories/${cat.id}/nodes`);
            return {
              ...cat,
              nodes: nodesRes.data.nodes || []
            };
          } catch (err) {
            console.error(`获取类别 ${cat.id} 的节点失败`, err);
            return { ...cat, nodes: [] };
          }
        })
      );
      
      setCategories(categoriesWithNodes);
      
      // 收集所有节点用于节点选择
      const nodes = [];
      const collectNodes = (nodeList) => {
        nodeList.forEach(node => {
          nodes.push({ id: node.id, name: node.name, type: 'node' });
          if (node.course_lists) {
            node.course_lists.forEach(cl => {
              nodes.push({ id: cl.id, name: cl.name, type: 'courselist', parentId: node.id });
            });
          }
          if (node.children) {
            collectNodes(node.children);
          }
        });
      };
      categoriesWithNodes.forEach(cat => collectNodes(cat.nodes || []));
      setAllNodes(nodes);
      
    } catch (err) {
      console.error('获取数据失败', err);
      showModal('错误', '获取培养方案数据失败', () => setModal(m => ({ ...m, isOpen: false })), false);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllCourses = async () => {
    try {
      // 获取所有课程（不分页）
      const res = await axios.get('/api/courses');
      setAllCourses(res.data.courses || []);
    } catch (err) {
      console.error('获取课程列表失败', err);
    }
  };

  const showModal = (title, content, onConfirm, showCancel = true) => {
    setModal({ isOpen: true, title, content, onConfirm, showCancel });
  };

  // ==================== 类别操作 ====================

  const handleAddCategory = async () => {
    if (!categoryForm.name.trim()) return;
    
    setSaving(true);
    try {
      await axios.post(`/api/admin/programs/${id}/categories`, categoryForm);
      setCategoryForm({ name: '', order_index: 0 });
      fetchData();
    } catch (err) {
      showModal('错误', '添加类别失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCategory = async () => {
    if (!selectedCategory || !categoryForm.name.trim()) return;
    
    setSaving(true);
    try {
      await axios.put(`/api/admin/categories/${selectedCategory.id}`, categoryForm);
      fetchData();
    } catch (err) {
      showModal('错误', '更新类别失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = (categoryId) => {
    showModal('确认删除', '确定要删除这个主类别及其所有内容吗？', async () => {
      try {
        await axios.delete(`/api/admin/categories/${categoryId}`);
        setSelectedCategory(null);
        setSelectedNode(null);
        setSelectedCourseList(null);
        fetchData();
        setModal(m => ({ ...m, isOpen: false }));
      } catch (err) {
        setModal(m => ({ ...m, isOpen: false }));
        showModal('错误', '删除失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
      }
    });
  };

  // ==================== 节点操作 ====================

  const handleAddNode = async (categoryId, parentId = null) => {
    if (!nodeForm.name.trim()) return;
    
    setSaving(true);
    try {
      await axios.post(`/api/admin/categories/${categoryId}/nodes`, {
        ...nodeForm,
        parent_id: parentId
      });
      // 新建节点后重置表单为空，而不是保留上一个
      setNodeForm({ name: '', order_index: 0, qualification_rules: [] });
      if (parentId) {
        setExpandedNodes(prev => new Set([...prev, parentId]));
      }
      setExpandedCategories(prev => new Set([...prev, categoryId]));
      fetchData();
    } catch (err) {
      showModal('错误', '添加节点失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateNode = async () => {
    if (!selectedNode || !nodeForm.name.trim()) return;
    
    setSaving(true);
    try {
      await axios.put(`/api/admin/nodes/${selectedNode.id}`, nodeForm);
      fetchData();
    } catch (err) {
      showModal('错误', '更新节点失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteNode = (nodeId) => {
    showModal('确认删除', '确定要删除这个节点及其所有子内容吗？', async () => {
      try {
        await axios.delete(`/api/admin/nodes/${nodeId}`);
        setSelectedNode(null);
        setSelectedCourseList(null);
        fetchData();
        setModal(m => ({ ...m, isOpen: false }));
      } catch (err) {
        setModal(m => ({ ...m, isOpen: false }));
        showModal('错误', '删除失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
      }
    });
  };

  // ==================== 课程列表操作 ====================

  // 新建课程列表的初始状态
  const getInitialCourseListForm = () => ({
    name: '',
    is_dissertation: false,
    filters: {},
    max_courses: null,
    is_repeatable: false,
    qualification_rules: []
  });

  const handleAddCourseList = async (nodeId, listName) => {
    if (!listName || !listName.trim()) return;
    
    setSaving(true);
    try {
      // 使用传入的名称创建新课程列表
      const newListData = {
        ...getInitialCourseListForm(),
        name: listName.trim()
      };
      await axios.post(`/api/admin/nodes/${nodeId}/course-lists`, newListData);
      // 成功后重置新课程列表名称
      setNewCourseListName('');
      fetchData();
    } catch (err) {
      showModal('错误', '添加课程列表失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCourseList = async () => {
    if (!selectedCourseList || !courseListForm.name.trim()) return;
    
    setSaving(true);
    try {
      await axios.put(`/api/admin/course-lists/${selectedCourseList.id}`, courseListForm);
      // 立即更新本地状态，确保显示最新值
      setSelectedCourseList({
        ...selectedCourseList,
        ...courseListForm
      });
      fetchData();
    } catch (err) {
      showModal('错误', '更新课程列表失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCourseList = (listId) => {
    showModal('确认删除', '确定要删除这个课程列表吗？', async () => {
      try {
        await axios.delete(`/api/admin/course-lists/${listId}`);
        setSelectedCourseList(null);
        fetchData();
        setModal(m => ({ ...m, isOpen: false }));
      } catch (err) {
        setModal(m => ({ ...m, isOpen: false }));
        showModal('错误', '删除失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
      }
    });
  };

  // ==================== 选择处理 ====================

  const selectCategory = (category) => {
    setSelectedCategory(category);
    setSelectedNode(null);
    setSelectedCourseList(null);
    setCategoryForm({
      name: category.name,
      order_index: category.order_index || 0
    });
  };

  const selectNode = async (node, category) => {
    setSelectedNode(node);
    setSelectedCategory(category);
    setSelectedCourseList(null);
    setNodeForm({
      name: node.name,
      order_index: node.order_index || 0,
      qualification_rules: node.qualification_rules || []
    });
    // 重置子节点名称
    setChildNodeName('');
  };

  const selectCourseList = (list, node, category) => {
    setSelectedCourseList(list);
    setSelectedNode(node);
    setSelectedCategory(category);
    // 深拷贝filters和qualification_rules，避免引用共享
    setCourseListForm({
      name: list.name,
      is_dissertation: list.is_dissertation || false,
      filters: list.filters ? JSON.parse(JSON.stringify(list.filters)) : {},
      max_courses: list.max_courses,
      is_repeatable: list.is_repeatable || false,
      qualification_rules: list.qualification_rules ? JSON.parse(JSON.stringify(list.qualification_rules)) : []
    });
  };

  // ==================== 树形渲染 ====================

  const toggleCategory = (categoryId) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const toggleNode = (nodeId) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const renderCourseList = (list, node, category, depth = 0) => (
    <div
      key={list.id}
      onClick={() => selectCourseList(list, node, category)}
      style={{
        padding: '8px 12px',
        marginLeft: depth * 20,
        cursor: 'pointer',
        backgroundColor: selectedCourseList?.id === list.id ? '#e3f2fd' : 'transparent',
        borderLeft: '3px solid #28a745',
        borderRadius: '4px',
        marginBottom: '4px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}
    >
      <span style={{ fontSize: '12px' }}>📚</span>
      <span style={{ flex: 1, fontSize: '14px' }}>{list.name}</span>
      {list.is_dissertation && <span style={{ fontSize: '10px', color: '#dc3545' }}>毕业论文</span>}
    </div>
  );

  const renderNode = (node, category, depth = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const hasCourseLists = node.course_lists && node.course_lists.length > 0;

    return (
      <div key={node.id}>
        <div
          onClick={() => selectNode(node, category)}
          style={{
            padding: '8px 12px',
            marginLeft: depth * 20,
            cursor: 'pointer',
            backgroundColor: selectedNode?.id === node.id ? '#e3f2fd' : 'transparent',
            borderLeft: '3px solid #0067c0',
            borderRadius: '4px',
            marginBottom: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {(hasChildren || hasCourseLists) && (
            <span 
              onClick={(e) => { e.stopPropagation(); toggleNode(node.id); }}
              style={{ 
                fontSize: '12px', 
                cursor: 'pointer',
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s'
              }}
            >
              ▶
            </span>
          )}
          <span style={{ fontSize: '12px' }}>📁</span>
          <span style={{ flex: 1, fontSize: '14px', fontWeight: 'bold' }}>{node.name}</span>
        </div>

        {isExpanded && (
          <div>
            {node.course_lists?.map(list => renderCourseList(list, node, category, depth + 1))}
            {node.children?.map(child => renderNode(child, category, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderCategory = (category) => {
    const isExpanded = expandedCategories.has(category.id);

    return (
      <div key={category.id} style={{ marginBottom: '10px' }}>
        <div
          onClick={() => selectCategory(category)}
          style={{
            padding: '10px 12px',
            cursor: 'pointer',
            backgroundColor: selectedCategory?.id === category.id ? '#e3f2fd' : '#f8f9fa',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            border: '1px solid #dee2e6'
          }}
        >
          <span 
            onClick={(e) => { e.stopPropagation(); toggleCategory(category.id); }}
            style={{ 
              fontSize: '12px', 
              cursor: 'pointer',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s'
            }}
          >
            ▶
          </span>
          <span style={{ fontSize: '14px', fontWeight: 'bold' }}>{category.name}</span>
        </div>

        {isExpanded && category.nodes && (
          <div style={{ marginTop: '8px' }}>
            {category.nodes.map(node => renderNode(node, category, 1))}
          </div>
        )}
      </div>
    );
  };

  // ==================== 配置面板 ====================

  const renderConfigPanel = () => {
    if (selectedCourseList) {
      return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0 }}>{descriptionMode ? '课程列表详情' : '编辑课程列表'}</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                className={`btn btn-sm ${descriptionMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDescriptionMode(!descriptionMode)}
              >
                {descriptionMode ? '编辑模式' : '文字描述'}
              </button>
              {!descriptionMode && (
                <>
                  <button 
                    className={`btn btn-sm ${editMode === 'ui' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setEditMode('ui')}
                  >
                    UI编辑
                  </button>
                  <button 
                    className={`btn btn-sm ${editMode === 'json' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setEditMode('json')}
                  >
                    JSON编辑
                  </button>
                </>
              )}
            </div>
          </div>

          {descriptionMode ? (
            <div>
              <div className="form-group">
                <label>名称</label>
                <div style={{ padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                  {courseListForm.name}
                </div>
              </div>
              <div className="form-group">
                <label>是否为毕业论文</label>
                <div style={{ padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                  {courseListForm.is_dissertation ? '是' : '否'}
                </div>
              </div>
              <div className="form-group">
                <label>可重复计入其他类别</label>
                <div style={{ padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                  {courseListForm.is_repeatable ? '是' : '否'}
                </div>
              </div>
              <div className="form-group">
                <label>最大匹配门数</label>
                <div style={{ padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                  {courseListForm.max_courses || '不限'}
                </div>
              </div>
              <div className="form-group">
                <label>筛选条件</label>
                <div style={{ padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
                  {getFilterDescription(courseListForm.filters, allCourses)}的课程
                </div>
              </div>
              <div className="form-group">
                <label>合格规则</label>
                <div style={{ padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
                  {getCourseListRulesDescription(courseListForm.qualification_rules, allCourses)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button className="btn btn-primary" onClick={() => setDescriptionMode(false)}>
                  进入编辑
                </button>
                <button className="btn btn-danger" onClick={() => handleDeleteCourseList(selectedCourseList.id)}>
                  删除
                </button>
              </div>
            </div>
          ) : (
            <>
          <div className="form-group">
            <label>名称</label>
            <input 
              value={courseListForm.name} 
              onChange={e => setCourseListForm({...courseListForm, name: e.target.value})} 
            />
          </div>
          <div className="form-group">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input 
                type="checkbox"
                checked={courseListForm.is_dissertation} 
                onChange={e => setCourseListForm({...courseListForm, is_dissertation: e.target.checked})} 
                style={{ width: '16px', height: '16px', flexShrink: 0 }}
              />
              <span>是否为毕业论文</span>
            </label>
          </div>
          <div className="form-group">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input 
                type="checkbox"
                checked={courseListForm.is_repeatable} 
                onChange={e => setCourseListForm({...courseListForm, is_repeatable: e.target.checked})} 
                style={{ width: '16px', height: '16px', flexShrink: 0 }}
              />
              <span>可重复计入其他类别</span>
            </label>
          </div>
          <div className="form-group">
            <label>最大匹配门数（空=不限）</label>
            <input 
              type="number"
              value={courseListForm.max_courses || ''} 
              onChange={e => setCourseListForm({...courseListForm, max_courses: e.target.value ? parseInt(e.target.value) : null})} 
              placeholder="不限"
            />
          </div>

          {editMode === 'ui' ? (
            <>
              <div className="form-group">
                <label>筛选条件</label>
                <FilterBuilder 
                  key={`filter-${selectedCourseList?.id || 'new'}-${selectedNode?.id || 'root'}`}
                  value={courseListForm.filters} 
                  onChange={v => setCourseListForm({...courseListForm, filters: v})}
                  allCourses={allCourses}
                />
              </div>
              <div className="form-group">
                <label>合格规则</label>
                <RuleBuilder 
                  key={`rules-${selectedCourseList?.id || 'new'}-${selectedNode?.id || 'root'}`}
                  value={courseListForm.qualification_rules} 
                  onChange={v => setCourseListForm({...courseListForm, qualification_rules: v})}
                  type="courselist"
                  allCourses={allCourses}
                />
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label>筛选条件</label>
                <JsonEditor 
                  value={courseListForm.filters} 
                  onChange={v => setCourseListForm({...courseListForm, filters: v})}
                />
              </div>
              <div className="form-group">
                <label>合格规则</label>
                <ArrayEditor 
                  value={courseListForm.qualification_rules} 
                  onChange={v => setCourseListForm({...courseListForm, qualification_rules: v})}
                />
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button className="btn btn-primary" onClick={handleUpdateCourseList} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button className="btn btn-danger" onClick={() => handleDeleteCourseList(selectedCourseList.id)}>
              删除
            </button>
          </div>
          </>
          )}
        </div>
      );
    }

    if (selectedNode) {
      return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0 }}>{descriptionMode ? '节点详情' : '编辑节点'}</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                className={`btn btn-sm ${descriptionMode ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDescriptionMode(!descriptionMode)}
              >
                {descriptionMode ? '编辑模式' : '文字描述'}
              </button>
              {!descriptionMode && (
                <>
                  <button 
                    className={`btn btn-sm ${editMode === 'ui' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setEditMode('ui')}
                  >
                    UI编辑
                  </button>
                  <button 
                    className={`btn btn-sm ${editMode === 'json' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setEditMode('json')}
                  >
                    JSON编辑
                  </button>
                </>
              )}
            </div>
          </div>

          {descriptionMode ? (
            <div>
              <div className="form-group">
                <label>名称</label>
                <div style={{ padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                  {nodeForm.name}
                </div>
              </div>
              <div className="form-group">
                <label>排序</label>
                <div style={{ padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                  {nodeForm.order_index}
                </div>
              </div>
              <div className="form-group">
                <label>合格规则</label>
                <div style={{ padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
                  {getNodeRulesDescription(nodeForm.qualification_rules, allNodes)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button className="btn btn-primary" onClick={() => setDescriptionMode(false)}>
                  进入编辑
                </button>
                <button className="btn btn-danger" onClick={() => handleDeleteNode(selectedNode.id)}>
                  删除节点
                </button>
              </div>
            </div>
          ) : (
            <>
          <div className="form-group">
            <label>名称</label>
            <input 
              value={nodeForm.name} 
              onChange={e => setNodeForm({...nodeForm, name: e.target.value})} 
            />
          </div>
          <div className="form-group">
            <label>排序</label>
            <input 
              type="number"
              value={nodeForm.order_index} 
              onChange={e => setNodeForm({...nodeForm, order_index: parseInt(e.target.value) || 0})} 
            />
          </div>

          {editMode === 'ui' ? (
            <div className="form-group">
              <label>合格规则</label>
              <RuleBuilder 
                key={`node-rules-${selectedNode?.id || 'new'}`}
                value={nodeForm.qualification_rules} 
                onChange={v => setNodeForm({...nodeForm, qualification_rules: v})}
                type="node"
                childNodes={[
                  ...(selectedNode?.children?.map(n => ({ id: n.id, name: n.name, type: 'node' })) || []),
                  ...(selectedNode?.course_lists?.map(cl => ({ id: cl.id, name: cl.name, type: 'courselist' })) || [])
                ]}
              />
            </div>
          ) : (
            <div className="form-group">
              <label>合格规则</label>
              <ArrayEditor 
                value={nodeForm.qualification_rules} 
                onChange={v => setNodeForm({...nodeForm, qualification_rules: v})}
              />
            </div>
          )}
          
          <hr style={{ margin: '20px 0' }} />
          
          <h4>添加子节点</h4>
          <div className="form-group">
            <label>子节点名称</label>
            <input 
              value={childNodeName} 
              onChange={e => setChildNodeName(e.target.value)} 
              placeholder="输入新子节点名称"
            />
          </div>
          <button 
            className="btn btn-secondary" 
            onClick={async () => {
              if (!childNodeName.trim()) return;
              setSaving(true);
              try {
                await axios.post(`/api/admin/categories/${selectedCategory.id}/nodes`, {
                  name: childNodeName,
                  order_index: 0,
                  qualification_rules: [],
                  parent_id: selectedNode.id
                });
                setChildNodeName('');
                setExpandedNodes(prev => new Set([...prev, selectedNode.id]));
                setExpandedCategories(prev => new Set([...prev, selectedCategory.id]));
                fetchData();
              } catch (err) {
                showModal('错误', '添加节点失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving || !childNodeName.trim()}
          >
            添加子节点
          </button>

          <hr style={{ margin: '20px 0' }} />
          
          <h4>添加课程列表</h4>
          <div className="form-group">
            <label>列表名称</label>
            <input 
              value={newCourseListName} 
              onChange={e => setNewCourseListName(e.target.value)} 
              placeholder="输入新课程列表名称"
            />
          </div>
          <button 
            className="btn btn-secondary" 
            onClick={() => handleAddCourseList(selectedNode.id, newCourseListName)}
            disabled={saving || !newCourseListName.trim()}
          >
            添加课程列表
          </button>

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button className="btn btn-primary" onClick={handleUpdateNode} disabled={saving}>
              {saving ? '保存中...' : '保存节点'}
            </button>
            <button className="btn btn-danger" onClick={() => handleDeleteNode(selectedNode.id)}>
              删除节点
            </button>
          </div>
          </>
          )}
        </div>
      );
    }

    if (selectedCategory) {
      return (
        <div>
          <h3 style={{ marginBottom: '15px' }}>编辑主类别</h3>
          <div className="form-group">
            <label>名称</label>
            <input 
              value={categoryForm.name} 
              onChange={e => setCategoryForm({...categoryForm, name: e.target.value})} 
            />
          </div>
          <div className="form-group">
            <label>排序</label>
            <input 
              type="number"
              value={categoryForm.order_index} 
              onChange={e => setCategoryForm({...categoryForm, order_index: parseInt(e.target.value) || 0})} 
            />
          </div>
          
          <hr style={{ margin: '20px 0' }} />
          
          <h4>添加根节点</h4>
          <div className="form-group">
            <label>节点名称</label>
            <input 
              value={newRootNodeName} 
              onChange={e => setNewRootNodeName(e.target.value)} 
              placeholder="输入新节点名称"
            />
          </div>
          <button 
            className="btn btn-secondary" 
            onClick={async () => {
              if (!newRootNodeName.trim()) return;
              setSaving(true);
              try {
                await axios.post(`/api/admin/categories/${selectedCategory.id}/nodes`, {
                  name: newRootNodeName,
                  order_index: 0,
                  qualification_rules: [],
                  parent_id: null
                });
                setNewRootNodeName('');
                setExpandedCategories(prev => new Set([...prev, selectedCategory.id]));
                fetchData();
              } catch (err) {
                showModal('错误', '添加根节点失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving || !newRootNodeName.trim()}
          >
            添加根节点
          </button>

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button className="btn btn-primary" onClick={handleUpdateCategory} disabled={saving}>
              {saving ? '保存中...' : '保存类别'}
            </button>
            <button className="btn btn-danger" onClick={() => handleDeleteCategory(selectedCategory.id)}>
              删除类别
            </button>
          </div>
        </div>
      );
    }

    return (
      <div style={{ color: '#666', textAlign: 'center', padding: '40px' }}>
        选择左侧的类别、节点或课程列表进行编辑
      </div>
    );
  };

  if (loading) return <div className="card">加载中...</div>;

  return (
    <div>
      <Modal 
        isOpen={modal.isOpen} 
        title={modal.title} 
        onConfirm={modal.onConfirm} 
        onCancel={() => setModal(m => ({ ...m, isOpen: false }))}
        showCancel={modal.showCancel}
      >
        {modal.content}
      </Modal>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0 }}>{program?.name}</h3>
            <div style={{ color: '#666', fontSize: '14px', marginTop: '5px' }}>
              {program?.dept} {program?.year}级 | {program?.channel === 0 ? '主修' : '辅修/双学位（双专业）'}
            </div>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate('/admin/programs')}>
            返回列表
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* 左侧：树形结构 */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h4 style={{ margin: 0 }}>方案结构</h4>
          </div>

          {/* 添加主类别 */}
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
            <h5 style={{ margin: '0 0 10px 0' }}>添加主类别</h5>
            <div className="form-group" style={{ marginBottom: '10px' }}>
              <input 
                value={categoryForm.name} 
                onChange={e => setCategoryForm({...categoryForm, name: e.target.value})} 
                placeholder="类别名称（如：公共基础课）"
                style={{ width: '100%' }}
              />
            </div>
            <button 
              className="btn btn-primary btn-sm" 
              onClick={handleAddCategory}
              disabled={saving || !categoryForm.name.trim()}
            >
              添加
            </button>
          </div>

          {/* 树形列表 */}
          <div>
            {categories.map(renderCategory)}
          </div>
        </div>

        {/* 右侧：配置面板 */}
        <div className="card">
          {renderConfigPanel()}
        </div>
      </div>
    </div>
  );
}

export default AdminProgramEdit;