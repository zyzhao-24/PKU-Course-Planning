import React from 'react';
import { HashRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SemesterProvider } from './contexts/SemesterContext';
import StudentLayout from './layouts/StudentLayout';
import StudentCourses from './pages/StudentCourses';
import StudentSchedule from './pages/StudentSchedule';
import StudentTranscript from './pages/StudentTranscript';
import StudentProgress from './pages/StudentProgress';
import AdminCourses from './pages/AdminCourses';
import AdminPrograms from './pages/AdminPrograms';
import AdminProgramEdit from './pages/AdminProgramEdit';
import AdminStudents from './pages/AdminStudents';
import './App.css';

function AppShell() {
  const { loading, isAuthenticated } = useAuth();

  if (loading) return <div>加载中...</div>;
  if (!isAuthenticated) return <div>正在初始化本地用户...</div>;

  return (
    <SemesterProvider>
      <Router>
        <Routes>
          <Route path="/" element={<StudentLayout />}>
            <Route index element={<Navigate to="/student/courses" replace />} />
            <Route path="student">
              <Route index element={<Navigate to="courses" replace />} />
              <Route path="courses" element={<StudentCourses />} />
              <Route path="schedule" element={<StudentSchedule />} />
              <Route path="transcript" element={<StudentTranscript />} />
              <Route path="progress" element={<StudentProgress />} />
            </Route>
            <Route path="admin">
              <Route index element={<Navigate to="courses" replace />} />
              <Route path="dashboard" element={<Navigate to="/admin/courses" replace />} />
              <Route path="courses" element={<AdminCourses />} />
              <Route path="programs" element={<AdminPrograms />} />
              <Route path="programs/:id" element={<AdminProgramEdit />} />
              <Route path="students" element={<AdminStudents />} />
              <Route path="semester-config" element={<Navigate to="/admin/courses" replace />} />
            </Route>
          </Route>
          <Route path="/login" element={<Navigate to="/student/courses" replace />} />
          <Route path="*" element={<Navigate to="/student/courses" replace />} />
        </Routes>
      </Router>
    </SemesterProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

export default App;
