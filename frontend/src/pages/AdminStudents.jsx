import React, { useEffect, useState } from 'react';
import axios from '../utils/axios';
import Modal from '../components/Modal';

function AdminStudents() {
  const [students, setStudents] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modal, setModal] = useState({
    isOpen: false,
    title: '',
    content: null,
    onConfirm: () => {},
    showCancel: true
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [studentsRes, programsRes] = await Promise.all([
        axios.get('/api/admin/students'),
        axios.get('/api/admin/programs')
      ]);
      setStudents(studentsRes.data.students || []);
      setPrograms(programsRes.data.programs || []);
    } catch (err) {
      console.error('获取数据失败', err);
      showModal('错误', '获取数据失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
    } finally {
      setLoading(false);
    }
  };

  const showModal = (title, content, onConfirm, showCancel = true) => {
    setModal({ isOpen: true, title, content, onConfirm, showCancel });
  };

  const assignPrograms = async (userId, majorProgramId, minorProgramId) => {
    setSaving(true);
    try {
      await axios.post(`/api/admin/users/${userId}/assign-programs`, {
        major_program_id: majorProgramId || null,
        minor_program_id: minorProgramId || null
      });
      fetchData();
    } catch (err) {
      showModal('错误', '分配失败: ' + (err.response?.data?.message || err.message), () => setModal(m => ({ ...m, isOpen: false })), false);
    } finally {
      setSaving(false);
    }
  };

  // 按channel分组程序
  const majorPrograms = programs.filter(p => p.channel === 0);
  const minorPrograms = programs.filter(p => p.channel === 1);

  const getProgramName = (programId) => {
    const program = programs.find(p => p.id === programId);
    return program ? program.name : '-';
  };

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
        <h3 style={{ margin: 0 }}>学生管理</h3>
        <p style={{ margin: '10px 0 0 0', color: '#666', fontSize: '14px' }}>
          为学生分配主修和辅修/双学位（双专业）培养方案
        </p>
      </div>

      <div className="card">
        {loading ? (
          <div>加载中...</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>学号</th>
                  <th>姓名</th>
                  <th>主修方案</th>
                  <th>辅双方案</th>
                  <th>最后登录</th>
                </tr>
              </thead>
              <tbody>
                {students.map(s => (
                  <tr key={s.id}>
                    <td>{s.username}</td>
                    <td>{s.name || '-'}</td>
                    <td>
                      <select 
                        value={s.major_program_id || ''} 
                        onChange={e => assignPrograms(s.id, e.target.value || null, s.minor_program_id)}
                        disabled={saving}
                        style={{ minWidth: '180px' }}
                      >
                        <option value="">未分配</option>
                        {majorPrograms.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {s.major_program_name && (
                        <div style={{ fontSize: '11px', color: '#666', marginTop: '3px' }}>
                          {s.major_program_name}
                        </div>
                      )}
                    </td>
                    <td>
                      <select 
                        value={s.minor_program_id || ''} 
                        onChange={e => assignPrograms(s.id, s.major_program_id, e.target.value || null)}
                        disabled={saving}
                        style={{ minWidth: '180px' }}
                      >
                        <option value="">未分配</option>
                        {minorPrograms.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {s.minor_program_name && (
                        <div style={{ fontSize: '11px', color: '#666', marginTop: '3px' }}>
                          {s.minor_program_name}
                        </div>
                      )}
                    </td>
                    <td>{s.last_login ? new Date(s.last_login).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 统计信息 */}
      <div className="card" style={{ marginTop: '20px' }}>
        <h4 style={{ margin: '0 0 15px 0' }}>统计信息</h4>
        <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0067c0' }}>
              {students.filter(s => s.major_program_id).length}
            </div>
            <div style={{ fontSize: '13px', color: '#666' }}>已分配主修方案</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#17a2b8' }}>
              {students.filter(s => s.minor_program_id).length}
            </div>
            <div style={{ fontSize: '13px', color: '#666' }}>已分配辅双方案</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>
              {students.filter(s => s.major_program_id && s.minor_program_id).length}
            </div>
            <div style={{ fontSize: '13px', color: '#666' }}>双方案齐全</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc3545' }}>
              {students.filter(s => !s.major_program_id && !s.minor_program_id).length}
            </div>
            <div style={{ fontSize: '13px', color: '#666' }}>未分配任何方案</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminStudents;