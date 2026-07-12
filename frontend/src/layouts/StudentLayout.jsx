import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSemester } from '../contexts/SemesterContext';

function StudentLayout() {
  const { user } = useAuth();
  const { semesters, selectedSemester, setSelectedSemester, loading } = useSemester();
  const location = useLocation();

  const navItems = [
    { path: '/student/courses', label: '选课' },
    { path: '/student/schedule', label: '我的课表' },
    { path: '/student/transcript', label: '成绩单' },
    { path: '/student/progress', label: '培养方案' },
    { path: '/admin/courses', label: '课程管理' },
    { path: '/admin/programs', label: '方案管理' },
    { path: '/admin/semester-config', label: '学期配置' },
    { path: '/admin/students', label: '设置' },
  ];

  return (
    <div className="container">
      <nav className="navbar">
        <div className="navbar-brand">选课与毕业审查系统</div>
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
        </div>
      </nav>

      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default StudentLayout;
