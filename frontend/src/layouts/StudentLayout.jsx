import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

const DISCLAIMER_VISIBILITY_EVENT = 'course-planning-disclaimer-visibility-changed';

function StudentLayout() {
  const location = useLocation();
  const [disclaimerVisible, setDisclaimerVisible] = useState(null);

  useEffect(() => {
    let active = true;

    const loadDisclaimerPreference = async () => {
      let visible = true;

      if (window.electronAPI?.getAppSettings) {
        try {
          const settings = await window.electronAPI.getAppSettings();
          visible = settings?.ui?.showCoursePlanningDisclaimer !== false;
        } catch (error) {
          console.warn('Unable to read disclaimer preference from app settings', error);
        }
      }

      if (active) {
        setDisclaimerVisible(visible);
      }
    };

    const handleVisibilityChange = (event) => {
      setDisclaimerVisible(event.detail?.visible !== false);
    };

    loadDisclaimerPreference();
    window.addEventListener(DISCLAIMER_VISIBILITY_EVENT, handleVisibilityChange);
    return () => {
      active = false;
      window.removeEventListener(DISCLAIMER_VISIBILITY_EVENT, handleVisibilityChange);
    };
  }, []);

  const dismissDisclaimer = async () => {
    setDisclaimerVisible(false);

    if (window.electronAPI?.setCoursePlanningDisclaimerVisible) {
      try {
        await window.electronAPI.setCoursePlanningDisclaimerVisible(false);
      } catch (error) {
        console.warn('Unable to persist disclaimer preference to app settings', error);
        setDisclaimerVisible(true);
      }
    }
  };

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

      {disclaimerVisible === true && (
        <div className="system-disclaimer" role="alert">
          <span className="system-disclaimer__mark" aria-hidden="true">!</span>
          <div className="system-disclaimer__content">
            <strong>重要提示：</strong>
            本系统仅供规划选课使用，与学校系统无关，不能替代选课网（
            <a href="https://elective.pku.edu.cn" target="_blank" rel="noreferrer">elective.pku.edu.cn</a>
            ）进行正式选课。
          </div>
          <button
            type="button"
            className="system-disclaimer__dismiss"
            onClick={dismissDisclaimer}
          >
            不再提示
          </button>
        </div>
      )}

      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default StudentLayout;
