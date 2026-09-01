import { coursesHaveClassConflict } from './utils/scheduleConflicts';

// =============== 课程相关常量及工具 ==================

export const DEPARTMENT_CODE_MAP = {
    "00001": "数学科学学院",
    "00003": "力学与工程科学学院",
    "00004": "物理学院",
    "00010": "化学与分子工程学院",
    "00011": "生命科学学院",
    "00012": "地球与空间科学学院",
    "00016": "心理与认知科学学院",
    "00017": "软件与微电子学院",
    "00018": "新闻与传播学院",
    "00020": "中国语言文学系",
    "00021": "历史学系",
    "00022": "考古文博学院",
    "00023": "哲学系",
    "00024": "国际关系学院",
    "00025": "经济学院",
    "00028": "光华管理学院",
    "00029": "法学院",
    "00030": "信息管理系",
    "00031": "社会学系",
    "00032": "政府管理学院",
    "00038": "英语语言文学系",
    "00039": "外国语学院",
    "00040": "马克思主义学院",
    "00041": "体育教研部",
    "00043": "艺术学院",
    "00044": "对外汉语教育学院",
    "00046": "元培学院",
    "00047": "深圳研究生院",
    "00048": "信息科学技术学院",
    "00062": "国家发展研究院",
    "00067": "教育学院",
    "00068": "人口研究所",
    "00084": "前沿交叉学科研究院",
    "00086": "工学院",
    "00100": "集成电路学院",
    "00101": "计算机学院",
    "00106": "智能学院",
    "00107": "电子学院",
    "00126": "城市与环境学院",
    "00127": "环境科学与工程学院",
    "00187": "中国社会科学调查中心",
    "00195": "建筑与景观设计学院",
    "00201": "汇丰商学院",
    "00206": "新媒体研究院",
    "00208": "燕京学堂",
    "00211": "现代农学院",
    "00217": "南南合作与发展学院",
    "00221": "习近平新时代中国特色社会主义思想研究院",
    "00225": "人工智能研究院",
    "00232": "材料科学与工程学院",
    "00233": "未来技术学院",
    "00240": "先进制造与机器人学院",
    "00607": "学生工作部人民武装部",
    "00612": "教务部",
    "00614": "研究生院",
    "00651": "中国共产主义青年团北京大学委员会",
    "00671": "创新创业学院",
    "10180": "医学部教学办",
    "00610": "国际合作部",
    "00192":"歌剧研究院",
    "00199":"产业技术研究院"
};

export const WEEK_DAYS = {
    1: "周一",
    2: "周二",
    3: "周三",
    4: "周四",
    5: "周五",
    6: "周六",
    7: "周日"
};

export const WEEK_TYPES = {
    0: "每周",
    1: "单周",
    2: "双周"
};

/**
 * 格式化 class_times 为合并显示（上课时间、地点、周次）
 * 统一格式：周次 星期 节次 地点
 * @param {Array} classTimes 上课时段数组
 * @returns {string} 每行一个时段的格式化字符串
 */
export function formatClassTimes(classTimes) {
    if (!classTimes || !Array.isArray(classTimes) || classTimes.length === 0) {
        return '';
    }
    
    return classTimes.map(time => {
        const day = WEEK_DAYS[time.day] || `周${time.day}`;
        const period = `${time.start_period}-${time.end_period}节`;
        const location = time.location || '';
        
        // 周次信息
        let weeks = time.week_range || '';
        let weekTypeStr = WEEK_TYPES[time.week_type] || '每周';
        
        if (weeks) {
            weeks = `${weeks}周 ${weekTypeStr}`;
        }
        
        // 格式：周次 星期 节次 地点
        return `${weeks} ${day} ${period} ${location}`.trim();
    }).join('\n');
}

export const parseWeeksFromRange = (weeksRange, weekType) => {
    const weeks = new Set();
    if (!weeksRange) return weeks;
    
    // Handle "1-16" or "1-8,10-16" formats
    const parts = weeksRange.split(',');
    parts.forEach(part => {
        const rangeMatch = part.match(/(\d+)-(\d+)/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = parseInt(rangeMatch[2]);
            for (let i = start; i <= end; i++) {
                if (weekType === 1 && i % 2 === 0) continue; // Odd weeks only
                if (weekType === 2 && i % 2 !== 0) continue; // Even weeks only
                weeks.add(i);
            }
        } else {
            const singleMatch = part.match(/(\d+)/);
            if (singleMatch) {
                const w = parseInt(singleMatch[1]);
                if (weekType === 1 && w % 2 === 0) return;
                if (weekType === 2 && w % 2 !== 0) return;
                weeks.add(w);
            }
        }
    });
    return weeks;
};

// 获取某个 class_time 的所有周次
export const getWeeksFromClassTime = (time) => {
    return parseWeeksFromRange(time.week_range, time.week_type);
};

// 新版冲突检测：使用每个时段自己的 week_range
export const checkTimeConflict = (course1, course2) => {
    return coursesHaveClassConflict(course1, course2);
};

// 根据学期第一周周一日期计算某周的日期
export const getWeekDate = (firstWeekMonday, weekNum, dayNum) => {
    if (!firstWeekMonday) return null;
    
    // weekNum: 周次（0, 1, 2...），0表示第0周
    // dayNum: 星期几（1-7）
    const date = new Date(firstWeekMonday);
    date.setDate(date.getDate() + (weekNum - 1) * 7 + (dayNum - 1));
    return date;
};

// 格式化日期为 YYYY-MM-DD
export const formatDate = (date) => {
    if (!date) return '';
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
};

// ==================== 成绩单工具函数 ====================

// ----------------------- 常量 -----------------------
// 等级制到绩点的映射（研究生课程），由于本科课程不计算绩点，这个只用于处理进度条长度计算
export const GRADE_TO_GPA = {
    'A+': 4.0, 'A': 4.0, 'A-': 3.7,
    'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7,
    'D+': 1.3, 'D': 1.0, 'F': 0.0
};

// 等级制颜色映射
const GRADE_COLORS = {
    'A+': 'rainbow',
    'A': '#4caf50',   // 绿色
    'A-': '#66bb6a',  // 浅绿
    'B+': '#9ccc65',  // 黄绿
    'B': '#c0ca33',   // 黄绿偏黄
    'B-': '#d4e157',  // 黄绿黄
    'C+': '#ffee58',  // 黄色
    'C': '#ffca28',   // 橙黄
    'C-': '#ffa726',  // 浅橙
    'D+': '#ff7043',  // 橙红
    'D': '#f4511e',   // 红色
    'F': '#b71c1c',   // 深红
}

// 合格制课程颜色映射
const PNP_COLORS = {
    'P': '#4caf50',   // 通过-绿
    'NP': '#b71c1c',  // 不通过-深红
    'W': '#9c27b0',   // 退课-紫色
    'I': '#9c27b0',   // 缓考-紫色
    'IP': '#9c27b0',  // 未完成-紫色
    'EX': '#2196f3'   // 免修-蓝色
};

// 若成绩解析不匹配的颜色
const MISMATCH_COLOR = '#ff8a8a';

const GRADE_ASSIGN_CREDIT = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D'];

const PNP_ASSIGN_CREDIT = ['P', 'EX'];

// score_type 中文映射
const SCORE_TYPE_MAP = {
    'Percentage': '百分制',
    'Grade': '等级制',
    'P/NP': '合格制'
};

// ------------------ 工具函数 ------------------

/**
 * 将 score_type 转换为中文显示
 * @param {string} scoreType 成绩类型（英文）
 * @returns {string} 中文显示
 */
export const getScoreTypeLabel = (scoreType) => {
    return SCORE_TYPE_MAP[scoreType] || scoreType;
};

/**
 * 计算课程绩点（接受score和scoreType）
 * @param {string|number} score 成绩
 * @param {string} scoreType 成绩类型（'Percentage', 'Grade', 'P/NP'）
 * @returns {number|null} 绩点，非百分制返回null
 */
export const getGPA = (score, scoreType) => {
    if (scoreType === 'Percentage') {
    
        const numScore = parseFloat(score);
        if (isNaN(numScore)) return null;
        
        if (numScore < 60) return 0.0;
        if (numScore >= 100) return 4.0;
        
        const gpa = 4 - 3 * Math.pow(100 - numScore, 2) / 1600;
        return Math.round(gpa * 100) / 100;
    }
    return null; // 等级制和合格制不计算绩点
};

/**
 * 计算进度条填充百分比（接受score和scoreType）
 * @param {string|number} score 成绩
 * @param {string} scoreType 成绩类型
 * @returns {number} 填充百分比（20-100）
 */
export const getFillPercent = (score, scoreType) => {
    if (scoreType === 'Grade') {
        const gpa = GRADE_TO_GPA[score];
        if (gpa === undefined) {
            // 非等级制分数可能是自选合格制课程
            if (PNP_COLORS[score]) return score === 'NP' ? 20 : 100;
            return 100;
        }
        if (gpa <= 1.0) return 20;
        return ((gpa - 1.0) / 3.0) * 80 + 20;
    }

    if (scoreType === 'Percentage') {
        const numScore = parseFloat(score);
        if (isNaN(numScore)) {
            // 非数字分数可能来自自选合格制课程
            if (PNP_COLORS[score]) return score === 'NP' ? 20 : 100;
            return 100;
        }
        if (numScore < 60) return 100;
        return ((numScore - 60) / 40) * 80 + 20;
    }

    // other types (P/NP, etc.)
    return 100;
};

/**
 * 根据成绩获取颜色（接受score和scoreType）
 * @param {string|number} score 成绩
 * @param {string} scoreType 成绩类型
 * @returns {string} 颜色值或'rainbow'
 */
export const getScoreColor = (score, scoreType) => {
    // 百分制
    if (scoreType === 'Percentage') {
        const numScore = parseFloat(score);
        if (isNaN(numScore)) {
            // 非数字分数可能来自自选合格制课程（如 score='P', score_type='Percentage'）
            // 使用 P/NP 颜色作为后备
            return PNP_COLORS[score] || MISMATCH_COLOR;
        }

        // 100分：彩虹色
        if (numScore === 100) return 'rainbow';

        // <60分：深红
        if (numScore < 60) return '#b71c1c';

        // 60-100分：线性连续映射（绿-黄-红）
        // 60分 = 红色(rgb(244, 81, 30))
        // 80分 = 黄色(rgb(255, 238, 88))
        // 100分 = 绿色(rgb(76, 175, 80))
        if (numScore <= 80) {
            // 60-80分: 红 → 黄
            const ratio = (numScore - 60) / 20;
            const r = Math.floor(244 + (255 - 244) * ratio);
            const g = Math.floor(81 + (238 - 81) * ratio);
            const b = Math.floor(30 + (88 - 30) * ratio);
            return `rgb(${r}, ${g}, ${b})`;
        } else {
            // 80-100分: 黄 → 绿
            const ratio = (numScore - 80) / 20;
            const r = Math.floor(255 - (255 - 76) * ratio);
            const g = Math.floor(238 - (238 - 175) * ratio);
            const b = Math.floor(88 - (88 - 80) * ratio);
            return `rgb(${r}, ${g}, ${b})`;
        }
    }

    if (scoreType === 'Grade') {
        return GRADE_COLORS[score] || PNP_COLORS[score] || MISMATCH_COLOR;
    }

    // 合格制等其他类型
    return PNP_COLORS[score] || MISMATCH_COLOR;
};

/**
 * 检查成绩是否参与学分计算
 * @param {string|number} score 成绩
 * @param {string} scoreType 成绩类型
 * @returns {boolean}
 */
export const isCreditCounted = (score, scoreType) => {
    // 百分制
    if (scoreType === 'Percentage') {
        const numScore = parseFloat(score);
        if (isNaN(numScore)) {
            // 非数字分数（如自选合格制的P/NP）按合格制规则判断
            return PNP_ASSIGN_CREDIT.includes(score);
        }
        if (numScore < 60) return false; // <60分不计算学分
        return true;
    }
    // 等级制
    if (scoreType === 'Grade') {
        if (GRADE_ASSIGN_CREDIT.includes(score)) return true;
        // 非等级制分数（如自选合格制的P/NP）按合格制规则判断
        return PNP_ASSIGN_CREDIT.includes(score);
    }

    return PNP_ASSIGN_CREDIT.includes(score);
};

