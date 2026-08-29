import React from 'react';

function Modal({ isOpen, title, children, onConfirm, onCancel, confirmText = '确定', cancelText = '取消', showCancel = true, confirmButtonClass = 'btn btn-primary', hideFooter = false, maxWidth = '500px' }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
      justifyContent: 'center', alignItems: 'center', zIndex: 1100,
      backdropFilter: 'blur(4px)'
    }}>
      <div className="modal-content" style={{
        backgroundColor: 'white', padding: '24px', borderRadius: '12px',
        minWidth: '320px', maxWidth, width: '90%',
        boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        maxHeight: '85vh', overflowY: 'auto',
        border: '1px solid rgba(255,255,255,0.5)'
      }}>
        {title && <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '1.25rem', color: '#1a1a1a' }}>{title}</h3>}
        <div style={{ marginBottom: hideFooter ? '0' : '24px' }}>
          {children}
        </div>
        {!hideFooter && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
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
