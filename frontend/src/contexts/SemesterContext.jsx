import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from '../utils/axios';
import { sortSemestersDescending } from '../utils/semesters';

const SemesterContext = createContext(null);

export function SemesterProvider({ children }) {
  const [semesters, setSemesters] = useState([]);
  const [semesterConfigs, setSemesterConfigs] = useState({});
  const [selectedSemester, setSelectedSemester] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 只在有 token 时才获取学期列表
    const token = localStorage.getItem('token');
    if (token) {
      fetchSemesters();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchSemesters = async () => {
    try {
      const res = await axios.get('/api/semesters');
      const nextSemesters = sortSemestersDescending(res.data.semesters || []);
      setSemesters(nextSemesters);
      setSemesterConfigs(res.data.configs || {});
      setSelectedSemester(current => (
        nextSemesters.includes(current) ? current : (nextSemesters[0] || '')
      ));
    } catch (err) {
      // 401 错误是正常的（未登录），不显示错误
      if (err.response?.status !== 401) {
        console.error('Failed to fetch semesters', err);
      }
    } finally {
      setLoading(false);
    }
  };

  // 获取当前学期的配置
  const getCurrentSemesterConfig = () => {
    return semesterConfigs[selectedSemester] || {};
  };

  // 获取第一周周一日期
  const getFirstWeekMonday = () => {
    const config = getCurrentSemesterConfig();
    return config.first_week_monday ? new Date(config.first_week_monday) : null;
  };

  return (
    <SemesterContext.Provider value={{
      semesters,
      semesterConfigs,
      selectedSemester,
      setSelectedSemester,
      getCurrentSemesterConfig,
      getFirstWeekMonday,
      loading,
      refreshSemesters: fetchSemesters
    }}>
      {children}
    </SemesterContext.Provider>
  );
}

export function useSemester() {
  const context = useContext(SemesterContext);
  if (!context) {
    throw new Error('useSemester must be used within a SemesterProvider');
  }
  return context;
}
