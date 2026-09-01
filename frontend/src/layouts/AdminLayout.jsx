import React from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function AdminLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/admin/dashboard', label: '概览' },
    { path: '/admin/courses', label: '课程与学期' },
    { path: '/admin/general-requirements', label: '通用规定' },
    { path: '/admin/programs', label: '培养方案' },
    { path: '/admin/students', label: '设置' },
  ];

  return (
    <div className="container">
      <nav className="navbar">
        <div className="navbar-brand">选课规划和进度审查系统 - 管理员</div>
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
