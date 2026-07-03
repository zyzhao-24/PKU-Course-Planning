import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../utils/axios';
import Modal from '../components/Modal';

function AdminPrograms() {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ 
    name: '', 
    year: new Date().getFullYear(), 
    dept: '', 
    channel: 0  // 0=主修, 1=双学位
  });
  const [loading, setLoading] = useState(true);

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
    fetchPrograms();
  }, []);

  const fetchPrograms = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/admin/programs');
      setPrograms(res.data.programs || []);
    } catch (err) {
      console.error('获取培养方案失败', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/admin/programs', formData);
      setShowForm(false);
      setFormData({ 
        name: '', 
        year: new Date().getFullYear(), 
        dept: '', 
        channel: 0
      });
      fetchPrograms();
    } catch (err) {
      showModal('错误', '创建失败: ' + (err.response?.data?.message || err.message), closeModal, false);
    }
  };

  const handleDelete = (id) => {
    showModal('确认删除', '确定要删除这个培养方案吗？', async () => {
      try {
        await axios.delete(`/api/admin/programs/${id}`);
        fetchPrograms();
        closeModal();
      } catch (err) {
        closeModal();
        showModal('错误', err.response?.data?.message || '删除失败', closeModal, false);
      }
    });
  };

  const handleEdit = (id) => {
    navigate(`/admin/programs/${id}`);
  };

  const getChannelLabel = (channel) => {
    return channel === 0 ? '主修' : '辅修/双学位（双专业）';
  };

  const getChannelColor = (channel) => {
    return channel === 0 ? '#0067c0' : '#17a2b8';
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0 }}>培养方案管理</h3>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>创建方案</button>
        </div>
      </div>

      {showForm && (
        <div className="card">
          <h3>创建培养方案</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>方案名称</label>
              <input 
                placeholder="如：计算机科学与技术 2024级" 
                value={formData.name} 
                onChange={e => setFormData({...formData, name: e.target.value})} 
                required 
              />
            </div>
            <div className="form-group">
              <label>年级</label>
              <input 
                type="number" 
                value={formData.year} 
                onChange={e => setFormData({...formData, year: parseInt(e.target.value)})} 
              />
            </div>
            <div className="form-group">
              <label>院系</label>
              <input 
                placeholder="如：信息科学技术学院" 
                value={formData.dept} 
                onChange={e => setFormData({...formData, dept: e.target.value})} 
              />
            </div>
            <div className="form-group">
              <label>类型</label>
              <select 
                value={formData.channel} 
                onChange={e => setFormData({...formData, channel: parseInt(e.target.value)})}
              >
                <option value={0}>主修</option>
                <option value={1}>辅修/双学位（双专业）</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" className="btn btn-primary">保存</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>取消</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h3>方案列表</h3>
        {loading ? (
          <div>加载中...</div>
        ) : programs.length === 0 ? (
          <div>暂无培养方案</div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>年级</th>
                  <th>院系</th>
                  <th>类型</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {programs.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.year}</td>
                    <td>{p.dept || '-'}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        backgroundColor: getChannelColor(p.channel),
                        color: 'white'
                      }}>
                        {getChannelLabel(p.channel)}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button 
                          className="btn btn-primary btn-sm" 
                          onClick={() => handleEdit(p.id)}
                        >
                          编辑
                        </button>
                        <button 
                          className="btn btn-danger btn-sm" 
                          onClick={() => handleDelete(p.id)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminPrograms;