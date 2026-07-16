import React, { useEffect, useState } from 'react';
import axios from '../utils/axios';
import { useSemester } from '../contexts/SemesterContext';
import Modal from '../components/Modal';

function AdminSemesterConfig() {
  const { semesters, semesterConfigs, refreshSemesters } = useSemester();
  const [selectedSemester, setSelectedSemester] = useState('');
  const [firstWeekMonday, setFirstWeekMonday] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // 创建新学期的状态
  const [academicYear, setAcademicYear] = useState('');
  const [term, setTerm] = useState('1');
  const [newSemesterDate, setNewSemesterDate] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [modal, setModal] = useState({
    isOpen: false,
    title: '',
    content: null,
    onConfirm: () => {},
    showCancel: true
  });

  useEffect(() => {
    if (semesters.length > 0 && !selectedSemester) {
      setSelectedSemester(semesters[0]);
    }
  }, [semesters, selectedSemester]);

  useEffect(() => {
    if (selectedSemester && semesterConfigs[selectedSemester]) {
      const config = semesterConfigs[selectedSemester];
      if (config.first_week_monday) {
        setFirstWeekMonday(config.first_week_monday);
      } else {
        setFirstWeekMonday('');
      }
    }
  }, [selectedSemester, semesterConfigs]);

  const handleSave = async () => {
    if (!selectedSemester) return;
    
    setLoading(true);
    setMessage('');
    
    try {
      await axios.put(`/api/admin/semesters/${selectedSemester}`, {
        first_week_monday: firstWeekMonday || null
      });
      
      setMessage('保存成功！');
      refreshSemesters();
    } catch (err) {
      setMessage('保存失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSemester = async () => {
    if (!academicYear || !term || !newSemesterDate) {
      setMessage('请填写完整信息');
      return;
    }

    // 生成学期名称，如 25-26-1
    const yearParts = academicYear.split('-');
    if (yearParts.length !== 2) {
      setMessage('学年格式错误，应为 25-26');
      return;
    }
    const semesterName = `${academicYear}-${term}`;

    setLoading(true);
    setMessage('');

    try {
      await axios.post('/api/admin/semesters', {
        academic_year: academicYear,
        term: parseInt(term),
        name: semesterName,
        first_week_monday: newSemesterDate
      });

      setMessage('学期创建成功！');
      setAcademicYear('');
      setTerm('1');
      setNewSemesterDate('');
      setShowCreateForm(false);
      refreshSemesters();
      setSelectedSemester(semesterName);
    } catch (err) {
      setMessage('创建失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleAcademicYearChange = (event) => {
    setAcademicYear(event.target.value.replace(/[^\d-]/g, '').slice(0, 5));
  };

  const handleDeleteSemester = async (semesterName) => {
    if (!confirm(`确定要删除学期 ${semesterName} 吗？这将同时删除该学期下的所有课程！`)) {
      return;
    }

    setLoading(true);
    try {
      await axios.delete(`/api/admin/semesters/${semesterName}`);
      setMessage('学期删除成功！');
      refreshSemesters();
      if (selectedSemester === semesterName) {
        setSelectedSemester('');
      }
    } catch (err) {
      setMessage('删除失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const showHelp = () => {
    setModal({
      isOpen: true,
      title: '学期日期配置说明',
      content: (
        <div>
          <p><strong>学年</strong>：如 25-26 表示2025-2026学年</p>
          <p><strong>学期</strong>：1=第一学期（秋季），2=第二学期（春季），3=夏季学期</p>
          <p><strong>第一周周一日期</strong>：该学期第1周的星期一的日期</p>
          <ul style={{ marginTop: '10px', paddingLeft: '20px' }}>
            <li>设置后，课表将显示每周的具体日期</li>
            <li>第0周（如果存在）将自动计算为第1周前推7天</li>
          </ul>
        </div>
      ),
      onConfirm: () => setModal(prev => ({ ...prev, isOpen: false })),
      showCancel: false
    });
  };

  return (
    <div>
      <Modal
        isOpen={modal.isOpen}
        title={modal.title}
        onConfirm={modal.onConfirm}
        onCancel={() => setModal(prev => ({ ...prev, isOpen: false }))}
        showCancel={modal.showCancel}
      >
        {modal.content}
      </Modal>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>学期管理</h3>
          <button className="btn btn-secondary btn-sm" onClick={showHelp}>?</button>
        </div>
      </div>

      {/* 创建新学期 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h4 style={{ margin: 0 }}>创建新学期</h4>
          <button 
            className="btn btn-primary btn-sm" 
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? '取消' : '+ 创建新学期'}
          </button>
        </div>

        {showCreateForm && (
          <div style={{ 
            padding: '15px', 
            backgroundColor: '#f5f5f5', 
            borderRadius: '8px',
            marginBottom: '15px'
          }}>
            <div className="form-group">
              <label>学年 *</label>
              <input
                type="text"
                value={academicYear}
                onChange={handleAcademicYearChange}
                inputMode="numeric"
                maxLength={5}
                placeholder="如: 25-26"
                style={{ width: '100%', padding: '8px' }}
              />
              <small style={{ color: '#666' }}>格式: XX-XX，如 25-26</small>
            </div>

            <div className="form-group" style={{ marginTop: '15px' }}>
              <label>学期 *</label>
              <select
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                style={{ width: '100%', padding: '8px' }}
              >
                <option value="1">第一学期（秋季）</option>
                <option value="2">第二学期（春季）</option>
                <option value="3">夏季学期</option>
              </select>
            </div>

            <div className="form-group" style={{ marginTop: '15px' }}>
              <label>第1周周一日期 *</label>
              <input
                type="date"
                value={newSemesterDate}
                onChange={(e) => setNewSemesterDate(e.target.value)}
                style={{ width: '100%', padding: '8px' }}
              />
            </div>

            <div style={{ marginTop: '15px' }}>
              <button 
                className="btn btn-primary" 
                onClick={handleCreateSemester}
                disabled={loading}
              >
                {loading ? '创建中...' : '创建学期'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 配置现有学期 */}
      <div className="card">
        <h4>配置现有学期</h4>
        
        <div className="form-group" style={{ marginTop: '15px' }}>
          <label>选择学期</label>
          <select 
            value={selectedSemester} 
            onChange={(e) => setSelectedSemester(e.target.value)}
            style={{ width: '100%', padding: '8px', fontSize: '14px' }}
          >
            <option value="">请选择学期</option>
            {semesters.map(sem => (
              <option key={sem} value={sem}>{sem}</option>
            ))}
          </select>
        </div>

        {selectedSemester && (
          <>
            <div className="form-group" style={{ marginTop: '20px' }}>
              <label>第1周周一日期</label>
              <input
                type="date"
                value={firstWeekMonday}
                onChange={(e) => setFirstWeekMonday(e.target.value)}
                style={{ width: '100%', padding: '8px', fontSize: '14px' }}
              />
              <small style={{ color: '#666', display: 'block', marginTop: '5px' }}>
                设置后课表将显示具体日期。第0周（如有）自动计算。
              </small>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
              <button 
                className="btn btn-primary" 
                onClick={handleSave}
                disabled={loading}
              >
                {loading ? '保存中...' : '保存配置'}
              </button>
              <button 
                className="btn btn-danger" 
                onClick={() => handleDeleteSemester(selectedSemester)}
                disabled={loading}
              >
                删除学期
              </button>
            </div>
          </>
        )}

        {message && (
          <div style={{ 
            marginTop: '15px', 
            padding: '10px', 
            backgroundColor: message.includes('成功') ? '#e8f5e9' : '#ffebee',
            borderRadius: '4px',
            color: message.includes('成功') ? '#2e7d32' : '#c62828'
          }}>
            {message}
          </div>
        )}
      </div>

      <div className="card">
        <h4>学期列表</h4>
        <table style={{ width: '100%', marginTop: '15px' }}>
          <thead>
            <tr>
              <th>学期名称</th>
              <th>学年</th>
              <th>学期</th>
              <th>第1周周一</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {semesters.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', color: '#999' }}>
                  暂无学期，请先创建
                </td>
              </tr>
            ) : (
              semesters.map(sem => {
                const config = semesterConfigs[sem];
                const hasDate = config?.first_week_monday;
                return (
                  <tr 
                    key={sem} 
                    style={{ 
                      backgroundColor: sem === selectedSemester ? '#e3f2fd' : 'transparent',
                      cursor: 'pointer'
                    }}
                    onClick={() => setSelectedSemester(sem)}
                  >
                    <td>{sem}</td>
                    <td>{config?.academic_year || '-'}</td>
                    <td>{config?.term ? `第${config.term}学期` : '-'}</td>
                    <td>{hasDate ? config.first_week_monday : '-'}</td>
                    <td>
                      {hasDate ? (
                        <span style={{ color: '#2e7d32' }}>✓ 已配置</span>
                      ) : (
                        <span style={{ color: '#999' }}>未配置</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AdminSemesterConfig;