/**
 * 计算一组成绩的GPA（仅百分制计算绩点，等级制不计算）
 * <60分：按原有学分和0.0绩点计算
 * @param {Array} transcripts 成绩单数组
 * @returns {string} GPA字符串，保留三位小数
 */
export const calculateSetGPA = (transcripts) => {
    if (!transcripts || transcripts.length === 0) return '0.000';
    
    let totalPoints = 0;
    let totalCredits = 0;
    
    transcripts.forEach(t => {
        // 你必须保证提供如下字段
        const tScore = t.score;
        const tScoreType = t.score_type;
        const tCredits = t.credits;
        const tGPA = getGPA(tScore, tScoreType);

        if (tGPA === null) return; // 非百分制及解析错误不计算绩点

        // 使用原有学分（包括<60分的课程）
        if (tCredits > 0) {
            totalPoints += tGPA * tCredits;
            totalCredits += tCredits;
        }
    });
    
    return totalCredits > 0 ? (totalPoints / totalCredits).toFixed(3) : null;
};

/**
 * 计算一组课程的总学分（排除不计学分的成绩）
 * @param {Array} transcripts 成绩单数组
 * @returns {number} 总学分
 */
export const calculateSetCredits = (transcripts) => {
    if (!transcripts || transcripts.length === 0) return 0;
    
    return transcripts.reduce((sum, t) => {
        // 你必须保证提供如下字段
        const tScore = t.score;
        const tScoreType = t.score_type;
        const tCredits = t.credits;

        if (!isCreditCounted(tScore, tScoreType)) {
            return sum;
        }
        return sum + (tCredits || 0);
    }, 0);
};



// ===================== 考试信息常量及工具函数 =====================

// 考试时段映射
const EXAM_PERIOD_MAP = {
    1: '上午',
    2: '下午',
    3: '晚上'
};

/**
 * 格式化考试信息
 * @param {Object} examInfo 考试信息对象 {date: "YYYYMMDD", period: 1/2/3, location: "..."}
 * @returns {string} 格式化后的字符串，如 "2025年12月29日 下午 二教301" 或 "无考试安排"
 */
export const formatExamInfo = (examInfo) => {
    if (!examInfo || !examInfo.date) {
        return '无考试安排';
    }
    
    const { date, period, location } = examInfo;
    
    // 格式化日期：YYYYMMDD -> YYYY年MM月DD日
    let formattedDate = '';
    if (date && date.length === 8) {
        const year = date.substring(0, 4);
        const month = date.substring(4, 6);
        const day = date.substring(6, 8);
        formattedDate = `${year}年${parseInt(month)}月${parseInt(day)}日`;
    }
    
    // 格式化时段
    const periodText = EXAM_PERIOD_MAP[period] || '';
    
    // 组合结果
    const parts = [formattedDate, periodText, location].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : '无考试安排';
};

// ===================== 培养方案规则描述函数 =====================

/**
 * 生成筛选条件的文字描述
 * @param {Object} filters - 筛选条件对象
 * @param {Array} allCourses - 所有课程列表（用于查找课程名称）
 * @param {Object} departmentCodeMap - 院系代码映射
 * @returns {string} 文字描述
 */
export const getFilterDescription = (filters, allCourses = [], departmentCodeMap = DEPARTMENT_CODE_MAP) => {
  if (!filters || Object.keys(filters).length === 0) return '全部';
  
  const parts = [];
  
  if (filters.course_id?.length > 0) {
    // 将课程号转换为课程名称
    const courseNames = filters.course_id.map(id => {
      const course = allCourses.find(c => c.course_id === id);
      return course ? `${id}(${course.course_name})` : id;
    });
    parts.push(`课号为${courseNames.join('、')}`);
  }
  
  if (filters.dept?.length > 0) {
    const deptNames = filters.dept.map(code => departmentCodeMap[code] || code);
    parts.push(`由${deptNames.join('、')}开设`);
  }
  
  if (filters.course_type?.length > 0) {
    parts.push(`属于${filters.course_type.join('、')}`);
  }
  
  if (filters.teachers?.length > 0) {
    parts.push(`由${filters.teachers.join('、')}授课`);
  }
  
  return parts.length > 0 ? parts.join('，') : '全部';
};

