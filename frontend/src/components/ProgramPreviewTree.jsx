import React, { useMemo, useState } from 'react';

function requirementText(item) {
  const parts = [];
  if (item.requirement_raw) parts.push(item.requirement_raw);
  if (item.requirement_type && (item.requirement_min !== null || item.requirement_max !== null)) {
    const labelMap = { credits: '学分', courses: '门数', hours: '学时' };
    const label = labelMap[item.requirement_type] || item.requirement_type;
    if (item.requirement_min !== null && item.requirement_max !== null && item.requirement_min !== item.requirement_max) {
      parts.push(`${label} ${item.requirement_min}-${item.requirement_max}`);
    } else {
      const value = item.requirement_min ?? item.requirement_max;
      parts.push(`${label} ${value}`);
    }
  }
  if (item.qualification_rules?.length) {
    parts.push(`合格规则 ${item.qualification_rules.length} 条`);
  }
  return parts.length ? parts.join(' · ') : '无明确要求';
}

function JsonBlock({ value }) {
  if (value === null || value === undefined) return null;
  const isEmptyObject = typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
  const isEmptyArray = Array.isArray(value) && value.length === 0;
  if (isEmptyObject || isEmptyArray || value === '') return null;
  return (
    <pre style={{
      margin: '8px 0 0',
      padding: '8px',
      backgroundColor: 'rgba(0,0,0,0.04)',
      borderRadius: '4px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      fontSize: '12px'
    }}>
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function CourseOptions({ options }) {
  if (!options?.length) return null;
  return (
    <div style={{ marginTop: '10px', padding: '8px', backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: '4px' }}>
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '5px' }}>可计入课程：</div>
      {options.map(option => (
        <div key={option.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '4px 0', fontSize: '13px' }}>
          <span>
            <strong>{option.course_id || '未填课号'}</strong>
            {option.course_name ? ` - ${option.course_name}` : ''}
          </span>
          <span style={{ color: '#666', flexShrink: 0 }}>
            {option.credits ?? '-'} 学分
            {option.semester ? ` · ${option.semester}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function CourseListNode({ item, depth }) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div style={{
      marginLeft: depth * 20,
      padding: '10px 15px',
      marginBottom: '8px',
      backgroundColor: '#f8f9fa',
      borderLeft: '4px solid #28a745',
      borderRadius: '4px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '12px' }}>📚</span>
          <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{item.name}</span>
          {item.is_dissertation && <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#dc3545', color: 'white', borderRadius: '3px' }}>毕业论文</span>}
          {item.is_repeatable && <span style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#17a2b8', color: 'white', borderRadius: '3px' }}>可重复</span>}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowDetail(v => !v)}>
          {showDetail ? '隐藏说明' : '规则说明'}
        </button>
      </div>
      <div style={{ marginTop: '8px', fontSize: '13px', color: '#666' }}>
        {requirementText(item)}
        {item.course_options?.length ? ` · ${item.course_options.length} 门课程` : ''}
      </div>
      {showDetail && (
        <div style={{ marginTop: '10px' }}>
          <JsonBlock value={item.filters} />
          <JsonBlock value={item.qualification_rules} />
          <JsonBlock value={item.selection_rule} />
        </div>
      )}
      <CourseOptions options={item.course_options} />
    </div>
  );
}

function TreeNode({ node, depth = 0 }) {
  const [expanded, setExpanded] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const children = [...(node.course_lists || []), ...(node.children || [])];
  const hasChildren = children.length > 0;

  return (
    <div>
      <div
        onClick={() => hasChildren && setExpanded(v => !v)}
        style={{
          marginLeft: depth * 20,
          padding: '12px 15px',
          marginBottom: '8px',
          backgroundColor: '#fff3e0',
          borderLeft: '4px solid #ff9800',
          borderRadius: '4px',
          cursor: hasChildren ? 'pointer' : 'default'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {hasChildren && <span style={{ fontSize: '12px', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▶</span>}
            <span style={{ fontSize: '12px' }}>📁</span>
            <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{node.name}</span>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setShowDetail(v => !v); }}>
            {showDetail ? '隐藏说明' : '规则说明'}
          </button>
        </div>
        <div style={{ marginTop: '6px', fontSize: '13px', color: '#666' }}>{requirementText(node)}</div>
      </div>
      {showDetail && (
        <div style={{ marginLeft: depth * 20, padding: '10px 15px', marginTop: '-4px', marginBottom: '8px', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
          <JsonBlock value={node.rules_raw} />
          <JsonBlock value={node.qualification_rules} />
          <JsonBlock value={node.remark} />
        </div>
      )}
      {expanded && children.map(child => (
        child.type === 'node'
          ? <TreeNode key={`node-${child.id}`} node={child} depth={depth + 1} />
          : <CourseListNode key={`list-${child.id}`} item={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function OwnerLabel({ item }) {
  return <span>{item.owner_type}{item.owner_id ? ` #${item.owner_id}` : ''}</span>;
}

function ProgramPreviewTree({ program }) {
  const totalOptions = useMemo(() => {
    let count = 0;
    program?.categories?.forEach(category => {
      const walk = (nodes) => nodes?.forEach(node => {
        node.course_lists?.forEach(list => { count += list.course_options?.length || 0; });
        walk(node.children);
      });
      walk(category.nodes);
    });
    return count;
  }, [program]);

  if (!program) return <div style={{ padding: '30px', textAlign: 'center', color: '#666' }}>暂无预览数据</div>;

  return (
    <div>
      <div style={{ padding: '18px', backgroundColor: '#fff3cd', borderRadius: '8px', marginBottom: '20px', textAlign: 'center' }}>
        <h3 style={{ margin: '0 0 10px 0' }}>{program.name}</h3>
        <div style={{ fontSize: '15px' }}>
          {program.dept || '未填写院系'} · {program.year || '-'}级 · {program.channel === 0 ? '主修' : '辅修/双学位（双专业）'}
        </div>
        <div style={{ marginTop: '8px', fontSize: '14px', color: '#555' }}>
          总学分：<strong>{program.total_credits ?? '-'}</strong> · 课程明细：<strong>{totalOptions}</strong> 门
        </div>
      </div>

      {program.categories?.map(category => (
        <div key={category.id} style={{ marginBottom: '25px' }}>
          <div style={{
            padding: '15px',
            backgroundColor: '#f8f9fa',
            borderRadius: '8px',
            marginBottom: '15px',
            borderLeft: '5px solid #0067c0'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '18px' }}>{category.name}</h4>
              <span style={{ fontSize: '13px', color: '#666' }}>{requirementText(category)}</span>
            </div>
          </div>
          {category.nodes?.map(node => <TreeNode key={node.id} node={node} />)}
        </div>
      ))}

      {(program.requirement_rules?.length > 0 || program.mutual_exclusion_groups?.length > 0) && (
        <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={{ padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
            <h4 style={{ margin: '0 0 10px' }}>跨节点规则</h4>
            {program.requirement_rules?.length ? program.requirement_rules.map(rule => (
              <div key={rule.id} style={{ fontSize: '13px', padding: '8px 0', borderTop: '1px solid #e5e7eb' }}>
                <div><OwnerLabel item={rule} /> · {rule.raw || '未填写原文'}</div>
                <JsonBlock value={rule.parsed} />
              </div>
            )) : <div style={{ color: '#666', fontSize: '13px' }}>暂无规则</div>}
          </div>
          <div style={{ padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
            <h4 style={{ margin: '0 0 10px' }}>互斥关系</h4>
            {program.mutual_exclusion_groups?.length ? program.mutual_exclusion_groups.map(group => (
              <div key={group.id} style={{ fontSize: '13px', padding: '8px 0', borderTop: '1px solid #e5e7eb' }}>
                <div><OwnerLabel item={group} /> · {group.raw || group.items.map(item => item.course_id).join(' / ')}</div>
              </div>
            )) : <div style={{ color: '#666', fontSize: '13px' }}>暂无互斥关系</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProgramPreviewTree;
