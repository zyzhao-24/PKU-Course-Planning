import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../App.css';

function Navbar({ selectedSemester }) {
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuRef]);

  return (
    <nav className="navbar">
      <div className="navbar-brand">选课系统</div>
      <div className="navbar-links">
        <Link to="/" className={location.pathname === '/' ? 'active' : ''}>课程查询</Link>
        <Link to="/program" className={location.pathname === '/program' && !location.search.includes('edit=true') ? 'active' : ''}>培养方案</Link>
        <Link to="/schedule" className={location.pathname === '/schedule' ? 'active' : ''}>我的课表</Link>
        {(!selectedSemester || !selectedSemester.endsWith('3')) && (
          <Link to="/exams" className={location.pathname === '/exams' ? 'active' : ''}>考试安排</Link>
        )}
      </div>
      
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '15px' }}>
        {/* Gear Icon Menu */}
        <div className="navbar-menu-container" ref={menuRef} style={{ position: 'relative' }}>
            <button 
                onClick={() => setShowMenu(!showMenu)}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    color: '#555',
                    padding: '5px',
                    display: 'flex',
                    alignItems: 'center'
                }}
                title="设置"
            >
                ⚙️
            </button>
            {showMenu && (
                <div className="navbar-dropdown" style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    backgroundColor: 'white',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    zIndex: 1000,
                    minWidth: '160px',
                    marginTop: '5px',
                    overflow: 'hidden'
                }}>
                    <Link 
                        to="/manage" 
                        className="dropdown-item" 
                        onClick={() => setShowMenu(false)}
                        style={{
                            display: 'block',
                            padding: '10px 15px',
                            color: '#333',
                            textDecoration: 'none',
                            fontSize: '0.9rem',
                            borderBottom: '1px solid #eee'
                        }}
                        onMouseEnter={e => e.target.style.backgroundColor = '#f8f9fa'}
                        onMouseLeave={e => e.target.style.backgroundColor = 'white'}
                    >
                        课程导入管理
                    </Link>
                    <Link 
                        to="/program?edit=true" 
                        className="dropdown-item" 
                        onClick={() => setShowMenu(false)}
                        style={{
                            display: 'block',
                            padding: '10px 15px',
                            color: '#333',
                            textDecoration: 'none',
                            fontSize: '0.9rem',
                            borderBottom: '1px solid #eee'
                        }}
                        onMouseEnter={e => e.target.style.backgroundColor = '#f8f9fa'}
                        onMouseLeave={e => e.target.style.backgroundColor = 'white'}
                    >
                        培养方案编辑
                    </Link>
                    <Link 
                        to="/semester-config" 
                        className="dropdown-item" 
                        onClick={() => setShowMenu(false)}
                        style={{
                            display: 'block',
                            padding: '10px 15px',
                            color: '#333',
                            textDecoration: 'none',
                            fontSize: '0.9rem'
                        }}
                        onMouseEnter={e => e.target.style.backgroundColor = '#f8f9fa'}
                        onMouseLeave={e => e.target.style.backgroundColor = 'white'}
                    >
                        学期日期配置
                    </Link>
                </div>
            )}
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
