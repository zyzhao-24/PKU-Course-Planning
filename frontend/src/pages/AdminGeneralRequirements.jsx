import React, { useState } from 'react';
import {
  CollegeEnglishPoolManager,
  LaborEducationPoolManager,
} from './AdminCourses';


function AdminGeneralRequirements() {
  const [activeTab, setActiveTab] = useState('english');

  const tabs = [
    ['english', '大学英语'],
    ['labor', '劳动教育'],
  ];

  return (
    <div className="general-requirements">
      <div className="card general-requirements__navigation">
        <h2 className="general-requirements__title">培养方案通用规定</h2>
        <div className="general-requirements__tabs" role="tablist" aria-label="通用规定类别">
          {tabs.map(([value, label]) => (
            <button
              type="button"
              key={value}
              onClick={() => setActiveTab(value)}
              className={`general-requirements__tab${activeTab === value ? ' is-active' : ''}`}
              role="tab"
              aria-selected={activeTab === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel">
        {activeTab === 'english' && <CollegeEnglishPoolManager />}
        {activeTab === 'labor' && <LaborEducationPoolManager />}
      </div>
    </div>
  );
}

export default AdminGeneralRequirements;
