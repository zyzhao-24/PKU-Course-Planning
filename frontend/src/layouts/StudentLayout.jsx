import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

function StudentLayout() {
  const location = useLocation();

  const navItems = [
    { path: '/student/courses', label: '选课' },
    { path: '/student/schedule', label: '我的课表' },
    { path: '/student/transcript', label: '成绩单' },
    { path: '/student/progress', label: '培养方案' },
    { path: '/admin/courses', label: '课程与学期' },
    { path: '/admin/programs', label: '方案管理' },
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
        </div>
      </nav>

      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default StudentLayout;
