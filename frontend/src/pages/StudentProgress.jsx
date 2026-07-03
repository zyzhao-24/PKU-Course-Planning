import React, { useEffect, useState } from 'react';
import axios from '../utils/axios';
import Modal from '../components/Modal';
import { useSemester } from '../contexts/SemesterContext';
import { getFilterDescription, getCourseListRulesDescription, getNodeRulesDescription, DEPARTMENT_CODE_MAP, formatClassTimes, checkTimeConflict } from '../utils';

function StudentProgress() {
  const { selectedSemester } = useSemester();
  const [progressData, setProgressData] = useState({ major: null, minor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('major'); // 'major' | 'minor'
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [expandedDescriptions, setExpandedDescriptions] = useState(new Set()); // 展开规则描述的节点/列表
  const [allCourses, setAllCourses] = useState([]); // 所有课程列表
  const [allNodes, setAllNodes] = useState([]); // 所有节点列表

  const [modal, setModal] = useState({
    isOpen: false,
    title: '',
    content: null,
    onConfirm: () => {},
    showCancel: true
  });

  // 课程列表选课模态框状态
  const [courseListModal, setCourseListModal] = useState({
    isOpen: false,
    courseList: null,
    channel: 0, // 0=主修, 1=辅双
    filters: {},
    matchingCourses: [],
    loading: false
  });
  
  // 课程移动模态框状态

  const [moveModal, setMoveModal] = useState({
    isOpen: false,
    course: null,
    fromListId: null,
    targetLists: [],
    selectedTargetId: null,
    canUnassign: false,
    loading: false,
    message: ''
  });
  
  // 已选课程详情（用于冲突检查）
  const [selectedCoursesDetails, setSelectedCoursesDetails] = useState([]);
  const [selectedCourseUuids, setSelectedCourseUuids] = useState(new Set());
  const [transcriptCourseIds, setTranscriptCourseIds] = useState(new Set()); // 成绩单中的课程号（排除W）
  const [allSemesterSelectedCourses, setAllSemesterSelectedCourses] = useState([]); // 所有学期已选课程
  const [modalConflicts, setModalConflicts] = useState(new Set()); // 模态框中的冲突检测

  useEffect(() => {
    fetchProgress();
    fetchAllCourses();
    fetchSelectedCourses();
  }, []);

  // 当学期变化时重新获取已选课程
  useEffect(() => {
    if (selectedSemester) {
      fetchSelectedCourses();
    }
  }, [selectedSemester]);

  const fetchSelectedCourses = async () => {
    try {
      // 1. 获取成绩单，识别已有成绩的课程（排除W成绩）
      const transcriptRes = await axios.get('/api/student/transcript');
      let newTranscriptCourseIds = new Set();
      if (transcriptRes.data.success) {
        const transcripts = transcriptRes.data.transcripts || [];
        const allTranscriptCourses = [];
        transcripts.forEach(term => {
          if (term.courses) {
            allTranscriptCourses.push(...term.courses);
          }
        });
        // 记录成绩单中的课程号（排除W成绩）
        newTranscriptCourseIds = new Set(
          allTranscriptCourses
            .filter(c => c.score !== 'W')
            .map(c => c.course_id)
        );
      }
      setTranscriptCourseIds(newTranscriptCourseIds);

      // 2. 获取当前学期已选课程
      const res = await axios.get(`/api/student/selected?semester=${selectedSemester}`);
      const uuids = new Set(res.data.selected_uuids);
      setSelectedCourseUuids(uuids);
      
      const details = res.data.selected_details.map(d => ({
          uuid: d.course_uuid,
          course_name: d.course_name,
          class_times: d.class_times,
          week_range: d.week_range,
          course_id: d.course_id,
          department_code: d.department_code
      }));
      setSelectedCoursesDetails(details);

      // 3. 获取所有学期已选课程（用于检查同课号+同学院限制）
      const allRes = await axios.get('/api/student/selected');
      if (allRes.data.selected_details) {
        setAllSemesterSelectedCourses(allRes.data.selected_details.map(d => ({
          course_id: d.course_id,
          department_code: d.department_code,
          semester: d.semester
        })));
      }
    } catch (err) {
      console.error('获取已选课程失败', err);
    }
  };

  const fetchProgress = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/student/progress');
      if (res.data.success) {
        const progress = res.data.progress || { major: null, minor: null };
        setProgressData(progress);
        
        // 收集所有节点到 allNodes
        const nodes = [];
        const collectNodes = (nodeList, parentId = null) => {
          nodeList?.forEach(node => {
            nodes.push({ id: node.id, name: node.name, type: 'node', parentId });
            if (node.children) {
              node.children.forEach(child => {
                if (child.type === 'course_list') {
                  nodes.push({ id: child.id, name: child.name, type: 'courselist', parentId: node.id });
                } else {
                  collectNodes([child], node.id);
                }
              });
            }
          });
        };
        
        if (progress.major?.categories) {
          progress.major.categories.forEach(cat => collectNodes(cat.nodes));
        }
        if (progress.minor?.categories) {
          progress.minor.categories.forEach(cat => collectNodes(cat.nodes));
        }
        setAllNodes(nodes);
        
        // 默认展开所有节点
        const allIds = new Set();
        const collectIds = (nodes) => {
          nodes?.forEach(node => {
            allIds.add(node.id);
            if (node.children) collectIds(node.children);
          });
        };
        if (progress?.major?.categories) {
          progress.major.categories.forEach(cat => collectIds(cat.nodes));
        }
        if (progress?.minor?.categories) {
          progress.minor.categories.forEach(cat => collectIds(cat.nodes));
        }
        setExpandedNodes(allIds);
      } else {
        setError(res.data.message || '获取进度失败');
      }
    } catch (err) {
      setError(err.response?.data?.message || '获取培养方案进度失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchAllCourses = async () => {
    try {
      // 获取所有课程（不分页）
      const res = await axios.get('/api/courses', { params: { per_page: 0 } });
      setAllCourses(res.data.courses || []);
    } catch (err) {
      console.error('获取课程列表失败', err);
    }
  };

  const recalculateProgress = async () => {
    try {
      setLoading(true);
      await axios.post('/api/student/progress/recalculate');
      await fetchProgress();
    } catch (err) {
      setModal({
        isOpen: true,
        title: '错误',
        content: '重新计算失败: ' + (err.response?.data?.message || err.message),
        onConfirm: () => setModal(m => ({ ...m, isOpen: false })),
        showCancel: false
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (nodeId) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const expandAll = () => {
    const allIds = new Set();
    const collectIds = (nodes) => {
      nodes?.forEach(node => {
        allIds.add(node.id);
        if (node.children) collectIds(node.children);
      });
    };
    const currentProgram = activeTab === 'major' ? progressData.major : progressData.minor;
    currentProgram?.categories?.forEach(cat => collectIds(cat.nodes));
    setExpandedNodes(allIds);
  };

  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  // ==================== 渲染组件 ====================

  const renderProgressBar = (current, required, label) => {
    if (!required || required <= 0) return null;
    const percent = Math.min(100, (current / required) * 100);
    const isComplete = current >= required;
    
    return (
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px' }}>
          <span>{label}</span>
          <span style={{ color: isComplete ? '#28a745' : '#666' }}>
            {current.toFixed(1)} / {required}
          </span>
        </div>
        <div style={{ height: '6px', backgroundColor: '#e0e0e0', borderRadius: '3px' }}>
          <div style={{
            width: `${percent}%`,
            height: '100%',
            backgroundColor: isComplete ? '#28a745' : '#0067c0',
            borderRadius: '3px',
            transition: 'width 0.3s'
          }} />
        </div>
      </div>
    );
  };

  const toggleDescription = (id) => {
    setExpandedDescriptions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 检查是否有筛选条件
  const hasFilters = (filters) => {
    if (!filters) return false;
    return (filters.course_id?.length > 0) || 
           (filters.dept?.length > 0) || 
           (filters.course_type?.length > 0);
  };



  // 打开课程移动模态框
  const openMoveModal = async (course, fromListId) => {
    setMoveModal({
      isOpen: true,
      course: course,
      fromListId: fromListId,
      targetLists: [],
      selectedTargetId: null,
      canUnassign: false,
      loading: true,
      message: ''
    });
    
    try {
      // 获取可以移动到的目标列表
      const res = await axios.post('/api/student/courses/can-move', {
        source_uuid: course.source_uuid,
        channel: activeTab === 'major' ? 0 : 1
      });
      
      if (res.data.success) {
        setMoveModal(prev => ({
          ...prev,
          targetLists: res.data.target_lists || [],
          canUnassign: res.data.can_unassign || false,
          loading: false,
          message: ''
        }));
      } else {
        setMoveModal(prev => ({
          ...prev,
          loading: false,
          message: res.data.message || '获取目标列表失败'
        }));
      }
    } catch (err) {
      setMoveModal(prev => ({
        ...prev,
        loading: false,
        message: '获取目标列表失败: ' + (err.response?.data?.message || err.message)
      }));
    }
  };

  const closeMoveModal = () => {
    setMoveModal({
      isOpen: false,
      course: null,
      fromListId: null,
      targetLists: [],
      selectedTargetId: null,
      canUnassign: false,
      loading: false,
      message: ''
    });
  };

  const handleMoveCourse = async () => {
    // 如果没有选择目标，显示提示
    if (!moveModal.selectedTargetId) {
      setMoveModal(prev => ({ ...prev, message: '请选择目标列表' }));
      return;
    }
    
    setMoveModal(prev => ({ ...prev, loading: true, message: '' }));
    
    try {
      // 如果选择的是"取消分配"，将to_list_id设为null
      const toListId = moveModal.selectedTargetId === 'unassign' ? null : moveModal.selectedTargetId;
      
      const res = await axios.post('/api/student/courses/move', {
        source_uuid: moveModal.course.source_uuid,
        to_list_id: toListId, // null表示取消分配
        channel: activeTab === 'major' ? 0 : 1
      });
      
      if (res.data.success) {
        // 关闭模态框并刷新数据
        closeMoveModal();
        await fetchProgress();
        // 显示成功提示
        const successToast = document.createElement('div');
        const actionText = moveModal.selectedTargetId === 'unassign' ? '取消分配' : '移动';
        successToast.textContent = `课程${actionText}成功！`;
        successToast.style.cssText = 'position:fixed;top:20px;right:20px;background:#28a745;color:white;padding:10px 20px;border-radius:4px;z-index:9999;';
        document.body.appendChild(successToast);
        setTimeout(() => successToast.remove(), 2000);
      } else {
        setMoveModal(prev => ({
          ...prev,
          loading: false,
          message: res.data.message || '操作失败'
        }));
      }
    } catch (err) {
      setMoveModal(prev => ({
        ...prev,
        loading: false,
        message: '操作失败: ' + (err.response?.data?.message || err.message)
      }));
    }
  };

  // 打开课程列表选课模态框
  const openCourseListModal = async (courseList, channel) => {
    if (courseList.is_dissertation) return;
    if (!hasFilters(courseList.filters)) {
      showModal('提示', '该课程列表无筛选条件，请在课程列表页面选课', () => setModal(m => ({ ...m, isOpen: false })), false);
      return;
    }
    
    setCourseListModal({
      isOpen: true,
      courseList: courseList,
      channel: channel,
      filters: courseList.filters || {},
      matchingCourses: [],
      loading: true
    });
    
    // 获取本学期课程并筛选（使用后端API）
    try {
      const filters = courseList.filters || {};
      const params = {
        semester: selectedSemester,
        per_page: 0,
        course_id: filters.course_id,
        department_code: filters.dept,
        course_type: filters.course_type,
        teachers: filters.teachers,
      };
      const res = await axios.get('/api/courses', { params });
      
      setCourseListModal(prev => ({
        ...prev,
        matchingCourses: res.data.courses || [],
        loading: false
      }));
    } catch (err) {
      console.error('获取课程失败', err);
      setCourseListModal(prev => ({ ...prev, loading: false }));
    }
  };

  const closeCourseListModal = () => {
    setCourseListModal({
      isOpen: false,
      courseList: null,
      channel: 0,
      filters: {},
      matchingCourses: [],
      loading: false
    });
    setModalConflicts(new Set());
  };

  /**
   * 检查课程是否已选（同课号+同学院编号）
   */
  const isAlreadySelected = (course) => {
    return allSemesterSelectedCourses.some(
      selected => selected.course_id === course.course_id && 
                  selected.department_code === course.department_code
    );
  };

  // 当模态框中的课程列表变化时，计算冲突
  useEffect(() => {
    const newConflicts = new Set();
    if (selectedCoursesDetails.length > 0 && courseListModal.matchingCourses.length > 0) {
      courseListModal.matchingCourses.forEach(course => {
        if (selectedCourseUuids.has(course.uuid)) return;
        for (const selected of selectedCoursesDetails) {
          if (checkTimeConflict(course, selected)) {
            newConflicts.add(course.uuid);
            break;
          }
        }
      });
    }
    setModalConflicts(newConflicts);
  }, [courseListModal.matchingCourses, selectedCoursesDetails, selectedCourseUuids]);

  const handleSelectFromModal = async (courseUuid) => {
    try {
      await axios.post('/api/student/selected', {
        semester: selectedSemester,
        course_uuid: courseUuid,
        channel: courseListModal.channel
      });
      // 刷新已选课程列表（不关闭模态框）
      await fetchSelectedCourses();
      // 刷新培养方案进度
      fetchProgress();
      // 显示成功提示（使用临时提示而非模态框）
      const successToast = document.createElement('div');
      successToast.textContent = '选课成功！';
      successToast.style.cssText = 'position:fixed;top:20px;right:20px;background:#28a745;color:white;padding:10px 20px;border-radius:4px;z-index:9999;';
      document.body.appendChild(successToast);
      setTimeout(() => successToast.remove(), 2000);
    } catch (error) {
      showModal('错误', '选课失败: ' + (error.response?.data?.message || error.message), () => setModal(m => ({ ...m, isOpen: false })), false);
    }
  };

  const renderCourseList = (item, depth = 0) => {
    const isQualified = item.qualified;
    const showDesc = expandedDescriptions.has(item.id);
    
    return (
      <div key={item.id} style={{
        marginLeft: depth * 20,
        padding: '10px 15px',
        marginBottom: '8px',
        backgroundColor: isQualified ? '#e8f5e9' : '#fff3e0',
        borderLeft: `4px solid ${isQualified ? '#28a745' : '#ff9800'}`,
        borderRadius: '4px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px' }}>📚</span>
            <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{item.name}</span>
            {item.is_dissertation && (
              <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#dc3545', color: 'white', borderRadius: '3px' }}>
                毕业论文
              </span>
            )}
            {item.is_repeatable && (
              <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#17a2b8', color: 'white', borderRadius: '3px' }}>
                可重复
              </span>
            )}
            {!item.is_dissertation && !hasFilters(item.filters) && (
              <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#6c757d', color: 'white', borderRadius: '3px' }}>
                任选
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!item.is_dissertation && hasFilters(item.filters) && (
              <button
                onClick={(e) => { e.stopPropagation(); openCourseListModal(item, activeTab === 'major' ? 0 : 1); }}
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  border: '1px solid #28a745',
                  backgroundColor: '#28a745',
                  color: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                快捷选课
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); toggleDescription(item.id); }}
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                border: '1px solid #0067c0',
                backgroundColor: showDesc ? '#0067c0' : 'transparent',
                color: showDesc ? 'white' : '#0067c0',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              {showDesc ? '隐藏说明' : '规则说明'}
            </button>
            <span style={{
              fontSize: '12px',
              padding: '2px 8px',
              borderRadius: '12px',
              backgroundColor: isQualified ? '#28a745' : '#ff9800',
              color: 'white'
            }}>
              {isQualified ? '✓ 合格' : '进行中'}
            </span>
          </div>
        </div>
        
        <div style={{ marginTop: '8px', fontSize: '13px', color: '#666' }}>
          {item.credits > 0 && <span>{item.credits.toFixed(1)} 学分</span>}
          {item.course_count > 0 && <span style={{ marginLeft: '15px' }}>{item.course_count} 门</span>}
        </div>

        {showDesc && (
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>合格要求：</div>
            <div style={{ fontSize: '12px', color: '#555', whiteSpace: 'pre-wrap' }}>
              {getCourseListRulesDescription(item.qualification_rules, allCourses)}
            </div>
          </div>
        )}


        {item.courses && item.courses.length > 0 && (
          <div style={{ marginTop: '10px', padding: '8px', backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: '4px' }}>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>匹配课程：</div>
            {item.courses.map((course, idx) => (
              <div key={idx} style={{ fontSize: '13px', padding: '3px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{course.course_name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ color: '#666' }}>{course.credits}学分</span>
                  {course.has_grade ? (
                    <span style={{ color: '#28a745', fontSize: '12px' }}>{course.score}</span>
                  ) : (
                    <span style={{ color: '#ff9800', fontSize: '12px' }}>进行中</span>
                  )}
                  {/* 移动按钮 - 只在不可重复列表显示 */}
                  {!item.is_repeatable && !item.is_dissertation && course.source_uuid && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openMoveModal(course, item.id);
                      }}
                      style={{
                        fontSize: '11px',
                        padding: '2px 6px',
                        border: '1px solid #6c757d',
                        backgroundColor: 'transparent',
                        color: '#6c757d',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                      title="移动到其他列表"
                    >
                      移动
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderNode = (node, depth = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const showDesc = expandedDescriptions.has(node.id);
    
    return (
      <div key={node.id}>
        <div 
          onClick={() => hasChildren && toggleNode(node.id)}
          style={{
            marginLeft: depth * 20,
            padding: '12px 15px',
            marginBottom: '8px',
            backgroundColor: node.qualified ? '#e8f5e9' : '#fff3e0',
            borderLeft: `4px solid ${node.qualified ? '#28a745' : '#ff9800'}`,
            borderRadius: '4px',
            cursor: hasChildren ? 'pointer' : 'default'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {hasChildren && (
                <span style={{ 
                  fontSize: '12px',
                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s'
                }}>
                  ▶
                </span>
              )}
              <span style={{ fontSize: '12px' }}>📁</span>
              <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{node.name}</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleDescription(node.id); }}
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    border: '1px solid #0067c0',
                    backgroundColor: showDesc ? '#0067c0' : 'transparent',
                    color: showDesc ? 'white' : '#0067c0',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  {showDesc ? '隐藏说明' : '规则说明'}
                </button>
                <div>
                  <div style={{ 
                    fontSize: '14px', 
                    fontWeight: 'bold',
                    color: node.qualified ? '#28a745' : '#ff9800'
                  }}>
                    {node.credits.toFixed(1)} 学分 / {node.course_count} 门
                  </div>
                  <div style={{ fontSize: '11px', color: '#666' }}>
                    {node.qualified ? '✓ 合格' : '未完成'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {showDesc && (
          <div style={{ 
            marginLeft: depth * 20,
            padding: '10px 15px',
            marginBottom: '8px',
            backgroundColor: 'rgba(0,0,0,0.05)', 
            borderRadius: '4px',
            marginTop: '-4px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>合格要求：</div>
            <div style={{ fontSize: '12px', color: '#555', whiteSpace: 'pre-wrap' }}>
              {getNodeRulesDescription(node.qualification_rules, allNodes)}
            </div>
          </div>
        )}

        {isExpanded && node.children && (
          <div>
            {node.children.map(child => 
              child.type === 'course_list' 
                ? renderCourseList(child, depth + 1)
                : renderNode(child, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  const renderCategory = (category) => (
    <div key={category.id} style={{ marginBottom: '25px' }}>
      <div style={{
        padding: '15px',
        backgroundColor: category.qualified ? '#d4edda' : '#f8f9fa',
        borderRadius: '8px',
        marginBottom: '15px',
        borderLeft: `5px solid ${category.qualified ? '#28a745' : '#dc3545'}`
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0, fontSize: '18px' }}>{category.name}</h4>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
              {category.credits.toFixed(1)} 学分 / {category.course_count} 门
            </div>
            <div style={{ 
              fontSize: '12px', 
              color: category.qualified ? '#28a745' : '#dc3545',
              fontWeight: 'bold'
            }}>
              {category.qualified ? '✓ 已完成' : '进行中'}
            </div>
          </div>
        </div>
      </div>
      
      <div>
        {category.nodes?.map(node => renderNode(node, 0))}
      </div>
    </div>
  );

  const renderUnassignedCourses = (unassignedCourses) => {
    if (!unassignedCourses || unassignedCourses.length === 0) return null;
    
    return (
      <div style={{ marginTop: '30px' }}>
        <div style={{
          padding: '15px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          marginBottom: '15px',
          borderLeft: '5px solid #6c757d'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0, fontSize: '16px', color: '#495057' }}>
              📋 未分配课程
            </h4>
            <span style={{ fontSize: '14px', color: '#6c757d' }}>
              {unassignedCourses.length} 门 / {unassignedCourses.reduce((sum, c) => sum + (c.credits || 0), 0).toFixed(1)} 学分
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#868e96', marginTop: '5px' }}>
            这些课程不属于任何课程列表，您可以将其移动到其他列表
          </div>
        </div>
        
        <div style={{ 
          padding: '10px', 
          backgroundColor: 'rgba(0,0,0,0.02)', 
          borderRadius: '8px',
          border: '1px dashed #dee2e6'
        }}>
          {unassignedCourses.map((course, idx) => (
            <div key={idx} style={{ 
              fontSize: '13px', 
              padding: '8px 12px', 
              marginBottom: '6px',
              backgroundColor: 'white',
              borderRadius: '4px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              border: '1px solid #e9ecef'
            }}>
              <div>
                <span style={{ fontWeight: 'bold' }}>{course.course_name}</span>
                <span style={{ color: '#868e96', marginLeft: '10px' }}>{course.course_id}</span>
                {course.source_type === 'exchange_course' && (
                  <span style={{ 
                    fontSize: '10px', 
                    padding: '1px 6px', 
                    backgroundColor: '#17a2b8', 
                    color: 'white', 
                    borderRadius: '3px',
                    marginLeft: '8px'
                  }}>
                    交换课程
                  </span>
                )}
                {course.source_type === 'dissertation' && (
                  <span style={{ 
                    fontSize: '10px', 
                    padding: '1px 6px', 
                    backgroundColor: '#dc3545', 
                    color: 'white', 
                    borderRadius: '3px',
                    marginLeft: '8px'
                  }}>
                    毕业论文
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: '#666' }}>{course.credits}学分</span>
                {course.has_grade ? (
                  <span style={{ color: '#28a745', fontSize: '12px' }}>{course.score}</span>
                ) : (
                  <span style={{ color: '#ff9800', fontSize: '12px' }}>进行中</span>
                )}
                {/* 分配按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openMoveModal(course, null);
                  }}
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    border: '1px solid #28a745',
                    backgroundColor: '#28a745',
                    color: 'white',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                  title="分配课程"
                >
                  分配
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderProgram = (programData) => {
    if (!programData) {
      return (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
          未分配培养方案
        </div>
      );
    }

    const allQualified = programData.is_qualified;

    return (
      <div>
        <div style={{
          padding: '20px',
          backgroundColor: allQualified ? '#d4edda' : '#fff3cd',
          borderRadius: '8px',
          marginBottom: '20px',
          textAlign: 'center'
        }}>
          <h3 style={{ margin: '0 0 10px 0' }}>
            {allQualified ? '🎉 恭喜！培养方案已完成' : '⏳ 培养方案进行中'}
          </h3>
          <div style={{ fontSize: '16px' }}>
            总计：<strong>{programData.total_credits?.toFixed(1)}</strong> 学分 / 
            <strong>{programData.total_courses}</strong> 门
          </div>
        </div>

        {programData.categories?.map(category => renderCategory(category))}
        
        {/* 未分配课程区域 */}
        {renderUnassignedCourses(programData.unassigned_courses)}
      </div>
    );
  };

  if (loading) return <div className="card">加载中...</div>;
  if (error) return <div className="card" style={{ color: '#dc3545' }}>错误: {error}</div>;

  const hasMajor = !!progressData.major;
  const hasMinor = !!progressData.minor;

  return (
    <div>
      <Modal 
        isOpen={modal.isOpen} 
        title={modal.title} 
        onConfirm={modal.onConfirm} 
        onCancel={() => setModal(m => ({ ...m, isOpen: false }))}
        showCancel={modal.showCancel}
      >
        {modal.content}
      </Modal>

      {/* 标题栏 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h3 style={{ margin: 0 }}>培养方案完成情况</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-secondary btn-sm" onClick={expandAll}>展开全部</button>
            <button className="btn btn-secondary btn-sm" onClick={collapseAll}>收起全部</button>
            <button className="btn btn-primary btn-sm" onClick={recalculateProgress} disabled={loading}>
              重新计算
            </button>
          </div>
        </div>
      </div>

      {/* Tab切换 */}
      {(hasMajor || hasMinor) && (
        <div style={{ display: 'flex', borderBottom: '2px solid #e0e0e0', marginBottom: '20px' }}>
          {hasMajor && (
            <button
              onClick={() => setActiveTab('major')}
              style={{
                padding: '12px 24px',
                border: 'none',
                backgroundColor: 'transparent',
                borderBottom: activeTab === 'major' ? '3px solid #0067c0' : 'none',
                color: activeTab === 'major' ? '#0067c0' : '#666',
                fontWeight: activeTab === 'major' ? 'bold' : 'normal',
                cursor: 'pointer',
                fontSize: '15px'
              }}
            >
              主修方案
              {progressData.major?.is_qualified && ' ✓'}
            </button>
          )}
          {hasMinor && (
            <button
              onClick={() => setActiveTab('minor')}
              style={{
                padding: '12px 24px',
                border: 'none',
                backgroundColor: 'transparent',
                borderBottom: activeTab === 'minor' ? '3px solid #0067c0' : 'none',
                color: activeTab === 'minor' ? '#0067c0' : '#666',
                fontWeight: activeTab === 'minor' ? 'bold' : 'normal',
                cursor: 'pointer',
                fontSize: '15px'
              }}
            >
              辅修/双学位（双专业）方案
              {progressData.minor?.is_qualified && ' ✓'}
            </button>
          )}
        </div>
      )}

      {/* 内容区域 */}
      <div className="card">
        {activeTab === 'major' && renderProgram(progressData.major)}
        {activeTab === 'minor' && renderProgram(progressData.minor)}
      </div>

      {/* 图例 */}
      <div className="card" style={{ marginTop: '20px' }}>
        <h4 style={{ margin: '0 0 15px 0', fontSize: '14px' }}>图例说明</h4>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '13px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '20px', height: '20px', backgroundColor: '#e8f5e9', borderLeft: '3px solid #28a745' }}></div>
            <span>已完成</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '20px', height: '20px', backgroundColor: '#fff3e0', borderLeft: '3px solid #ff9800' }}></div>
            <span>进行中</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📁</span>
            <span>节点（可聚合子项）</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📚</span>
            <span>课程列表</span>
          </div>
        </div>
      </div>

      {/* 课程列表选课模态框 */}
      {courseListModal.isOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            width: '90%',
            maxWidth: '1000px',
            maxHeight: '80vh',
            overflow: 'auto',
            padding: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>
                快捷选课 - {courseListModal.courseList?.name}
                <span style={{ fontSize: '14px', color: '#666', marginLeft: '10px' }}>
                  ({courseListModal.channel === 0 ? '主修' : '辅双'}通道)
                </span>
              </h3>
              <button onClick={closeCourseListModal} style={{ fontSize: '20px', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
              <div style={{ fontSize: '13px', color: '#666' }}>
                <strong>筛选条件：</strong>{getFilterDescription(courseListModal.filters, allCourses)}
              </div>
              <div style={{ fontSize: '13px', color: '#666', marginTop: '5px' }}>
                <strong>合格规则：</strong>{getCourseListRulesDescription(courseListModal.courseList?.qualification_rules, allCourses)}
              </div>
            </div>

            {courseListModal.loading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>加载中...</div>
            ) : courseListModal.matchingCourses.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                本学期没有满足筛选条件的课程
              </div>
            ) : (
              <div className="table-container" style={{ maxHeight: '400px', overflow: 'auto' }}>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>课程号</th>
                      <th>班号</th>
                      <th>课程名称</th>
                      <th>类型</th>
                      <th>学分</th>
                      <th>开课院系</th>
                      <th>教师</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courseListModal.matchingCourses.map(course => (
                      <tr key={course.uuid} className={modalConflicts.has(course.uuid) ? 'conflict-row' : ''}>
                        <td>{course.course_id}</td>
                        <td>{course.class_number}</td>
                        <td>{course.course_name}</td>
                        <td>{course.course_type}</td>
                        <td>{course.credits}</td>
                        <td>{DEPARTMENT_CODE_MAP[course.department_code] || course.department_code}</td>
                        <td>{course.teachers?.join(', ')}</td>
                        <td>
                          {selectedCourseUuids.has(course.uuid) ? (
                            transcriptCourseIds.has(course.course_id) ? (
                              <span style={{ color: '#666', fontSize: '12px', padding: '4px 8px' }}>已有成绩</span>
                            ) : (
                              <span style={{ color: '#28a745', fontSize: '12px', padding: '4px 8px' }}>已选</span>
                            )
                          ) : isAlreadySelected(course) ? (
                            <span style={{ color: '#666', fontSize: '12px', padding: '4px 8px' }}>已选同名课程</span>
                          ) : (
                            <button
                              className={`btn btn-sm ${modalConflicts.has(course.uuid) ? 'btn-warning' : courseListModal.channel === 0 ? 'btn-primary' : 'btn-secondary'}`}
                              onClick={() => handleSelectFromModal(course.uuid)}
                              title={modalConflicts.has(course.uuid) ? "时间冲突" : courseListModal.channel === 0 ? "主修选课" : "辅双选课"}
                            >
                              {modalConflicts.has(course.uuid) 
                                ? (courseListModal.channel === 0 ? "冲突（主）" : "冲突（双）")
                                : (courseListModal.channel === 0 ? "主修" : "辅双")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}


            <div style={{ marginTop: '15px', textAlign: 'right' }}>
              <button className="btn btn-secondary" onClick={closeCourseListModal}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 课程移动模态框 */}
      {moveModal.isOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            width: '90%',
            maxWidth: '500px',
            maxHeight: '80vh',
            overflow: 'auto',
            padding: '20px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>移动课程</h3>
              <button onClick={closeMoveModal} style={{ fontSize: '20px', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
              <div style={{ fontSize: '14px' }}>
                <strong>课程：</strong>{moveModal.course?.course_name}
              </div>
              <div style={{ fontSize: '13px', color: '#666', marginTop: '5px' }}>
                <strong>课号：</strong>{moveModal.course?.course_id} | <strong>学分：</strong>{moveModal.course?.credits}
              </div>
            </div>

            {moveModal.loading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>加载中...</div>
            ) : (
              <div>
                <div style={{ fontSize: '13px', marginBottom: '10px', color: '#333' }}>
                  选择目标：
                </div>
                <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                  {/* 取消分配选项 */}
                  {moveModal.canUnassign && (
                    <div
                      onClick={() => setMoveModal(prev => ({ ...prev, selectedTargetId: 'unassign' }))}
                      style={{
                        padding: '12px',
                        marginBottom: '8px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        backgroundColor: moveModal.selectedTargetId === 'unassign' ? '#ffebee' : 'white',
                        borderColor: moveModal.selectedTargetId === 'unassign' ? '#dc3545' : '#ddd'
                      }}
                    >
                      <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#dc3545' }}>
                        🚫 取消分配（移至未分配区域）
                      </div>
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                        课程将不再属于任何课程列表，可在下方未分配课程区域查看
                      </div>
                    </div>
                  )}
                  
                  {/* 目标列表 */}
                  {moveModal.targetLists.length === 0 && !moveModal.canUnassign ? (
                    <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
                      没有可移动到的目标列表
                    </div>
                  ) : (
                    moveModal.targetLists.map(list => (
                      <div
                        key={list.id}
                        onClick={() => setMoveModal(prev => ({ ...prev, selectedTargetId: list.id }))}
                        style={{
                          padding: '12px',
                          marginBottom: '8px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          backgroundColor: moveModal.selectedTargetId === list.id ? '#e3f2fd' : 'white',
                          borderColor: moveModal.selectedTargetId === list.id ? '#0067c0' : '#ddd'
                        }}
                      >
                        <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
                          {list.full_path || list.name}
                          {list.is_repeatable && (
                            <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#17a2b8', color: 'white', borderRadius: '3px', marginLeft: '8px' }}>
                              可重复
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                          {list.credits > 0 && <span>{list.credits} 学分</span>}
                          {list.course_count > 0 && <span style={{ marginLeft: '10px' }}>{list.course_count} 门</span>}
                          {list.max_courses > 0 && <span style={{ marginLeft: '10px' }}>最多{list.max_courses}门</span>}
                        </div>
                        {list.filter_summary && (
                          <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                            筛选：{list.filter_summary}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {moveModal.message && !moveModal.loading && (
              <div style={{ color: '#dc3545', fontSize: '13px', marginTop: '10px', textAlign: 'center' }}>
                {moveModal.message}
              </div>
            )}

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="btn btn-secondary" onClick={closeMoveModal}>取消</button>
              <button 
                className="btn btn-primary" 
                onClick={handleMoveCourse}
                disabled={!moveModal.selectedTargetId || moveModal.loading}
              >
                {moveModal.loading ? '处理中...' : (moveModal.selectedTargetId === 'unassign' ? '确认取消分配' : '确认移动')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentProgress;