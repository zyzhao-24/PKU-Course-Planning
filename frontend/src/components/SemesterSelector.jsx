import React, { useEffect, useRef, useState } from 'react';
import { useSemester } from '../contexts/SemesterContext';

function SemesterSelector({ compact = false }) {
  const { semesters, selectedSemester, setSelectedSemester, loading } = useSemester();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!semesters.length) return null;

  const height = compact ? '30px' : '34px';
  const fontSize = compact ? '13px' : '14px';
  const valueWidth = `${Math.max(compact ? 84 : 92, selectedSemester.length * 8 + 28)}px`;

  return (
    <div ref={wrapperRef} style={{
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      gap: compact ? '6px' : '8px',
      height,
      padding: compact ? '0 10px' : '0 12px',
      backgroundColor: '#f8fafc',
      borderRadius: '8px',
      border: '1px solid #e2e8f0',
      boxSizing: 'border-box',
      width: 'fit-content'
    }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: '100%',
        fontSize,
        lineHeight: 1,
        color: '#4a5568',
        fontWeight: 500,
        whiteSpace: 'nowrap'
      }}>
        学期
      </span>
      <button
        type="button"
        disabled={loading}
        onClick={() => setOpen(prev => !prev)}
        style={{
          display: 'inline-grid',
          gridTemplateColumns: '1fr 12px',
          alignItems: 'center',
          gap: '4px',
          width: valueWidth,
          height: compact ? '24px' : '26px',
          padding: '0 6px 0 10px',
          border: '1px solid #d8e3ef',
          borderRadius: '6px',
          backgroundColor: loading ? '#eef2f6' : '#edf5fb',
          color: '#24577a',
          cursor: loading ? 'not-allowed' : 'pointer',
          fontSize,
          fontWeight: 600,
          fontFamily: 'inherit',
          lineHeight: 1,
          boxSizing: 'border-box',
          outline: 'none'
        }}
      >
        <span style={{ textAlign: 'center' }}>{selectedSemester}</span>
        <span
          aria-hidden="true"
          style={{
            color: '#607d96',
            fontSize: '10px',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease'
          }}
        >
          ▼
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: `calc(100% + 6px)`,
          right: compact ? '10px' : '12px',
          zIndex: 1200,
          minWidth: valueWidth,
          padding: '6px',
          border: '1px solid #d8e3ef',
          borderRadius: '8px',
          backgroundColor: '#fbfdff',
          boxShadow: '0 10px 24px rgba(39, 78, 109, 0.14)',
          boxSizing: 'border-box'
        }}>
          {semesters.map(semester => {
            const selected = semester === selectedSemester;
            return (
              <button
                type="button"
                key={semester}
                onClick={() => {
                  setSelectedSemester(semester);
                  setOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: compact ? '7px 10px' : '8px 12px',
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: selected ? '#e6f0f8' : 'transparent',
                  color: selected ? '#24577a' : '#475569',
                  cursor: 'pointer',
                  fontSize,
                  fontWeight: selected ? 600 : 500,
                  fontFamily: 'inherit',
                  textAlign: 'center',
                  whiteSpace: 'nowrap'
                }}
                onMouseEnter={(event) => {
                  if (!selected) event.currentTarget.style.backgroundColor = '#f1f6fa';
                }}
                onMouseLeave={(event) => {
                  if (!selected) event.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {semester}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SemesterSelector;
