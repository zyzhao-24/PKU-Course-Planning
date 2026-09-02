import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from '../utils/axios';
import Modal from '../components/Modal';
import ProgramPreviewTree from '../components/ProgramPreviewTree';
import excelIcon from '../assets/xls.png';

function AdminPrograms() {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [showImportWarning, setShowImportWarning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importChannel, setImportChannel] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [previewModal, setPreviewModal] = useState({
    isOpen: false,
    loading: false,
    program: null,
    error: ''
  });
  const fileInputRef = useRef();
  const importWarningTimerRef = useRef(null);
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

    return () => {
      if (importWarningTimerRef.current) {
        clearTimeout(importWarningTimerRef.current);
      }
    };
  }, []);

  const fetchPrograms = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await axios.get('/api/admin/programs');
      setPrograms(res.data.programs || []);
    } catch (err) {
      console.error('获取培养方案失败', err);
      setLoadError(err.response?.data?.message || err.message || '获取培养方案失败');
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

  const handlePreview = async (id) => {
    setPreviewModal({ isOpen: true, loading: true, program: null, error: '' });
    try {
      const res = await axios.get(`/api/admin/programs/${id}/full`);
      setPreviewModal({ isOpen: true, loading: false, program: res.data.program, error: '' });
    } catch (err) {
      setPreviewModal({
        isOpen: true,
        loading: false,
        program: null,
        error: err.response?.data?.message || err.message || '加载预览失败'
      });
    }
  };

  const showImportTypeWarning = () => {
    setShowImportWarning(true);

    if (importWarningTimerRef.current) {
      clearTimeout(importWarningTimerRef.current);
    }

    importWarningTimerRef.current = setTimeout(() => {
      setShowImportWarning(false);
    }, 3000);
  };

  const handleImportAreaClick = () => {
    if (importChannel === null) {
      showImportTypeWarning();
      return;
    }

    fileInputRef.current?.click();
  };

  const handleImportChannelClick = (channel) => {
    setImportChannel(current => current === channel ? null : channel);

    if (importWarningTimerRef.current) {
      clearTimeout(importWarningTimerRef.current);
    }
    setShowImportWarning(false);
  };

  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;

    if (importChannel === null) {
      showImportTypeWarning();
      if (fileInputRef.current) {
        fileInputRef.current.value = null;
      }
      return;
    }

    const fileList = Array.from(files);
    setImportStatus(`正在导入 ${fileList.length} 个文件...`);

    let successCount = 0;
    const errorMessages = [];

    for (const file of fileList) {
      const body = new FormData();
      body.append('file', file);
      body.append('channel', importChannel);

      try {
        const res = await axios.post('/api/admin/programs/import', body, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        successCount++;

        const program = res.data.program;
        const stats = res.data.stats;
        const detail = stats
          ? `${program.name}（${stats.categories} 类，${stats.modules} 模块，${stats.groups} 课程组，${stats.options} 门课程）`
          : program.name;
        setImportStatus(`正在导入 ${fileList.length} 个文件...\n已完成：${detail}`);
      } catch (err) {
        errorMessages.push(`${file.name}: ${err.response?.data?.message || err.message}`);
      }
    }

    if (errorMessages.length > 0) {
      setImportStatus(`导入完成: ${successCount}/${fileList.length} 成功\n错误:\n${errorMessages.join('\n')}`);
    } else {
      setImportStatus(`成功导入 ${successCount} 个文件`);
    }

    fetchPrograms();

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
      if (importChannel === null) {
        showImportTypeWarning();
        return;
      }

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

      <Modal
        isOpen={previewModal.isOpen}
        title={previewModal.program ? `预览：${previewModal.program.name}` : '培养方案预览'}
        onCancel={() => setPreviewModal(prev => ({ ...prev, isOpen: false }))}
        hideFooter
        maxWidth="1180px"
      >
        <div style={{ minHeight: '260px' }}>
          {previewModal.loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>加载中...</div>
          ) : previewModal.error ? (
            <div style={{ padding: '20px', color: '#dc3545' }}>{previewModal.error}</div>
          ) : (
            <ProgramPreviewTree program={previewModal.program} />
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
            <button className="btn btn-secondary" onClick={() => setPreviewModal(prev => ({ ...prev, isOpen: false }))}>
              关闭
            </button>
          </div>
        </div>
      </Modal>

      <div className="card management-import-card">
        <div className="management-import-card__header">
          <h2>培养方案管理</h2>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>创建方案</button>
        </div>
        <section className="management-import-card__section" aria-labelledby="program-data-import-title">
          <h3 id="program-data-import-title" className="management-import-card__section-title">数据导入</h3>
          <div
          aria-live="polite"
          style={{
            maxHeight: showImportWarning ? '44px' : 0,
            opacity: showImportWarning ? 1 : 0,
            overflow: 'hidden',
            transform: showImportWarning ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'max-height 0.25s ease, opacity 0.2s ease, transform 0.25s ease',
            pointerEvents: 'none'
          }}
        >
          <div
            style={{
              backgroundColor: '#fff7ed',
              border: '1px solid #fdba74',
              color: '#9a3412',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              padding: '9px 12px',
              marginBottom: '12px',
              textAlign: 'center'
            }}
          >
            必须选择培养方案类型后才能上传文件
          </div>
        </div>
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
          onClick={handleImportAreaClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onMouseOver={(e) => { if (!isDragging) { e.currentTarget.style.borderColor = '#0067c0'; e.currentTarget.style.backgroundColor = '#f0f7ff'; }}}
          onMouseOut={(e) => { if (!isDragging) { e.currentTarget.style.borderColor = '#e0e0e0'; e.currentTarget.style.backgroundColor = '#fafafa'; }}}
        >
          <div
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginBottom: '15px', flexWrap: 'wrap' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ fontSize: '13px', color: '#555' }}>导入类型</span>
            <div role="group" aria-label="导入类型" style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {[
                { value: 0, label: '主修' },
                { value: 1, label: '辅修/双学位（双专业）' }
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={`btn ${importChannel === option.value ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  aria-pressed={importChannel === option.value}
                  onClick={() => handleImportChannelClick(option.value)}
                  style={{ minWidth: option.value === 0 ? '72px' : '180px' }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            accept=".xls"
            multiple
            onChange={(e) => handleFileUpload(e.target.files)}
            style={{ display: 'none' }}
          />
          <div style={{ marginBottom: '10px' }}>
            <img
              src={excelIcon}
              alt="Excel"
              style={{ width: '56px', height: '56px' }}
            />
          </div>
          <div style={{ fontWeight: '600', color: '#333', marginBottom: '5px' }}>
            {isDragging ? '释放以上传文件' : '点击或拖拽上传培养方案文件'}
          </div>
          <div style={{ fontSize: '13px', color: '#888' }}>支持 .xls 格式，可多选文件</div>
        </div>
          {importStatus && (
          <p style={{ marginTop: '10px', color: '#666', fontSize: '14px', whiteSpace: 'pre-line' }}>
            {importStatus}
          </p>
        )}
        </section>
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
        {loadError && (
          <div style={{
            color: '#b91c1c',
            backgroundColor: '#fee2e2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            padding: '10px 12px',
            marginBottom: '12px',
            fontSize: '14px'
          }}>
            获取培养方案失败：{loadError}
          </div>
        )}
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
                  <th>来源文件</th>
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
                    <td>{p.source_filename || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handlePreview(p.id)}
                        >
                          预览
                        </button>
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
