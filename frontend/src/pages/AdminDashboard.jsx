import React, { useEffect, useState } from 'react';
import axios from '../utils/axios';

function AdminDashboard() {
  const [stats, setStats] = useState({
    students: 0,
    programs: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const [studentsRes, programsRes] = await Promise.all([
        axios.get('/api/admin/students'),
        axios.get('/api/admin/programs')
      ]);
      
      setStats({
        students: studentsRes.data.students?.length || 0,
        programs: programsRes.data.programs?.length || 0
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const cards = [
    { title: '学生总数', value: stats.students, color: '#0067c0', icon: '👥' },
    { title: '培养方案', value: stats.programs, color: '#28a745', icon: '📚' }
  ];

  return (
    <div>
      <div className="card">
        <h3 style={{ margin: 0 }}>管理概览</h3>
      </div>
      
      {loading ? (
        <div className="card">加载中...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px' }}>
          {cards.map(card => (
            <div key={card.title} className="card" style={{
              backgroundColor: card.color,
              color: 'white',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '10px' }}>{card.icon}</div>
              <div style={{ fontSize: '36px', fontWeight: 'bold' }}>{card.value}</div>
              <div style={{ fontSize: '16px', marginTop: '10px', opacity: 0.9 }}>{card.title}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;