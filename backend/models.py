from database import db
from sqlalchemy.dialects.sqlite import JSON
from datetime import datetime, date

# ==================== 用户与认证模型 ====================

class User(db.Model):
    """用户表 - 学生和管理员"""
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), nullable=False, unique=True, index=True)
    password_hash = db.Column(db.String(255), nullable=True)
    role = db.Column(db.String(20), nullable=False, default='student')
    name = db.Column(db.String(100), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, nullable=True)
    
    # 培养方案关联 - 主修和辅双
    major_program_id = db.Column(db.Integer, db.ForeignKey('programs.id'), nullable=True)
    minor_program_id = db.Column(db.Integer, db.ForeignKey('programs.id'), nullable=True)
    english_level = db.Column(db.String(20), nullable=True)
    
    major_program = db.relationship('Program', foreign_keys=[major_program_id], backref='major_students')
    minor_program = db.relationship('Program', foreign_keys=[minor_program_id], backref='minor_students')

# ==================== 培养方案模型（v3.0 新设计）====================

class Program(db.Model):
    """
    培养方案 - 按通道区分（主修/辅双）
    """
    __tablename__ = 'programs'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    dept = db.Column(db.String(100))
    channel = db.Column(db.Integer, nullable=False)  # 0=主修, 1=辅双
    year = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    source_info = db.Column(JSON, default=dict)
    program_metadata = db.Column('metadata', JSON, default=dict)
    total_credits = db.Column(db.Float, nullable=True)
    raw_payload = db.Column(JSON, default=dict)
    import_warnings = db.Column(JSON, default=list)
    
    # 关系
    categories = db.relationship('MainCategory', backref='program', cascade='all, delete-orphan', order_by='MainCategory.order_index')
    requirement_rules = db.relationship('ProgramRequirementRule', backref='program', cascade='all, delete-orphan', order_by='ProgramRequirementRule.order_index')
    mutual_exclusion_groups = db.relationship('ProgramMutualExclusionGroup', backref='program', cascade='all, delete-orphan', order_by='ProgramMutualExclusionGroup.order_index')
    course_options = db.relationship('ProgramCourseOption', backref='program', cascade='all, delete-orphan', order_by='ProgramCourseOption.order_index')


class MainCategory(db.Model):
    """
    主类别 - 固定：公共基础课/专业必修/专业选修
    """
    __tablename__ = 'main_categories'
    id = db.Column(db.Integer, primary_key=True)
    program_id = db.Column(db.Integer, db.ForeignKey('programs.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    order_index = db.Column(db.Integer, default=0)
    raw = db.Column(db.Text, nullable=True)
    remark = db.Column(JSON, nullable=True)
    requirement_raw = db.Column(db.String(50), nullable=True)
    requirement_type = db.Column(db.String(20), nullable=True)
    requirement_min = db.Column(db.Float, nullable=True)
    requirement_max = db.Column(db.Float, nullable=True)
    source_excel_row = db.Column(db.Integer, nullable=True)
    
    # 关系
    nodes = db.relationship('Node', backref='main_category', cascade='all, delete-orphan', order_by='Node.order_index')


class Node(db.Model):
    """
    节点 - 树状结构，聚合子节点信息
    """
    __tablename__ = 'nodes'
    id = db.Column(db.Integer, primary_key=True)
    main_category_id = db.Column(db.Integer, db.ForeignKey('main_categories.id'), nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('nodes.id'), nullable=True)
    name = db.Column(db.String(100), nullable=False)
    order_index = db.Column(db.Integer, default=0)
    raw = db.Column(db.Text, nullable=True)
    node_kind = db.Column(db.String(30), nullable=False, default='module')
    remark = db.Column(JSON, nullable=True)
    requirement_raw = db.Column(db.String(50), nullable=True)
    requirement_type = db.Column(db.String(20), nullable=True)
    requirement_min = db.Column(db.Float, nullable=True)
    requirement_max = db.Column(db.Float, nullable=True)
    source_excel_row = db.Column(db.Integer, nullable=True)
    rules_raw = db.Column(JSON, default=list)
    
    # 合格规则（JSON数组）
    qualification_rules = db.Column(JSON, default=list)
    
    # 关系
    children = db.relationship('Node', backref=db.backref('parent', remote_side=[id]), cascade='all, delete-orphan')
    course_lists = db.relationship('CourseList', backref='node', cascade='all, delete-orphan', order_by='CourseList.order_index')


class CourseList(db.Model):
    """
    课程列表 - 唯一接触课程记录的抽象
    """
    __tablename__ = 'course_lists'
    id = db.Column(db.Integer, primary_key=True)
    node_id = db.Column(db.Integer, db.ForeignKey('nodes.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    order_index = db.Column(db.Integer, default=0)
    raw = db.Column(db.Text, nullable=True)
    remark = db.Column(JSON, nullable=True)
    course_category = db.Column(db.String(100), nullable=True)
    requirement_raw = db.Column(db.String(50), nullable=True)
    requirement_type = db.Column(db.String(20), nullable=True)
    requirement_min = db.Column(db.Float, nullable=True)
    requirement_max = db.Column(db.Float, nullable=True)
    source_excel_row = db.Column(db.Integer, nullable=True)
    selection_rule = db.Column(JSON, default=dict)
    
    # 是否为毕业论文（特殊处理）
    is_dissertation = db.Column(db.Boolean, default=False)
    
    # 筛选条件
    filters = db.Column(JSON, default=dict)
    
    # 最大匹配门数（null=不限）
    max_courses = db.Column(db.Integer, nullable=True)
    
    # 是否可重复计入其他类别
    is_repeatable = db.Column(db.Boolean, default=False)
    
    # 合格规则（JSON数组）
    qualification_rules = db.Column(JSON, default=list)
    
    # 关系
    assignments = db.relationship('CourseListAssignment', backref='course_list', cascade='all, delete-orphan')
    course_options = db.relationship('ProgramCourseOption', backref='course_list', cascade='all, delete-orphan', order_by='ProgramCourseOption.order_index')


class ProgramCourseOption(db.Model):
    """
    培养方案课程包明细 - 保存 XLS 中列出的课程，不依赖 courses_basic。
    """
    __tablename__ = 'program_course_options'

    id = db.Column(db.Integer, primary_key=True)
    program_id = db.Column(db.Integer, db.ForeignKey('programs.id'), nullable=False, index=True)
    course_list_id = db.Column(db.Integer, db.ForeignKey('course_lists.id'), nullable=False, index=True)
    course_id = db.Column(db.String(20), nullable=True, index=True)
    course_name = db.Column(db.String(200), nullable=True)
    credits = db.Column(db.Float, nullable=True)
    total_hours = db.Column(db.Float, nullable=True)
    practice_total_hours = db.Column(db.Float, nullable=True)
    semester = db.Column(db.String(50), nullable=True)
    source_excel_row = db.Column(db.Integer, nullable=True)
    raw_payload = db.Column(JSON, default=dict)
    order_index = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ProgramRequirementRule(db.Model):
    """
    培养方案要求规则 - 支持跨节点/课程列表求和等复杂规则，并保留 raw/parsed。
    owner_type/owner_id 为多态引用：program/category/node/course_list。
    """
    __tablename__ = 'program_requirement_rules'

    id = db.Column(db.Integer, primary_key=True)
    program_id = db.Column(db.Integer, db.ForeignKey('programs.id'), nullable=False, index=True)
    owner_type = db.Column(db.String(30), nullable=False)
    owner_id = db.Column(db.Integer, nullable=True, index=True)
    raw = db.Column(db.Text, nullable=False)
    parsed = db.Column(JSON, default=dict)
    target_names = db.Column(JSON, default=list)
    metric = db.Column(db.String(20), nullable=True)
    operator = db.Column(db.String(10), nullable=True)
    value = db.Column(db.Float, nullable=True)
    order_index = db.Column(db.Integer, default=0)
    source_excel_row = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ProgramMutualExclusionGroup(db.Model):
    """
    培养方案互斥组 - 默认 program 范围全局生效，owner 信息保留来源。
    """
    __tablename__ = 'program_mutual_exclusion_groups'

    id = db.Column(db.Integer, primary_key=True)
    program_id = db.Column(db.Integer, db.ForeignKey('programs.id'), nullable=False, index=True)
    owner_type = db.Column(db.String(30), nullable=False)
    owner_id = db.Column(db.Integer, nullable=True, index=True)
    raw = db.Column(db.Text, nullable=False)
    strategy = db.Column(JSON, default=dict)
    order_index = db.Column(db.Integer, default=0)
    source_excel_row = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    items = db.relationship(
        'ProgramMutualExclusionItem',
        backref='group',
        cascade='all, delete-orphan',
        order_by='ProgramMutualExclusionItem.order_index'
    )


class ProgramMutualExclusionItem(db.Model):
    """
    互斥组课程项。
    """
    __tablename__ = 'program_mutual_exclusion_items'

    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, db.ForeignKey('program_mutual_exclusion_groups.id'), nullable=False, index=True)
    course_id = db.Column(db.String(20), nullable=False, index=True)
    order_index = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class CollegeEnglishCoursePool(db.Model):
    """Global college English course pool used by user-level placement rules."""
    __tablename__ = 'college_english_course_pool'

    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.String(20), nullable=False, index=True)
    course_name = db.Column(db.String(200), nullable=False, index=True)
    module = db.Column(db.String(30), nullable=False, index=True)
    active = db.Column(db.Boolean, nullable=False, default=True)
    notes = db.Column(db.String(500), nullable=True)
    order_index = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('course_id', 'module', name='uq_college_english_course_module'),
    )


class LaborEducationCoursePool(db.Model):
    """劳动教育课程目录。

    目录课程保留原课程体系，同时由劳动教育规则额外累计 labor_hours。
    """
    __tablename__ = 'labor_education_course_pool'

    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.String(20), nullable=False, unique=True, index=True)
    course_name = db.Column(db.String(200), nullable=False, index=True)
    course_system = db.Column(db.String(50), nullable=False, index=True)
    credits = db.Column(db.Float, nullable=False, default=0)
    labor_hours = db.Column(db.Float, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)



class CourseListAssignment(db.Model):
    """
    课程归属记录 - 只记录来源，字段需要时到源头查询
    """
    __tablename__ = 'course_list_assignments'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    course_list_id = db.Column(db.Integer, db.ForeignKey('course_lists.id'), nullable=True)
    
    # 来源类型: 'course'(普通课程), 'exchange_course'(转交流), 'dissertation'(毕业论文)
    source_type = db.Column(db.String(20), nullable=False, default='course')
    
    # 来源UUID: 
    # - course: 执行计划编号(zxjhbh)，关联到 Transcript.uuid 或 SelectedCourse.course_uuid
    # - exchange_course: 暂不考虑
    # - dissertation: 留空
    source_uuid = db.Column(db.String(50), nullable=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 唯一约束：同一来源在同一列表只能归属一次
    __table_args__ = (
        db.UniqueConstraint('user_id', 'source_type', 'source_uuid', name='uq_assignment'),
    )

# ==================== 学期模型 ====================

class Semester(db.Model):
    """学期表 - 独立管理学期"""
    __tablename__ = 'semesters'
    id = db.Column(db.Integer, primary_key=True)
    academic_year = db.Column(db.String(10), nullable=False)  # 学年，如 "24-25"
    term = db.Column(db.Integer, nullable=False)  # 学期：1, 2, 3
    name = db.Column(db.String(20), nullable=False, unique=True, index=True)  # e.g. "25-26-1"
    first_week_monday = db.Column(db.Date, nullable=True)  # 第1周周一的日期
    description = db.Column(db.String(200), nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # 关系：学期下的所有课程
    courses = db.relationship('Course', backref='semester_ref', lazy='dynamic', cascade='all, delete-orphan')

# ==================== 课程名称映射表 ====================

class CourseNameMapping(db.Model):
    """课程名称映射表 - 课程号到课程名称和学分"""
    __tablename__ = 'course_name_mappings'
    course_id = db.Column(db.String(20), primary_key=True)  # course_id 作为主键
    course_name = db.Column(db.String(100), nullable=False)
    credits = db.Column(db.Float, nullable=False, default=0)  # 学分数移到此处
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# ==================== 课程模型 ====================

class Course(db.Model):
    """课程库 - 管理员维护"""
    __tablename__ = 'courses_basic'
    uuid = db.Column(db.String(50), primary_key=True)
    course_id = db.Column(db.String(20), nullable=False, index=True)
    # course_name 已移除，通过 course_id 关联 CourseNameMapping 获取
    course_type = db.Column(db.String(50))
    department_code = db.Column(db.String(10), nullable=False, default='0')
    class_number = db.Column(db.String(10))
    # credits 已移除到 CourseNameMapping
    semester = db.Column(db.String(20), db.ForeignKey('semesters.name'), index=True)  # e.g. "25-26-1"
    # week_range 已移除，移到 class_times 中
    class_times = db.Column(JSON)  # [{day, start_period, end_period, week_range}, ...] - 不包含location
    teachers = db.Column(JSON)     # Storing list of strings
    remarks = db.Column(db.String(200))
    
    @property
    def course_name(self):
        """通过 course_id 获取课程名称"""
        mapping = CourseNameMapping.query.filter_by(course_id=self.course_id).first()
        return mapping.course_name if mapping else '未知课程'
    
    @property
    def credits(self):
        """通过 course_id 获取学分"""
        mapping = CourseNameMapping.query.filter_by(course_id=self.course_id).first()
        return mapping.credits if mapping else 0.0

# ==================== 选课模型 ====================

class SelectedCourse(db.Model):
    """已选课程 - 按学生隔离"""
    __tablename__ = 'selected_courses'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)  # 归属学生
    user = db.relationship('User', backref='selected_courses')
    
    semester = db.Column(db.String(50), nullable=False)  # e.g. "25-26-1"
    course_uuid = db.Column(db.String(50), db.ForeignKey('courses_basic.uuid'), nullable=False)
    
    # 课程时段信息（包含地点）- 从 Portal 同步
    class_times = db.Column(JSON)  # [{day, start_period, end_period, week_range, location}, ...]
    
    # 考试信息 - 从 Portal 同步
    exam_info = db.Column(JSON)  # {date: "YYYYMMDD", period: 1/2/3, location: "..."}，可能为空对象
    
    # 备注
    remarks = db.Column(db.String(500))
    channel = db.Column(db.Integer, nullable=False, default=0)  # 0: 主修，1: 辅双, 2: 转交流, 3: 毕业论文
    
    course = db.relationship('Course')
    
    # 唯一约束：每个学生只能选同一门课（相同uuid代表同一门课同一次开课）一次
    __table_args__ = (
        db.UniqueConstraint('user_id', 'course_uuid', name='uq_user_course'),
    )

# ==================== 成绩单模型 ====================

class Transcript(db.Model):
    """成绩单记录 - 从教务系统同步"""
    __tablename__ = 'transcripts'
    
    # 主键：成绩记录唯一标识
    record_id = db.Column(db.String(50), primary_key=True)  # bkcjbh 成绩记录编号
    
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    user = db.relationship('User', backref='transcripts')
    
    # 成绩单原始字段
    uuid = db.Column(db.String(50), nullable=False, index=True)  # zxjhbh 执行计划编号
    course_id = db.Column(db.String(20), nullable=False, index=True)  # kch 课程号
    class_number = db.Column(db.String(10))  # jxbh 班号
    academic_year = db.Column(db.String(10), nullable=False)  # xnd 学年(25-26)
    term = db.Column(db.Integer, nullable=False)  # xq 学期(1/2/3)
    course_name = db.Column(db.String(100), nullable=False)  # kcmc 课程名称
    score = db.Column(db.String(10), nullable=False)  # xqcj 成绩
    score_type = db.Column(db.String(20))  # cjjlfs: "Percentage"/"Grade"/"P/NP"
    credits = db.Column(db.Float, nullable=False)  # xf 学分
    # 主修/辅双通道
    channel = db.Column(db.Integer, nullable=False)  # 0: 主修，1: 辅双
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DeletedTranscript(db.Model):
    """用户主动删除的成绩单记录，用于隐藏和防止同步恢复"""
    __tablename__ = 'deleted_transcripts'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    user = db.relationship('User', backref='deleted_transcripts')

    record_id = db.Column(db.String(100), nullable=False, index=True)
    uuid = db.Column(db.String(50), nullable=False, index=True)
    course_id = db.Column(db.String(20), nullable=False, index=True)
    class_number = db.Column(db.String(10))
    academic_year = db.Column(db.String(10), nullable=False)
    term = db.Column(db.Integer, nullable=False)
    course_name = db.Column(db.String(100), nullable=False)
    score = db.Column(db.String(10), nullable=False)
    score_type = db.Column(db.String(20))
    credits = db.Column(db.Float, nullable=False)
    channel = db.Column(db.Integer, nullable=False)
    source = db.Column(db.String(20), nullable=False, default='portal')

    deleted_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'record_id', name='uq_deleted_transcript_user_record'),
    )


