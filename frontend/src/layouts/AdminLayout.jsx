import React from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSemester } from '../contexts/SemesterContext';

function AdminLayout() {
  const { user, logout } = useAuth();
  const { semesters, selectedSemester, setSelectedSemester, loading } = useSemester();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/admin/dashboard', label: '概览' },
    { path: '/admin/courses', label: '课程管理' },
    { path: '/admin/programs', label: '培养方案' },
    { path: '/admin/students', label: '学生管理' },
    { path: '/admin/semester-config', label: '学期配置' },
  ];

  return (
    <div className="container">
      <nav className="navbar">
        <div className="navbar-brand">选课与毕业审查系统 - 管理员</div>
        <div className="navbar-links">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={location.pathname.startsWith(item.path) ? 'active' : ''}
            >
              {item.label}
            </Link>
          ))}
          
          {/* 学期选择器 - 美化的下拉框 */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            marginLeft: '20px',
            marginRight: '15px',
            padding: '4px 12px',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            borderRadius: '20px',
            border: '1px solid #e0e0e0',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
          }}>
            <span style={{ 
              fontSize: '13px', 
              color: '#666',
              fontWeight: '500',
              whiteSpace: 'nowrap'
            }}>
              学期:
            </span>
            <select 
              value={selectedSemester} 
              onChange={(e) => setSelectedSemester(e.target.value)}
              disabled={loading}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: '14px',
                fontWeight: '600',
                color: '#0067c0',
                cursor: 'pointer',
                outline: 'none',
                padding: '4px 8px',
                minWidth: '100px'
              }}
            >
              {semesters.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <span style={{ color: '#666', fontSize: '14px' }}>
            {user?.name || user?.username}
          </span>
          <button 
            className="btn btn-danger btn-sm" 
            onClick={handleLogout}
            style={{ marginLeft: '10px' }}
          >
            退出
          </button>
        </div>
      </nav>

      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default AdminLayout;