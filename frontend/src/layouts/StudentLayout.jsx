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
    { path: '/admin/general-requirements', label: '通用规定' },
    { path: '/admin/programs', label: '方案管理' },
    { path: '/admin/students', label: '设置' },
  ];

  return (
    <div className="container">
      <nav className="navbar">
        <div className="navbar-brand">选课规划和进度审查系统</div>
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

      <div className="system-disclaimer" role="alert">
        <span className="system-disclaimer__mark" aria-hidden="true">!</span>
        <div>
          <strong>重要提示：</strong>
          本系统仅供规划选课使用，与学校系统无关，不能替代选课网（
          <a href="https://elective.pku.edu.cn" target="_blank" rel="noreferrer">elective.pku.edu.cn</a>
          ）进行正式选课。
        </div>
      </div>

      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default StudentLayout;
