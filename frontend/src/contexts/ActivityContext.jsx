import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from '../utils/axios';
import { useSemester } from './SemesterContext';

const ActivityContext = createContext(null);

export function ActivityProvider({ children }) {
  const { selectedSemester } = useSemester();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshActivities = async () => {
    if (!selectedSemester) {
      setActivities([]);
      return [];
    }
    setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/student/activities', {
        params: { semester: selectedSemester },
      });
      const next = response.data.activities || [];
      setActivities(next);
      return next;
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      setActivities([]);
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshActivities();
  }, [selectedSemester]);

  const createActivity = async (payload) => {
    const response = await axios.post('/api/student/activities', payload);
    setActivities(current => [...current, response.data.activity]);
    return response.data.activity;
  };

  const updateActivity = async (activityUuid, payload) => {
    const response = await axios.put(`/api/student/activities/${activityUuid}`, payload);
    setActivities(current => current.map(item => (
      item.uuid === activityUuid ? response.data.activity : item
    )));
    return response.data.activity;
  };

  const deleteActivity = async (activityUuid) => {
    await axios.delete(`/api/student/activities/${activityUuid}`);
    setActivities(current => current.filter(item => item.uuid !== activityUuid));
  };

  return (
    <ActivityContext.Provider value={{
      activities,
      loading,
      error,
      refreshActivities,
      createActivity,
      updateActivity,
      deleteActivity,
    }}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivities() {
  const context = useContext(ActivityContext);
  if (!context) throw new Error('useActivities must be used within ActivityProvider');
  return context;
}