class ExchangeTranscript(db.Model):
    """转交流成绩记录"""
    __tablename__ = 'exchange_transcripts'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    user = db.relationship('User', backref='exchange_transcripts')
    
    academic_year = db.Column(db.String(10), nullable=False)  # 学年，如 "24-25"
    term = db.Column(db.Integer, nullable=False)  # 学期：1, 2, 3
    course_name = db.Column(db.String(100), nullable=False)  # 课程名称
    score = db.Column(db.String(10), nullable=False)  # 成绩
    score_type = db.Column(db.String(20), default='P/NP')  # 成绩类型
    credits = db.Column(db.Float, nullable=False)  # 学分
    channel = db.Column(db.Integer, nullable=False, default=2)  # 2: 转交流
    conversion_type = db.Column(db.String(20))  # "学分认定" 或 "课程替代"
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DissertationTranscript(db.Model):
    """毕业论文成绩记录"""
    __tablename__ = 'dissertation_transcripts'
    
    # 每个学生只有一条记录，user_id 作为主键
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), primary_key=True)
    user = db.relationship('User', backref='dissertation_transcript', uselist=False)
    
    complete = db.Column(db.Boolean, nullable=False, default=False)  # 是否完成
    
    # 以下字段仅在 complete=True 时有值
    title = db.Column(db.String(200))  # 论文标题
    score = db.Column(db.String(10))  # 成绩
    score_type = db.Column(db.String(20))  # 成绩类型
    credits = db.Column(db.Float)  # 学分
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
