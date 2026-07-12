import React, { useEffect, useMemo, useState } from 'react';
import axios from '../utils/axios';
import { useAuth } from '../contexts/AuthContext';

const CLOSE_ACTION_OPTIONS = [
  { value: 'ask', label: '每次询问' },
  { value: 'quit', label: '直接退出' },
  { value: 'minimizeToTray', label: '最小化到托盘' },
];

function AdminStudents() {
  const { user, checkAuthStatus } = useAuth();
  const [currentUser, setCurrentUser] = useState(user);
  const [programs, setPrograms] = useState([]);
  const [appSettings, setAppSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [programSaving, setProgramSaving] = useState(false);
  const [appSaving, setAppSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const [meRes, programsRes] = await Promise.all([
        axios.get('/api/auth/me'),
        axios.get('/api/student/program-options')
      ]);

      setCurrentUser(meRes.data.user);
      setPrograms(programsRes.data.programs || []);

      if (window.electronAPI?.getAppSettings) {
        const settings = await window.electronAPI.getAppSettings();
        setAppSettings(settings);
      }
    } catch (err) {
      setStatus('加载设置失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const majorPrograms = useMemo(
    () => programs.filter(p => p.channel === 0),
    [programs]
  );

  const minorPrograms = useMemo(
    () => programs.filter(p => p.channel === 1),
    [programs]
  );

  const getProgramName = (programId) => {
    const program = programs.find(p => p.id === programId);
    return program ? program.name : '未选择';
  };

  const saveProgramSettings = async (nextMajorProgramId, nextMinorProgramId) => {
    setProgramSaving(true);
    setStatus('');
    try {
      const res = await axios.put('/api/student/program-settings', {
        major_program_id: nextMajorProgramId || null,
        minor_program_id: nextMinorProgramId || null
      });
      setCurrentUser(res.data.user);
      await checkAuthStatus();
      setStatus('培养方案设置已自动保存');
    } catch (err) {
      setStatus('培养方案设置保存失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setProgramSaving(false);
    }
  };

  const saveCloseAction = async (closeAction) => {
    if (!window.electronAPI?.setCloseActionPreference) return;

    setAppSaving(true);
    setStatus('');
    try {
      const settings = await window.electronAPI.setCloseActionPreference(closeAction);
      setAppSettings(settings);
    } catch (err) {
      setStatus('应用设置保存失败: ' + err.message);
    } finally {
      setAppSaving(false);
    }
  };

  const selectedCloseAction = appSettings?.window?.closeAction || 'ask';

  if (loading) {
    return <div className="card">加载中...</div>;
  }

  return (
    <div>
      <div className="card">
        <h3 style={{ margin: 0 }}>培养方案设置</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px', marginTop: '20px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>主修方案</label>
            <select
              value={currentUser?.major_program_id || ''}
              onChange={e => saveProgramSettings(e.target.value || null, currentUser?.minor_program_id)}
              disabled={programSaving}
            >
              <option value="">未选择</option>
              {majorPrograms.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div style={{ fontSize: '13px', color: '#666', marginTop: '8px' }}>
              当前: {getProgramName(currentUser?.major_program_id)}
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>辅双方案</label>
            <select
              value={currentUser?.minor_program_id || ''}
              onChange={e => saveProgramSettings(currentUser?.major_program_id, e.target.value || null)}
              disabled={programSaving}
            >
              <option value="">未选择</option>
              {minorPrograms.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <div style={{ fontSize: '13px', color: '#666', marginTop: '8px' }}>
              当前: {getProgramName(currentUser?.minor_program_id)}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ margin: 0 }}>应用设置</h3>
        <div style={{ marginTop: '20px' }}>
          <div style={{ marginBottom: '10px', fontWeight: 500, color: '#4a5568' }}>
            关闭窗口时
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {CLOSE_ACTION_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={`btn ${selectedCloseAction === option.value ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => saveCloseAction(option.value)}
                disabled={appSaving || !window.electronAPI?.setCloseActionPreference}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {status && (
        <div className={`status-bar ${status.includes('失败') ? 'status-error' : 'status-ok'}`}>
          {status}
        </div>
      )}
    </div>
  );
}

export default AdminStudents;
