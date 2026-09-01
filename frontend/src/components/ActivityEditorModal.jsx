import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import {
  ACTIVITY_COLOR_SETS,
  createEmptyActivity,
  createEmptyActivityTime,
  dateToSemesterWeek,
} from '../utils/activityPresentation';
import { WEEK_DAYS } from '../utils';

const clone = (value) => JSON.parse(JSON.stringify(value));

const modeButtonStyle = (active) => ({
  padding: '7px 11px',
  border: '1px solid #cbd5e1',
  background: active ? '#0067c0' : '#fff',
  color: active ? '#fff' : '#475569',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '12px',
});

function ActivityEditorModal({
  isOpen,
  activity,
  semester,
  maxWeeks,
  firstWeekMonday,
  onCancel,
  onSave,
  onDelete,
}) {
  const [form, setForm] = useState(createEmptyActivity(semester));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (activity) {
      const next = clone(activity);
      next.time_entries = next.time_entries.map(entry => ({
        ...entry,
        input_mode: 'weeks',
        date_input: '',
        date_error: '',
      }));
      setForm(next);
    } else {
      const empty = createEmptyActivity(semester);
      empty.time_entries[0].recurrence.week_range = `1-${maxWeeks}`;
      setForm(empty);
    }
    setSaving(false);
    setError('');
  }, [isOpen, activity, semester, maxWeeks]);

  const updateTimeEntry = (index, updater) => {
    setForm(current => ({
      ...current,
      time_entries: current.time_entries.map((entry, entryIndex) => (
        entryIndex === index ? updater(clone(entry)) : entry
      )),
    }));
  };

  const addTimeEntry = () => {
    const next = createEmptyActivityTime();
    next.recurrence.week_range = `1-${maxWeeks}`;
    setForm(current => ({ ...current, time_entries: [...current.time_entries, next] }));
  };

  const removeTimeEntry = (index) => {
    setForm(current => ({
      ...current,
      time_entries: current.time_entries.filter((_, entryIndex) => entryIndex !== index),
    }));
  };

  const payload = () => ({
    semester,
    title: form.title.trim(),
    color: form.color,
    notes: form.notes.trim(),
    time_entries: form.time_entries.map(entry => ({
      recurrence: {
        type: 'weeks',
        day: Number(entry.recurrence.day),
        week_range: entry.recurrence.week_range,
        week_type: Number(entry.recurrence.week_type),
      },
      time: entry.time.type === 'clock'
        ? { type: 'clock', start: entry.time.start, end: entry.time.end }
        : {
          type: 'periods',
          start_period: Number(entry.time.start_period),
          end_period: Number(entry.time.end_period),
      },
      location: entry.location.trim(),
      blocking: entry.blocking !== false,
    })),
  });

  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setError('请输入活动名称');
      return;
    }
    if (!form.time_entries.length) {
      setError('至少需要一个活动时间');
      return;
    }
    const invalidDateEntry = form.time_entries.find(entry => (
      entry.input_mode === 'date' && (!entry.date_input || entry.date_error)
    ));
    if (invalidDateEntry) {
      setError(invalidDateEntry.date_error || '请选择用于换算的日期');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(payload());
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title={activity ? '编辑活动' : '添加活动'}
      onCancel={onCancel}
      hideFooter
      maxWidth="760px"
    >
      <form onSubmit={submit}>
        {error && <div className="status-bar status-error" style={{ marginBottom: '14px' }}>{error}</div>}

        <div className="form-group">
          <label>活动名称</label>
          <input
            value={form.title}
            onChange={event => setForm(current => ({ ...current, title: event.target.value }))}
            maxLength={100}
            autoFocus
          />
        </div>

        <div className="form-group">
          <label>颜色</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {Object.entries(ACTIVITY_COLOR_SETS).map(([color, set]) => (
              <button
                key={color}
                type="button"
                title={color}
                aria-label={`选择${color}色`}
                onClick={() => setForm(current => ({ ...current, color }))}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  border: form.color === color ? '3px solid #1f2937' : `1px solid ${set.border}`,
                  background: set.bg,
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                }}
              />
            ))}
          </div>
        </div>

        {form.time_entries.map((entry, index) => (
          <div key={index} style={{ padding: '14px 0', borderTop: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
              <strong style={{ color: '#475569', fontSize: '13px' }}>时间 {index + 1}</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#475569', fontSize: '12px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={entry.blocking !== false}
                    onChange={event => updateTimeEntry(index, next => {
                      next.blocking = event.target.checked;
                      return next;
                    })}
                    style={{ width: 'auto', minWidth: 0, margin: 0, padding: 0, flex: '0 0 auto' }}
                  />
                  参与时间冲突检查
                </label>
                {form.time_entries.length > 1 && (
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => removeTimeEntry(index)}>
                    删除时间
                  </button>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>周次输入方式</label>
              <div style={{ display: 'inline-flex' }}>
                {[
                  ['weeks', '按周次填写'],
                  ['date', '按日期换算'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    style={modeButtonStyle(entry.input_mode === value)}
                    onClick={() => updateTimeEntry(index, next => {
                      next.input_mode = value;
                      next.date_error = '';
                      return next;
                    })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {entry.input_mode === 'date' && (
              <div className="form-group">
                <label>日期</label>
                <input
                  type="date"
                  value={entry.date_input || ''}
                  onChange={event => updateTimeEntry(index, next => {
                    next.date_input = event.target.value;
                    const converted = dateToSemesterWeek(event.target.value, firstWeekMonday, maxWeeks);
                    if (converted.valid) {
                      next.recurrence.week_range = String(converted.week);
                      next.recurrence.day = converted.day;
                      next.recurrence.week_type = 0;
                      next.date_error = '';
                    } else {
                      next.date_error = converted.message;
                    }
                    return next;
                  })}
                  required
                />
                {entry.date_error ? (
                  <div style={{ marginTop: '5px', color: '#b91c1c', fontSize: '12px' }}>{entry.date_error}</div>
                ) : entry.date_input ? (
                  <div style={{ marginTop: '5px', color: '#166534', fontSize: '12px' }}>
                    已换算为第{entry.recurrence.week_range}周 {WEEK_DAYS[entry.recurrence.day]}
                  </div>
                ) : null}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
              <div className="form-group">
                <label>星期</label>
                <select disabled={entry.input_mode === 'date'} value={entry.recurrence.day} onChange={event => updateTimeEntry(index, next => {
                  next.recurrence.day = Number(event.target.value);
                  return next;
                })}>
                  {Object.entries(WEEK_DAYS).map(([day, label]) => <option key={day} value={day}>{label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>周次</label>
                <input disabled={entry.input_mode === 'date'} value={entry.recurrence.week_range} onChange={event => updateTimeEntry(index, next => {
                  next.recurrence.week_range = event.target.value;
                  return next;
                })} placeholder={`0-${maxWeeks}`} />
              </div>
              <div className="form-group">
                <label>单双周</label>
                <select disabled={entry.input_mode === 'date'} value={entry.recurrence.week_type} onChange={event => updateTimeEntry(index, next => {
                  next.recurrence.week_type = Number(event.target.value);
                  return next;
                })}>
                  <option value={0}>每周</option>
                  <option value={1}>单周</option>
                  <option value={2}>双周</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>时间方式</label>
              <div style={{ display: 'inline-flex' }}>
                {[
                  ['periods', '课程节次'],
                  ['clock', '实际时间'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    style={modeButtonStyle(entry.time.type === value)}
                    onClick={() => updateTimeEntry(index, next => {
                      next.time.type = value;
                      return next;
                    })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {entry.time.type === 'periods' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label>开始节</label>
                  <select value={entry.time.start_period} onChange={event => updateTimeEntry(index, next => {
                    next.time.start_period = Number(event.target.value);
                    return next;
                  })}>
                    {Array.from({ length: 12 }, (_, itemIndex) => itemIndex + 1).map(period => <option key={period}>{period}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>结束节</label>
                  <select value={entry.time.end_period} onChange={event => updateTimeEntry(index, next => {
                    next.time.end_period = Number(event.target.value);
                    return next;
                  })}>
                    {Array.from({ length: 12 }, (_, itemIndex) => itemIndex + 1).map(period => <option key={period}>{period}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label>开始时间</label>
                  <input type="time" value={entry.time.start || ''} onChange={event => updateTimeEntry(index, next => {
                    next.time.start = event.target.value;
                    return next;
                  })} required />
                </div>
                <div className="form-group">
                  <label>结束时间</label>
                  <input type="time" value={entry.time.end || ''} onChange={event => updateTimeEntry(index, next => {
                    next.time.end = event.target.value;
                    return next;
                  })} required />
                </div>
              </div>
            )}

            <div className="form-group">
              <label>地点</label>
              <input value={entry.location || ''} onChange={event => updateTimeEntry(index, next => {
                next.location = event.target.value;
                return next;
              })} maxLength={200} />
            </div>
          </div>
        ))}

        <button type="button" className="btn btn-secondary btn-sm" onClick={addTimeEntry}>添加另一时间</button>

        <div className="form-group">
          <label>备注</label>
          <textarea
            value={form.notes}
            onChange={event => setForm(current => ({ ...current, notes: event.target.value }))}
            maxLength={1000}
            rows={3}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div>
            {activity && (
              <button type="button" className="btn btn-danger" onClick={() => onDelete(activity)} disabled={saving}>
                删除活动
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中...' : '保存活动'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default ActivityEditorModal;
