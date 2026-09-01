import React, { useEffect } from 'react';

function Modal({ isOpen, title, children, onConfirm, onCancel, confirmText = '确定', cancelText = '取消', showCancel = true, confirmButtonClass = 'btn btn-primary', hideFooter = false, maxWidth = '500px' }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
      justifyContent: 'center', alignItems: 'center', zIndex: 1100,
      padding: '16px', boxSizing: 'border-box',
      backdropFilter: 'blur(4px)'
    }}>
      <div className="modal-content" style={{
        display: 'flex', flexDirection: 'column',
        backgroundColor: 'white', padding: 0, borderRadius: '8px',
        minWidth: 0, maxWidth, width: '90%',
        boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        maxHeight: '85vh', overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.5)'
      }}>
        {title && <h3 style={{
          flexShrink: 0,
          margin: 0,
          padding: '20px 24px 16px',
          borderBottom: '1px solid #edf2f7',
          fontSize: '1.1rem',
          color: '#1a1a1a'
        }}>{title}</h3>}
        <div style={{
          minHeight: 0,
          overflowY: 'auto',
          padding: title ? `16px 24px ${hideFooter ? '24px' : '0'}` : `24px 24px ${hideFooter ? '24px' : '0'}`,
        }}>
          {children}
        </div>
        {!hideFooter && (
          <div style={{
            display: 'flex',
            flexShrink: 0,
            justifyContent: 'flex-end',
            gap: '10px',
            padding: '16px 24px 20px',
            borderTop: '1px solid #edf2f7',
          }}>
            {showCancel && (
              <button className="btn btn-secondary" onClick={onCancel}>
                {cancelText}
              </button>
            )}
            <button className={confirmButtonClass} onClick={onConfirm}>
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
