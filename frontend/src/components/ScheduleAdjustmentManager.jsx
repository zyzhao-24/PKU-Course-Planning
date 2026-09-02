import React, { useEffect, useMemo, useState } from 'react';
import axios from '../utils/axios';
import { WEEK_DAYS } from '../utils';
import { getSemesterMaxWeeks } from '../utils/scheduleConflicts';
import { useSemester } from '../contexts/SemesterContext';


const emptyEntry = () => ({
  actual: { week: 1, day: 1 },
  mode: 'off',
  use_schedule_of: { week: 1, day: 2 },
});

const emptyForm = () => ({ name: '', reason: '', entries: [emptyEntry()] });

const slotLabel = (slot) => `第${slot.week}周 ${WEEK_DAYS[slot.day]}`;

function dateForSlot(firstWeekMonday, slot) {
  if (!firstWeekMonday || !slot) return '';
  const monday = new Date(`${firstWeekMonday}T00:00:00`);
  if (Number.isNaN(monday.getTime())) return '';
  monday.setDate(monday.getDate() + (Number(slot.week) - 1) * 7 + Number(slot.day) - 1);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

function ScheduleAdjustmentManager({ showModal, closeModal }) {
  const {
    selectedSemester,
    semesterConfigs,
    refreshSemesters,
  } = useSemester();
  const config = semesterConfigs[selectedSemester] || {};
  const adjustments = config.schedule_adjustments || [];
  const maxWeeks = getSemesterMaxWeeks(selectedSemester);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    setEditingId(null);
    setForm(emptyForm());
    setOpen(false);
    setStatus('');
    setStatusError(false);
  }, [selectedSemester]);

  const occupiedActuals = useMemo(() => {
    const values = new Map();
    adjustments.forEach(adjustment => {
      if (adjustment.id === editingId) return;
      (adjustment.entries || []).forEach(entry => {
        values.set(`${entry.actual.week}:${entry.actual.day}`, adjustment.name);
      });
    });
    return values;
  }, [adjustments, editingId]);

  if (!selectedSemester) return null;

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setStatus('');
    setStatusError(false);
    setOpen(true);
  };

  const startEdit = (adjustment) => {
    setEditingId(adjustment.id);
    setForm({
      name: adjustment.name,
      reason: adjustment.reason || '',
      entries: (adjustment.entries || []).map(entry => ({
        actual: { ...entry.actual },
        mode: entry.mode,
        use_schedule_of: entry.use_schedule_of
          ? { ...entry.use_schedule_of }
          : { week: entry.actual.week, day: entry.actual.day === 7 ? 1 : entry.actual.day + 1 },
      })),
    });
    setStatus('');
    setStatusError(false);
    setOpen(true);
  };

  const cancelEdit = () => {
    setOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const updateEntry = (index, updater) => {
    setForm(current => ({
      ...current,
      entries: current.entries.map((entry, entryIndex) => (
        entryIndex === index ? updater(entry) : entry
      )),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setStatus('');
    setStatusError(false);
    try {
      const payload = {
        semester: selectedSemester,
        name: form.name,
        reason: form.reason,
        entries: form.entries.map(entry => ({
          actual: entry.actual,
          mode: entry.mode,
          ...(entry.mode === 'mapped' ? { use_schedule_of: entry.use_schedule_of } : {}),
        })),
      };
      if (editingId) {
        await axios.put(`/api/admin/semester-adjustments/${editingId}`, payload);
      } else {
        await axios.post('/api/admin/semester-adjustments', payload);
      }
      await refreshSemesters();
      setStatus(editingId ? '调整方案已保存' : '调整方案已创建');
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm());
    } catch (error) {
      setStatus(error.response?.data?.message || error.message);
      setStatusError(true);
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (adjustment) => {
    showModal(
      '删除调整方案',
      `确定删除“${adjustment.name}”及其 ${adjustment.entries?.length || 0} 条日期设定吗？`,
      async () => {
        try {
          await axios.delete(`/api/admin/semester-adjustments/${adjustment.id}`);
          closeModal();
          await refreshSemesters();
          if (editingId === adjustment.id) cancelEdit();
          setStatus('调整方案已删除');
          setStatusError(false);
        } catch (error) {
          closeModal();
          setStatus(error.response?.data?.message || error.message);
          setStatusError(true);
        }
      },
      true,
      'btn btn-danger',
    );
  };

  return (
    <section className="schedule-adjustment-manager" aria-labelledby="schedule-adjustment-title">
      <div className="schedule-adjustment-manager__heading">
        <div>
          <h4 id="schedule-adjustment-title">教学日历调整</h4>
        </div>
        {!open && <button type="button" className="btn btn-secondary btn-sm" onClick={startCreate}>添加调整方案</button>}
      </div>

      {open && (
        <form className="schedule-adjustment-form" onSubmit={submit}>
          <div className="schedule-adjustment-form__fields">
            <div className="form-group">
              <label>方案名称</label>
              <input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：国庆节教学安排" required />
            </div>
            <div className="form-group">
              <label>原因</label>
              <input value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} placeholder="可选" />
            </div>
          </div>

          <div className="schedule-adjustment-form__entries">
            {form.entries.map((entry, index) => {
              const occupiedBy = occupiedActuals.get(`${entry.actual.week}:${entry.actual.day}`);
              return (
                <div className="schedule-adjustment-entry" key={index}>
                  <div className="schedule-adjustment-entry__index">设定 {index + 1}</div>
                  <div className="form-group">
                    <label>实际周次</label>
                    <select value={entry.actual.week} onChange={event => updateEntry(index, current => ({
                      ...current,
                      actual: { ...current.actual, week: Number(event.target.value) },
                    }))}>
                      {Array.from({ length: maxWeeks + 1 }, (_, week) => <option value={week} key={week}>第 {week} 周</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>实际星期</label>
                    <select value={entry.actual.day} onChange={event => updateEntry(index, current => ({
                      ...current,
                      actual: { ...current.actual, day: Number(event.target.value) },
                    }))}>
                      {Object.entries(WEEK_DAYS).map(([day, label]) => <option value={day} key={day}>{label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>调整方式</label>
                    <select value={entry.mode} onChange={event => updateEntry(index, current => ({ ...current, mode: event.target.value }))}>
                      <option value="off">放假</option>
                      <option value="mapped">调课/调休</option>
                    </select>
                  </div>
                  {entry.mode === 'mapped' && (
                    <>
                      <div className="form-group">
                        <label>课表周次</label>
                        <select value={entry.use_schedule_of.week} onChange={event => updateEntry(index, current => ({
                          ...current,
                          use_schedule_of: { ...current.use_schedule_of, week: Number(event.target.value) },
                        }))}>
                          {Array.from({ length: maxWeeks + 1 }, (_, week) => <option value={week} key={week}>第 {week} 周</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>课表星期</label>
                        <select value={entry.use_schedule_of.day} onChange={event => updateEntry(index, current => ({
                          ...current,
                          use_schedule_of: { ...current.use_schedule_of, day: Number(event.target.value) },
                        }))}>
                          {Object.entries(WEEK_DAYS).map(([day, label]) => <option value={day} key={day}>{label}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                  <div className="schedule-adjustment-entry__meta">
                    <span>{dateForSlot(config.first_week_monday, entry.actual)}</span>
                    {occupiedBy && <span className="schedule-adjustment-entry__error">已由“{occupiedBy}”设置</span>}
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => setForm(current => ({
                      ...current,
                      entries: current.entries.filter((_, entryIndex) => entryIndex !== index),
                    }))}
                    disabled={form.entries.length === 1}
                  >
                    删除此项
                  </button>
                </div>
              );
            })}
          </div>

          <div className="schedule-adjustment-form__actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(current => ({ ...current, entries: [...current.entries, emptyEntry()] }))}>添加日期设定</button>
            <span className="schedule-adjustment-form__spacer" />
            <button type="button" className="btn btn-secondary" onClick={cancelEdit} disabled={saving}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '保存中...' : '保存调整方案'}</button>
          </div>
        </form>
      )}

      {!open && adjustments.length === 0 && (
        <div className="schedule-adjustment-manager__empty">当前学期没有教学日历调整。</div>
      )}

      {!open && adjustments.length > 0 && (
        <div className="schedule-adjustment-list">
          {adjustments.map(adjustment => (
            <div className="schedule-adjustment-list__item" key={adjustment.id}>
              <div className="schedule-adjustment-list__content">
                <div className="schedule-adjustment-list__title">
                  <strong>{adjustment.name}</strong>
                  {adjustment.reason && <span>{adjustment.reason}</span>}
                </div>
                <div className="schedule-adjustment-list__entries">
                  {(adjustment.entries || []).map(entry => (
                    <div key={entry.id || `${entry.actual.week}:${entry.actual.day}`}>
                      <span>{slotLabel(entry.actual)}（{dateForSlot(config.first_week_monday, entry.actual)}）</span>
                      <span> → {entry.mode === 'off' ? '放假' : `采用${slotLabel(entry.use_schedule_of)}课表`}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="schedule-adjustment-list__actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(adjustment)}>编辑</button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => requestDelete(adjustment)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {status && <div className={`status-bar ${statusError ? 'status-error' : 'status-ok'}`}>{status}</div>}
    </section>
  );
}

export default ScheduleAdjustmentManager;