/**
 * 生成课程列表合格规则的文字描述
 * @param {Array} rules - 合格规则数组
 * @param {Array} allCourses - 所有课程列表
 * @param {Object} departmentCodeMap - 院系代码映射
 * @returns {string} 文字描述
 */
export const getCourseListRulesDescription = (rules, allCourses = [], departmentCodeMap = DEPARTMENT_CODE_MAP) => {
  if (!rules || rules.length === 0) return '默认合格';
  
  return rules.map((rule, index) => {
    const parts = [];
    
    // 筛选条件（课程列表规则中的进一步筛选）
    if (rule.filters && Object.keys(rule.filters).length > 0) {
      parts.push(`需要修读${getFilterDescription(rule.filters, allCourses, departmentCodeMap)}的课程`);
    }
    
    // 学分和门数要求
    const reqParts = [];
    if (rule.min_credits !== null && rule.min_credits !== undefined) {
      reqParts.push(`${rule.min_credits}学分`);
    }
    if (rule.min_courses !== null && rule.min_courses !== undefined) {
      reqParts.push(`${rule.min_courses}门课程`);
    }
    if (reqParts.length > 0) {
      parts.push(`总计达到${reqParts.join('，')}`);
    }
    
    return `${parts.length > 0 ? parts.join('，') : '默认合格'}`;
  }).join('\n');
};

/**
 * 生成节点合格规则的文字描述
 * @param {Array} rules - 合格规则数组
 * @param {Array} allNodes - 所有节点列表（包含 node 和 courselist）
 * @returns {string} 文字描述
 */
export const getNodeRulesDescription = (rules, allNodes = []) => {
  if (!rules || rules.length === 0) return '对于所有子项，要求全部合格';
  
  return rules.map((rule, index) => {
    const parts = [];
    
    // 指定子节点（新格式 subnodes）
    const subnodes = rule.subnodes || [];
    // 指定子列表（新格式 sublists）
    const sublists = rule.sublists || [];
    if (subnodes.length > 0 || sublists.length > 0) {
      let nodelistNames = [];
      if (subnodes.length > 0) {
        const nodeNames = subnodes.map(nodeId => {
          const node = allNodes.find(n => n.id === nodeId && n.type === 'node');
          return node ? node.name : `节点${nodeId}`;
        });
        nodelistNames = nodeNames;
      }
      if (sublists.length > 0) {
        const listNames = sublists.map(listId => {
          const list = allNodes.find(n => n.id === listId && n.type === 'courselist');
          return list ? list.name : `列表${listId}`;
        });
        nodelistNames = [...nodelistNames, ...listNames];
      }
      parts.push(`对于${nodelistNames.join('、')}`);
    } else {
      parts.push('对于所有子项');
    }
    
    // 节点筛选条件
    const filterParts = [];
    if (rule.node_filter?.min_credits > 0) {
      filterParts.push(`学分≥${rule.node_filter.min_credits}`);
    }
    if (rule.node_filter?.min_courses > 0) {
      filterParts.push(`门数≥${rule.node_filter.min_courses}`);
    }
    if (rule.node_filter?.require_qualified) {
      filterParts.push('已合格');
    }
    if (filterParts.length > 0) {
      parts.push(`选出其中${filterParts.join('，')}的子项`);
    }
    
    // 求和要求
    const sumParts = [];
    if (rule.sum_requirements?.min_credits !== null && rule.sum_requirements?.min_credits !== undefined && rule.sum_requirements?.min_credits > 0) {
      sumParts.push(`总学分≥${rule.sum_requirements.min_credits}`);
    }
    if (rule.sum_requirements?.min_courses !== null && rule.sum_requirements?.min_courses !== undefined && rule.sum_requirements?.min_courses > 0) {
      sumParts.push(`总门数≥${rule.sum_requirements.min_courses}`);
    }
    if (rule.sum_requirements?.qualified_count !== null && rule.sum_requirements?.qualified_count !== undefined) {
      sumParts.push(`至少${rule.sum_requirements.qualified_count}项合格`);
    } else if (rule.sum_requirements?.qualified_count === null) {
      sumParts.push('全部合格');
    }
    if (sumParts.length > 0) {
      parts.push(`要求${sumParts.join('，')}`);
    }
    
    return `${parts.length > 0 ? parts.join('，') : '要求全部合格'}`;
  }).join('\n');
};
