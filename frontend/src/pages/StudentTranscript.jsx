import React, { useState, useEffect } from 'react';
import axios from '../utils/axios';
import Modal from '../components/Modal';
import PortalConnectModal from '../components/PortalConnectModal';
import { getScoreColor, getFillPercent, getGPA, calculateSetGPA, calculateSetCredits, isCreditCounted, GRADE_TO_GPA } from '../utils';

// 动态彩虹背景组件
const RainbowBar = ({ fillPercent }) => (
  <div style={{
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: `${fillPercent}%`,
    background: 'linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3, #ff0000)',
    backgroundSize: '200% 100%',
    animation: 'rainbow-flow 3s linear infinite',
    borderRadius: '12px 0 0 12px'
  }} />
);

// 添加彩虹动画样式
const RainbowStyle = () => (
  <style>{`
    @keyframes rainbow-flow {
      0% { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
  `}</style>
);

// 课程卡片组件 - 大色条显示
const CourseCard = ({ course }) => {
  const color = getScoreColor(course.score, course.score_type);
  const fillPercent = getFillPercent(course.score, course.score_type);
  const isPercent = course.score_type === 'Percentage';
  const gpa = getGPA(course.score, course.score_type);
  const isRainbow = color === 'rainbow';
  const textStyle = { color: color === '#ffffff' ? '#000000' : '#ffffff' };
  
  return (
    <div style={{
      position: 'relative',
      height: '70px',
      backgroundColor: '#1a1a1a',
      borderRadius: '12px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center'
    }}>
      {isRainbow && <RainbowBar fillPercent={fillPercent} />}
      {!isRainbow && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${fillPercent}%`,
          background: color,
          borderRadius: '12px 0 0 12px'
        }} />
      )}
      
      <div style={{
        position: 'relative',
        zIndex: 10,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '20px'
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            ...textStyle,
            fontSize: '16px',
            fontWeight: 'bold',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {course.course_name}
          </div>
          <div style={{
            ...textStyle,
            fontSize: '12px',
            marginTop: '4px',
            opacity: 0.85
          }}>
            {course.course_id} · {course.class_number || '无班号'} · {course.credits.toFixed(1)}学分
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ ...textStyle, fontSize: '22px', fontWeight: 'bold' }}>
              {course.score}
            </div>
            <div style={{ ...textStyle, fontSize: '10px', opacity: 0.7 }}>成绩</div>
          </div>
          
          <div style={{ width: '1px', height: '35px', background: 'rgba(255,255,255,0.3)' }} />
          
          <div style={{ textAlign: 'center', minWidth: '50px' }}>
            {gpa !== null ? (
              <>
                <div style={{ ...textStyle, fontSize: '20px', fontWeight: 'bold' }}>
                  {gpa.toFixed(2)}
                </div>
                <div style={{ ...textStyle, fontSize: '10px', opacity: 0.7 }}>绩点</div>
              </>
            ) : (
              <>
                <div style={{ ...textStyle, fontSize: '16px', fontWeight: 'bold', opacity: 0.6 }}>
                  -.--
                </div>
                <div style={{ ...textStyle, fontSize: '10px', opacity: 0.7 }}>绩点</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// 转交流课程卡片（特殊显示：100%蓝色进度条，与免修相同）
const ExchangeCourseCard = ({ course }) => {
  // 固定蓝色（与免修EX相同），100%填满
  const color = '#2196f3';
  const textStyle = { color: '#ffffff' };
  
  return (
    <div style={{
      position: 'relative',
      height: '70px',
      backgroundColor: '#1a1a1a',
      borderRadius: '12px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center'
    }}>
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '100%',
        background: color,
        borderRadius: '12px'
      }} />
      
      <div style={{
        position: 'relative',
        zIndex: 10,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '20px'
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            ...textStyle,
            fontSize: '16px',
            fontWeight: 'bold',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {course.course_name}
          </div>
          <div style={{
            ...textStyle,
            fontSize: '12px',
            marginTop: '4px',
            opacity: 0.85
          }}>
            {course.conversion_type || '成绩转换'} · {course.credits.toFixed(1)}学分
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ ...textStyle, fontSize: '22px', fontWeight: 'bold' }}>
              {course.score}
            </div>
            <div style={{ ...textStyle, fontSize: '10px', opacity: 0.7 }}>成绩</div>
          </div>
          
          <div style={{ width: '1px', height: '35px', background: 'rgba(255,255,255,0.3)' }} />
          
          <div style={{ textAlign: 'center', minWidth: '50px' }}>
            <div style={{ ...textStyle, fontSize: '16px', fontWeight: 'bold', opacity: 0.6 }}>
              -.--
            </div>
            <div style={{ ...textStyle, fontSize: '10px', opacity: 0.7 }}>绩点</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 毕业论文卡片（未完成状态紫色填满）
const DissertationCard = ({ dissertation }) => {
  if (!dissertation || !dissertation.complete) {
    // 未完成状态：紫色填满，N/A
    return (
      <div style={{
        position: 'relative',
        height: '70px',
        backgroundColor: '#1a1a1a',
        borderRadius: '12px',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center'
      }}>
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '100%',
          background: '#9c27b0',
          borderRadius: '12px'
        }} />
        
        <div style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          gap: '20px'
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: '#ffffff',
              fontSize: '16px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              毕业论文
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#ffffff', fontSize: '22px', fontWeight: 'bold' }}>
                N/A
              </div>
              <div style={{ color: '#ffffff', fontSize: '10px', opacity: 0.7 }}>成绩</div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // 已完成状态
  const color = getScoreColor(dissertation.score, dissertation.score_type);
  const fillPercent = getFillPercent(dissertation.score, dissertation.score_type);
  const gpa = getGPA(dissertation.score, dissertation.score_type);
  const isPercent = dissertation.score_type === 'Percentage';
  const isRainbow = color === 'rainbow';
  const textStyle = { color: color === '#ffffff' ? '#000000' : '#ffffff' };
  
  return (
    <div style={{
      position: 'relative',
      height: '70px',
      backgroundColor: '#1a1a1a',
      borderRadius: '12px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center'
    }}>
      {isRainbow && <RainbowBar fillPercent={fillPercent} />}
      {!isRainbow && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${fillPercent}%`,
          background: color,
          borderRadius: '12px 0 0 12px'
        }} />
      )}
      
      <div style={{
        position: 'relative',
        zIndex: 10,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '20px'
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            ...textStyle,
            fontSize: '16px',
            fontWeight: 'bold',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            毕业论文
          </div>
          <div style={{
            ...textStyle,
            fontSize: '12px',
            marginTop: '4px',
            opacity: 0.85
          }}>
            {dissertation.title || '-'} · {dissertation.credits.toFixed(1)}学分
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexShrink: 0 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ ...textStyle, fontSize: '22px', fontWeight: 'bold' }}>
              {dissertation.score}
            </div>
            <div style={{ ...textStyle, fontSize: '10px', opacity: 0.7 }}>成绩</div>
          </div>
          
          <div style={{ width: '1px', height: '35px', background: 'rgba(255,255,255,0.3)' }} />
          
          <div style={{ textAlign: 'center', minWidth: '50px' }}>
            {gpa !== null ? (
              <>
                <div style={{ ...textStyle, fontSize: '20px', fontWeight: 'bold' }}>
                  {gpa.toFixed(2)}
                </div>
                <div style={{ ...textStyle, fontSize: '10px', opacity: 0.7 }}>绩点</div>
              </>
            ) : (
              <>
                <div style={{ ...textStyle, fontSize: '16px', fontWeight: 'bold', opacity: 0.6 }}>
                  -.--
                </div>
                <div style={{ ...textStyle, fontSize: '10px', opacity: 0.7 }}>绩点</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function StudentTranscript() {
  const [transcripts, setTranscripts] = useState([]);
  const [dissertation, setDissertation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [portalConnectOpen, setPortalConnectOpen] = useState(false);
  const [totalGPA, setTotalGPA] = useState('-.---');
  const [totalCredits, setTotalCredits] = useState(0);
  
  const [modal, setModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'info'
  });

  const [expandedTerms, setExpandedTerms] = useState({});

  useEffect(() => {
    fetchTranscript();
  }, []);
  
  const showModal = (title, message, type = 'info') => {
    setModal({ isOpen: true, title, message, type });
  };
  
  const closeModal = () => {
    setModal(prev => ({ ...prev, isOpen: false }));
  };

  const fetchTranscript = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/student/transcript');
      if (res.data.success) {
        const data = res.data.transcripts || [];
        setTranscripts(data);
        setDissertation(res.data.dissertation);
        
        let allCourses = [];
        
        data.forEach(term => {
          if (term.courses) {
            allCourses = allCourses.concat(term.courses);
          }
          if (term.exchange_courses) {
            // 转交流课程用"P"作为成绩计算学分，确保无论原始成绩如何都计入学分
            const exchangeForCalc = term.exchange_courses.map(c => ({ ...c, score: 'P', score_type: 'P/NP' }));
            allCourses = allCourses.concat(exchangeForCalc);
          }
        });
        
        if (res.data.dissertation?.complete) {
          allCourses.push({
            score: res.data.dissertation.score,
            score_type: res.data.dissertation.score_type,
            credits: res.data.dissertation.credits
          });
        }
        
        const calculatedCredits = calculateSetCredits(allCourses);
        setTotalCredits(calculatedCredits);
        setTotalGPA(calculateSetGPA(allCourses) || '-.---');
      }
    } catch (err) {
      console.error('获取成绩单失败', err);
      alert('获取成绩单失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const syncRes = await axios.post('/api/student/transcript/sync');
      if (!syncRes.data.success) {
        showModal('同步失败', '同步成绩单失败: ' + syncRes.data.message, 'error');
        return;
      }
      const autoSelect = syncRes.data.auto_select;
      if (autoSelect?.success) {
        showModal('同步完成',
          `成绩单: ${syncRes.data.message}\n自动选课: ${autoSelect.message}`,
          'success');
        fetchTranscript();
      } else {
        showModal('同步完成',
          `成绩单: ${syncRes.data.message}\n${autoSelect?.message || '自动选课未执行'}`,
          'error');
        fetchTranscript();
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      if (err.response?.data?.portal_required) {
        setPortalConnectOpen(true);
        return;
      }
      if (errorMsg.includes('IAAA会话已过期') || errorMsg.includes('Portal会话已过期')) {
        showModal('会话过期', '会话已过期，请退出后重新登录', 'error');
      } else {
        showModal('同步失败', errorMsg, 'error');
      }
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  const toggleTerm = (key) => {
    setExpandedTerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 计算学期所有课程（包括转交流）的学分
  // 转交流课程强制计入学分（用"P"作为成绩计算，确保无论原始成绩如何都计入）
  const calculateTermTotalCredits = (term) => {
    let credits = 0;
    if (term.courses) {
      credits += calculateSetCredits(term.courses);
    }
    if (term.exchange_courses) {
      // 转交流课程用"P"作为成绩计算学分，确保无论原始成绩如何都计入学分
      const exchangeForCalc = term.exchange_courses.map(c => ({ ...c, score: 'P', score_type: 'P/NP' }));
      credits += calculateSetCredits(exchangeForCalc);
    }
    return credits;
  };

  if (loading) {
    return <div className="card">加载中...</div>;
  }

  return (
    <div>
      <Modal
        isOpen={modal.isOpen}
        title={modal.title}
        onConfirm={closeModal}
        onCancel={closeModal}
        showCancel={false}
        confirmButtonClass={`btn ${modal.type === 'error' ? 'btn-danger' : modal.type === 'success' ? 'btn-success' : 'btn-primary'}`}
      >
        <div style={{ whiteSpace: 'pre-line' }}>{modal.message}</div>
      </Modal>
      <PortalConnectModal
        isOpen={portalConnectOpen}
        onCancel={() => setPortalConnectOpen(false)}
        onConnected={async () => {
          setPortalConnectOpen(false);
          await handleSync();
        }}
      />
      
      <RainbowStyle />
      
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
          <h3 style={{ margin: 0 }}>成绩单</h3>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
            {syncing ? '同步中...' : '同步成绩单'}
          </button>
        </div>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', 
          gap: '15px',
          marginTop: '20px'
        }}>
          <div style={{ 
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            padding: '20px',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold' }}>{totalGPA}</div>
            <div style={{ fontSize: '14px', opacity: 0.9 }}>总平均绩点</div>
          </div>
          <div style={{ 
            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            color: 'white',
            padding: '20px',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold' }}>{totalCredits}</div>
            <div style={{ fontSize: '14px', opacity: 0.9 }}>总学分</div>
          </div>
        </div>

        <div style={{ marginTop: '20px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>成绩图例:</span>
          <span style={{ fontSize: '11px', padding: '2px 6px', background: '#4caf50', color: 'white', borderRadius: '3px' }}>优秀</span>
          <span style={{ fontSize: '11px', padding: '2px 6px', background: '#ffee58', color: '#888', borderRadius: '3px' }}>良好</span>
          <span style={{ fontSize: '11px', padding: '2px 6px', background: '#f4511e', color: 'white', borderRadius: '3px' }}>及格</span>
          <span style={{ fontSize: '11px', padding: '2px 6px', background: '#b71c1c', color: 'white', borderRadius: '3px' }}>不及格</span>
          <span style={{ fontSize: '11px', padding: '2px 6px', background: '#9c27b0', color: 'white', borderRadius: '3px' }}>退课/缓考/未完成</span>
          <span style={{ fontSize: '11px', padding: '2px 6px', background: '#2196f3', color: 'white', borderRadius: '3px' }}>免修/转交流</span>
        </div>
        <span style={{ fontSize: '12px', color: '#666' }}>本页面不能用作任何成绩证明用途，请以官方出具的成绩单为准！</span>
      </div>

      {transcripts.length === 0 && !dissertation?.complete ? (
        <div className="card" style={{ textAlign: 'center', color: '#666' }}>
          暂无成绩单数据，请点击"同步成绩单"按钮导入
        </div>
      ) : (
        <>
          {transcripts.map((term) => {
            const hasMinor = term.courses?.some(c => c.channel === 1);
            const hasExchange = term.exchange_courses?.length > 0;
            const needCategoryLabels = hasMinor || hasExchange;
            
            return (
              <div key={`${term.academic_year}-${term.term}`} className="card">
                <div 
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    cursor: 'pointer',
                    padding: '10px 0'
                  }}
                  onClick={() => toggleTerm(`${term.academic_year}-${term.term}`)}
                >
                  <h4 style={{ margin: 0 }}>
                    {term.academic_year}学年 第{term.term}学期
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <span style={{ color: '#666', fontSize: '14px' }}>
                      学期绩点: <strong>{calculateSetGPA(term.courses)}</strong> | 
                      学分: <strong>{calculateTermTotalCredits(term).toFixed(1)}</strong>
                    </span>
                    <span style={{ fontSize: '20px' }}>
                      {expandedTerms[`${term.academic_year}-${term.term}`] ? '▼' : '▶'}
                    </span>
                  </div>
                </div>

                {expandedTerms[`${term.academic_year}-${term.term}`] && (
                  <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {/* 只有存在非主修课程时才显示分类标签 */}
                    {needCategoryLabels && (
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 'bold',
                        color: '#333',
                        padding: '8px 0',
                        borderBottom: '2px solid #e0e0e0',
                        marginBottom: '5px'
                      }}>
                        主修成绩
                      </div>
                    )}
                    
                    {term.courses?.filter(c => c.channel === 0).map((course) => (
                      <CourseCard key={course.record_id} course={course} />
                    ))}
                    
                    {hasMinor && (
                      <>
                        <div style={{
                          fontSize: '14px',
                          fontWeight: 'bold',
                          color: '#1565c0',
                          padding: '8px 0',
                          borderBottom: '2px solid #90caf9',
                          marginTop: '10px',
                          marginBottom: '5px'
                        }}>
                          辅双成绩
                        </div>
                        {term.courses.filter(c => c.channel === 1).map((course) => (
                          <CourseCard key={course.record_id} course={course} />
                        ))}
                      </>
                    )}
                    
                    {hasExchange && (
                      <>
                        <div style={{
                          fontSize: '14px',
                          fontWeight: 'bold',
                          color: '#2e7d32',
                          padding: '8px 0',
                          borderBottom: '2px solid #a5d6a7',
                          marginTop: '10px',
                          marginBottom: '5px'
                        }}>
                          转交流成绩
                        </div>
                        {term.exchange_courses.map((course) => (
                          <ExchangeCourseCard key={course.id} course={course} />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          
          <div className="card">
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              padding: '10px 0'
            }}>
              <h4 style={{ margin: 0 }}>毕业论文</h4>
            </div>
            <div style={{ marginTop: '15px' }}>
              <DissertationCard dissertation={dissertation} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default StudentTranscript;
