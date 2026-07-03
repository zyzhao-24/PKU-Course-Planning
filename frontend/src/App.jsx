import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SemesterProvider } from './contexts/SemesterContext';
import Login from './pages/Login';
import StudentLayout from './layouts/StudentLayout';
import AdminLayout from './layouts/AdminLayout';
import StudentCourses from './pages/StudentCourses';
import StudentSchedule from './pages/StudentSchedule';
import StudentTranscript from './pages/StudentTranscript';
import StudentProgress from './pages/StudentProgress';
import AdminDashboard from './pages/AdminDashboard';
import AdminCourses from './pages/AdminCourses';
import AdminPrograms from './pages/AdminPrograms';
import AdminStudents from './pages/AdminStudents';
import AdminProgramEdit from './pages/AdminProgramEdit';
import AdminSemesterConfig from './pages/AdminSemesterConfig';
import './App.css';

// 路由守卫组件
const ProtectedRoute = ({ children, allowedRole }) => {
  const { isAuthenticated, user, loading } = useAuth();
  
  if (loading) return <div>加载中...</div>;
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  if (allowedRole && user?.role !== allowedRole) {
    return <Navigate to="/login" replace />;
  }
  
  return children;
};

function App() {
  return (
    <AuthProvider>
      <SemesterProvider>
        <Router>
          <Routes>
            {/* 登录页 - 公开访问 */}
            <Route path="/login" element={<Login />} />
            
            {/* 学生路由 */}
            <Route path="/student" element={
              <ProtectedRoute allowedRole="student">
                <StudentLayout />
              </ProtectedRoute>
            }>
              <Route index element={<Navigate to="courses" replace />} />
              <Route path="courses" element={<StudentCourses />} />
              <Route path="schedule" element={<StudentSchedule />} />
              <Route path="transcript" element={<StudentTranscript />} />
              <Route path="progress" element={<StudentProgress />} />
            </Route>
            
            {/* 管理员路由 */}
            <Route path="/admin" element={
              <ProtectedRoute allowedRole="admin">
                <AdminLayout />
              </ProtectedRoute>
            }>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="courses" element={<AdminCourses />} />
              <Route path="programs" element={<AdminPrograms />} />
              <Route path="programs/:id" element={<AdminProgramEdit />} />
              <Route path="students" element={<AdminStudents />} />
              <Route path="semester-config" element={<AdminSemesterConfig />} />
            </Route>
            
            {/* 默认重定向 */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Router>
      </SemesterProvider>
    </AuthProvider>
  );
}

export default App;