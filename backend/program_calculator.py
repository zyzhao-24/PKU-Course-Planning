"""
培养方案进度计算引擎 v6.0

核心设计：
1. CourseListAssignment 只存储不可重复列表的归属（course_list_id 可为空表示未分配）
2. 可重复列表当场计算，不存储
3. 严格优先级匹配：课号 > 类型 > 院系 > 教师 > 任选
4. 为课程找最优列表（不可重复），为列表找最优课程（可重复）
"""

from models import (
    Program, MainCategory, Node, CourseList, CourseListAssignment,
    Transcript, DissertationTranscript, User,
    SelectedCourse, Course, CourseNameMapping, CollegeEnglishCoursePool,
    LaborEducationCoursePool
)
from database import db
from typing import List, Dict, Any, Optional, Set, Tuple
from collections import defaultdict
from college_english import (
    ENGLISH_REQUIREMENT_ALTERNATIVES,
    ENGLISH_LEVELS,
    ENGLISH_MODULES,
    is_college_english_node,
    module_label,
    requirement_summary,
    normalize_name,
)
from physical_education import is_physical_education_node
from labor_education import is_labor_education_node


PHYSICAL_EDUCATION_EXCLUDED_SOURCE_TYPE = 'pe_excluded'


def _is_college_english_module_list(course_list: Optional[CourseList]) -> bool:
    """Whether a generated list represents one college English module."""
    return bool(course_list and (course_list.raw or '').startswith('college_english:'))


def _college_english_module(course_list: Optional[CourseList]) -> Optional[str]:
    if not _is_college_english_module_list(course_list):
        return None
    return (course_list.raw or '').split(':', 1)[1]


def _active_college_english_modules(user_id: int) -> Set[str]:
    user = User.query.get(user_id)
    if not user or not user.english_level:
        return set()
    modules = set()
    for requirements in ENGLISH_REQUIREMENT_ALTERNATIVES.get(user.english_level, []):
        modules.update(requirements.keys())
    return modules


class CourseInfoResolver:
    """
    课程信息解析器 - 根据 source_uuid 查询完整课程信息
    """
    
    @staticmethod
    def resolve(user_id: int, source_uuid: str, channel: int = 0) -> Optional[Dict]:
        """
        解析课程完整信息
        
        查询顺序：
        1. SelectedCourse (优先)
        2. Transcript
        
        Returns:
            课程信息字典，包含用于匹配和显示的字段
        """
        # 1. 查询 SelectedCourse
        selected = SelectedCourse.query.filter_by(
            user_id=user_id,
            course_uuid=source_uuid,
            channel=channel
        ).first()
        
        # 2. 查询 Transcript
        transcript = Transcript.query.filter_by(
            user_id=user_id,
            uuid=source_uuid,
            channel=channel
        ).first()
        
        # 3. 查询 Course 表
        course = Course.query.filter_by(uuid=source_uuid).first()
        
        # 必须有至少一个来源
        if not selected and not transcript and not course:
            return None
        
        # 获取课程号
        course_id = None
        if transcript:
            course_id = transcript.course_id
        elif course:
            course_id = course.course_id
        
        # 获取课程名称和学分（优先使用成绩单中的实际学分，课程库仅作补充）
        course_name = None
        credits = 0.0
        if transcript:
            course_name = transcript.course_name
            credits = transcript.credits
        if not course_name and course:
            mapping = CourseNameMapping.query.filter_by(course_id=course_id).first()
            if mapping:
                course_name = mapping.course_name
        if credits == 0.0 and course:
            mapping = CourseNameMapping.query.filter_by(course_id=course_id).first()
            if mapping:
                credits = mapping.credits

        # 成绩单中的历史课程 UUID 往往不在当前学期课程库中，但课程号仍然
        # 可以对应到课程库中的其他开课记录。课程类型必须从这里兜底获取，
        # 否则历史体育课会因 course_type=None 无法进入体育课节点。
        course_metadata = course
        type_metadata = course
        if (not type_metadata or not type_metadata.course_type) and course_id:
            type_metadata = Course.query.filter(
                Course.course_id == course_id,
                Course.course_type.isnot(None),
            ).first()
        
        # 获取成绩信息
        score = None
        has_grade = False
        if transcript and transcript.score != 'W':
            score = transcript.score
            has_grade = True
        
        # 获取用于匹配的字段
        dept_code = course_metadata.department_code if course_metadata else (transcript.course_id[:3] if transcript and len(transcript.course_id) >= 3 else None)
        course_type = type_metadata.course_type if type_metadata else None
        teachers = course_metadata.teachers if course_metadata else None
        
        # 从 SelectedCourse 补充信息
        if selected and selected.course:
            dept_code = selected.course.department_code or dept_code
            course_type = selected.course.course_type or course_type
            teachers = selected.course.teachers or teachers
        
        return {
            'source_uuid': source_uuid,
            'source_type': 'course',
            'course_id': course_id,
            'course_name': course_name or '未知课程',
            'credits': credits,
            'score': score,
            'has_grade': has_grade,
            'department_code': dept_code,
            'course_type': course_type,
            'teachers': teachers,
        }
    
    @staticmethod
    def resolve_dissertation(user_id: int) -> Optional[Dict]:
        """解析毕业论文信息"""
        diss = DissertationTranscript.query.filter_by(user_id=user_id).first()
        if not diss or not diss.complete:
            return None
        
        return {
            'source_uuid': None,
            'source_type': 'dissertation',
            'course_id': 'DISSERTATION',
            'course_name': diss.title or '毕业论文',
            'credits': diss.credits or 6.0,
            'score': diss.score,
            'has_grade': diss.score is not None,
            'department_code': None,
            'course_type': None,
            'teachers': None,
        }


class PriorityMatcher:
    """
    严格优先级匹配器
    
    优先级层级（数字越小优先级越高）：
    0 - 课号匹配
    1 - 类型匹配（课号不匹配）
    2 - 院系匹配（课号、类型不匹配）
    3 - 教师匹配（课号、类型、院系不匹配）
    4 - 任选（无任何匹配）
    5 - 不匹配
    """
    
    @staticmethod
    def get_match_level(course_info: Dict, filters: Dict) -> int:
        """
        获取课程与筛选条件的匹配层级
        
        Returns:
            0-4: 匹配层级（越小优先级越高）
            5: 不匹配
        """
        if not filters:
            return 4  # 任选
        
        # 0. 课号匹配（最高优先级）
        if filters.get('course_id') and course_info.get('course_id'):
            if course_info['course_id'] in filters['course_id']:
                return 0
        
        # 1. 类型匹配
        if filters.get('course_type') and course_info.get('course_type'):
            if course_info['course_type'] in filters['course_type']:
                return 1
        
        # 2. 院系匹配
        if filters.get('dept') and course_info.get('department_code'):
            if course_info['department_code'] in filters['dept']:
                return 2
        
        # 3. 教师匹配
        if filters.get('teachers') and course_info.get('teachers'):
            teachers = course_info['teachers']
            filter_teachers = filters['teachers']
            if isinstance(teachers, list):
                if any(t in filter_teachers for t in teachers):
                    return 3
            elif teachers in filter_teachers:
                return 3
        
        # 4. 任选（无筛选条件或无任何匹配）
        if not filters or all(not v for v in filters.values()):
            return 4
        
        return 5  # 不匹配


class NonRepeatableDistributor:
    """
    不可重复列表分配器
    
    为每个课程找到最优的不可重复列表
    """
    
    def __init__(self, user_id: int, channel: int, program_id: int):
        self.user_id = user_id
        self.channel = channel
        self.program_id = program_id
        self.matcher = PriorityMatcher()
    
    def distribute(self, all_course_uuids: Set[str]) -> Dict[str, Optional[int]]:
        """
        分配课程到不可重复列表
        
        Args:
            all_course_uuids: 所有可用的课程uuid
        
        Returns:
            {source_uuid: course_list_id or None}
            course_list_id 为 None 表示未分配
        """
        # 1. 获取所有不可重复列表（按 order_index 排序）
        non_repeatable_lists = self._get_non_repeatable_lists()
        
        # 2. 解析所有课程信息
        course_infos = {}
        for uuid in all_course_uuids:
            info = CourseInfoResolver.resolve(self.user_id, uuid, self.channel)
            if info:
                course_infos[uuid] = info
        
        # 3. 跟踪每个列表的已分配数量（在内存中，而不是查询数据库）
        list_counts = {}  # {list_id: count}
        
        # 4. 为每个课程找到最优列表
        assignments = {}  # {uuid: list_id or None}
        
        for uuid, info in course_infos.items():
            best_list_id = None
            best_level = 5  # 初始为不匹配
            
            for cl in non_repeatable_lists:
                # 检查列表是否已满（使用内存中的计数）
                current_count = list_counts.get(cl.id, 0)
                if cl.max_courses is not None and current_count >= cl.max_courses:
                    continue
                
                # 获取匹配层级
                level = self.matcher.get_match_level(info, cl.filters or {})
                
                # 更优的匹配
                if level < best_level:
                    best_level = level
                    best_list_id = cl.id
            
            # 记录分配结果
            if best_level < 5 and best_list_id is not None:
                assignments[uuid] = best_list_id
                # 更新列表计数
                list_counts[best_list_id] = list_counts.get(best_list_id, 0) + 1
            else:
                assignments[uuid] = None  # 未分配
        
        # 5. 保存到数据库
        self._save_assignments(assignments)
        
        return assignments
    
    def _get_non_repeatable_lists(self) -> List[CourseList]:
        """获取该培养方案下所有不可重复列表"""
        program = Program.query.get(self.program_id)
        lists = []
        active_english_modules = _active_college_english_modules(self.user_id)
        
        for category in program.categories:
            for node in category.nodes:
                for cl in node.course_lists:
                    module = _college_english_module(cl)
                    if module and module not in active_english_modules:
                        continue
                    if not cl.is_dissertation and not cl.is_repeatable:
                        lists.append(cl)
        
        # 按 order_index 排序
        lists.sort(key=lambda x: x.order_index or 0)
        return lists
    
    def _save_assignments(self, assignments: Dict[str, Optional[int]]):
        """
        保存分配结果到数据库
        
        为所有课程创建记录，无论是否分配
        """
        # 注意：清除操作在 recalculate 中已经做过，这里不再重复清除
        # 这样可以避免清除其他通道的分配
        
        # 为所有课程创建/更新记录（包括未分配的）
        for uuid, list_id in assignments.items():
            # 查找或创建记录
            assignment = CourseListAssignment.query.filter_by(
                user_id=self.user_id,
                source_type='course',
                source_uuid=uuid
            ).first()
            
            if not assignment:
                assignment = CourseListAssignment(
                    user_id=self.user_id,
                    course_list_id=list_id,  # 可能是None（未分配）
                    source_type='course',
                    source_uuid=uuid
                )
                db.session.add(assignment)
            else:
                assignment.course_list_id = list_id  # 更新分配（可能是None）
        
        db.session.commit()


class RepeatableCalculator:
    """
    可重复列表计算器
    
    当场计算，不存储
    """
    
    def __init__(self, user_id: int, channel: int, program_id: int):
        self.user_id = user_id
        self.channel = channel
        self.program_id = program_id
        self.matcher = PriorityMatcher()
    
    def calculate(self, all_course_uuids: Set[str]) -> Dict[int, List[Dict]]:
        """
        计算每个可重复列表的课程
        
        Args:
            all_course_uuids: 所有可用的课程uuid
        
        Returns:
            {course_list_id: [course_info, ...]}
        """
        # 1. 获取所有可重复列表
        repeatable_lists = self._get_repeatable_lists()
        
        # 2. 解析所有课程信息
        course_infos = {}
        for uuid in all_course_uuids:
            info = CourseInfoResolver.resolve(self.user_id, uuid, self.channel)
            if info:
                course_infos[uuid] = info
        
        # 3. 为每个可重复列表筛选课程
        results = {}
        
        for cl in repeatable_lists:
            # 筛选满足条件的课程
            matched_courses = []
            
            for uuid, info in course_infos.items():
                level = self.matcher.get_match_level(info, cl.filters or {})
                if level < 5:  # 匹配
                    matched_courses.append({
                        **info,
                        'match_level': level
                    })
            
            # 按匹配层级排序（层级相同则按学分降序）
            matched_courses.sort(key=lambda x: (x['match_level'], -x['credits']))

            # 应用 max_courses 限制：优先保留匹配层级高、学分高的课程
            if cl.max_courses and len(matched_courses) > cl.max_courses:
                matched_courses = matched_courses[:cl.max_courses]
            
            results[cl.id] = matched_courses
        
        return results
    
    def _get_repeatable_lists(self) -> List[CourseList]:
        """获取该培养方案下所有可重复列表"""
        program = Program.query.get(self.program_id)
        lists = []
        
        for category in program.categories:
            for node in category.nodes:
                for cl in node.course_lists:
                    if not cl.is_dissertation and cl.is_repeatable:
                        lists.append(cl)
        
        # 按 order_index 排序
        lists.sort(key=lambda x: x.order_index or 0)
        return lists


class CollegeEnglishCalculator:
    """Calculate the shared college English requirement from user placement."""

    def __init__(self, user_id: int, channel: int):
        self.user_id = user_id
        self.channel = channel
        self.user = User.query.get(user_id)
        self.level_options = {item["value"]: item for item in ENGLISH_LEVELS}

    def calculate_node(self, node: Node, category_name: str, all_course_uuids: Set[str]) -> Dict:
        module_lists = self._ensure_module_course_lists(node)
        matches = self._match_courses(all_course_uuids)
        matched_source_uuids = sorted(matches.keys())
        level = self.user.english_level if self.user else None

        base = {
            'id': node.id,
            'type': 'node',
            'name': node.name,
            'credits': 0.0,
            'course_count': 0,
            'qualified': False,
            'qualification_rules': [],
            'children': [],
            'is_college_english': True,
        }

        if not level:
            base['english_requirement'] = self._metadata(
                level=None,
                configured=False,
                qualified=False,
                selected_requirements={},
                module_status={},
                selected_courses=[],
                matched_courses=list(matches.values()),
                matched_source_uuids=matched_source_uuids,
                message='请先在培养方案设置中选择大学英语分级。',
            )
            return base

        if level == 'EXEMPT':
            base.update({
                'credits': 2.0,
                'course_count': 0,
                'qualified': True,
            })
            base['english_requirement'] = self._metadata(
                level=level,
                configured=True,
                qualified=True,
                selected_requirements={},
                module_status={},
                selected_courses=[],
                matched_courses=list(matches.values()),
                matched_source_uuids=matched_source_uuids,
                message='当前设置为不适用/免修，大学英语要求视为已满足。',
            )
            return base

        attempts = [
            self._attempt_requirement(matches, requirements)
            for requirements in ENGLISH_REQUIREMENT_ALTERNATIVES.get(level, [])
        ]
        best = self._choose_best_attempt(attempts)
        qualified = bool(best and best['qualified'])
        # Before a course is manually assigned, an incomplete requirement is
        # only a candidate and remains unassigned. Once it is explicitly
        # assigned to an English module, show it in the module even when the
        # overall requirement is still incomplete, just like other lists.
        selected_courses = []
        if best:
            selected_courses = (
                best['selected_courses'] if qualified else
                [course for course in best['selected_courses']
                 if course.get('assigned_english')]
            )
        selected_credits = sum(float(course.get('credits') or 0) for course in selected_courses)

        base.update({
            'credits': selected_credits,
            'course_count': len(selected_courses),
            'qualified': qualified,
        })
        base['english_requirement'] = self._metadata(
            level=level,
            configured=True,
            qualified=qualified,
            selected_requirements=best['requirements'] if best else {},
            module_status=best['module_status'] if best else {},
            selected_courses=selected_courses,
            matched_courses=list(matches.values()),
            matched_source_uuids=matched_source_uuids,
            message='大学英语要求已满足。' if qualified else '大学英语要求尚未满足。',
        )
        base['children'] = self._build_virtual_course_lists(
            best['requirements'] if best else {},
            selected_courses,
            qualified,
            module_lists,
        )
        return base

    def _ensure_module_course_lists(self, node: Node) -> Dict[str, CourseList]:
        """Keep real course-list records for College English modules."""
        existing = {
            (course_list.raw or ''): course_list
            for course_list in node.course_lists
            if (course_list.raw or '').startswith('college_english:')
        }
        changed = False
        module_lists: Dict[str, CourseList] = {}

        for index, module in enumerate([item['value'] for item in ENGLISH_MODULES]):
            raw_key = f'college_english:{module}'
            course_ids = self._course_ids_for_module(module)
            filters = {'course_id': course_ids} if course_ids else {}
            course_list = existing.get(raw_key)

            if not course_list:
                course_list = CourseList(
                    node_id=node.id,
                    name=module_label(module),
                    order_index=1000 + index,
                    raw=raw_key,
                    course_category='college_english',
                    filters=filters,
                    is_repeatable=False,
                    is_dissertation=False,
                    qualification_rules=[],
                )
                db.session.add(course_list)
                changed = True
            else:
                if course_list.name != module_label(module):
                    course_list.name = module_label(module)
                    changed = True
                if course_list.filters != filters:
                    course_list.filters = filters
                    changed = True
                if course_list.course_category != 'college_english':
                    course_list.course_category = 'college_english'
                    changed = True
                if course_list.order_index != 1000 + index:
                    course_list.order_index = 1000 + index
                    changed = True

            module_lists[module] = course_list

        if changed:
            db.session.commit()

        return module_lists

    def _build_virtual_course_lists(
        self,
        requirements: Dict[str, float],
        selected_courses: List[Dict],
        qualified: bool,
        module_lists: Dict[str, CourseList],
    ) -> List[Dict]:
        courses_by_module = defaultdict(list)
        for course in selected_courses:
            courses_by_module[course.get('english_module')].append(course)

        children = []
        for index, (module, required_credits) in enumerate(requirements.items()):
            course_list = module_lists.get(module)
            if not course_list:
                continue
            courses = courses_by_module.get(module, [])
            credits = sum(float(course.get('credits') or 0) for course in courses)
            child_qualified = qualified and credits >= float(required_credits) - 0.01
            children.append({
                'id': course_list.id,
                'type': 'course_list',
                'name': course_list.name,
                'credits': credits,
                'course_count': len(courses),
                'qualified': child_qualified,
                'is_college_english_virtual': True,
                'english_module': module,
                'is_repeatable': course_list.is_repeatable,
                'is_dissertation': course_list.is_dissertation,
                'filters': course_list.filters or {},
                'max_courses': course_list.max_courses,
                'qualification_rules': [{
                    'min_credits': float(required_credits),
                    'min_courses': None,
                    'filters': {},
                }],
                'courses': courses,
                'order_index': index,
            })
        return children

    def _course_ids_for_module(self, module: str) -> List[str]:
        rows = CollegeEnglishCoursePool.query.filter_by(
            active=True,
            module=module,
        ).order_by(
            CollegeEnglishCoursePool.order_index,
            CollegeEnglishCoursePool.course_id,
        ).all()
        seen = set()
        course_ids = []
        for row in rows:
            course_id = str(row.course_id or '').strip()
            if course_id and course_id not in seen:
                seen.add(course_id)
                course_ids.append(course_id)
        return course_ids

    def _metadata(
        self,
        *,
        level: Optional[str],
        configured: bool,
        qualified: bool,
        selected_requirements: Dict[str, float],
        module_status: Dict[str, Dict[str, Any]],
        selected_courses: List[Dict],
        matched_courses: List[Dict],
        matched_source_uuids: List[str],
        message: str,
    ) -> Dict:
        option = self.level_options.get(level or '')
        missing = sum(max(0.0, float(status.get('required', 0)) - float(status.get('credits', 0)))
                      for status in module_status.values())
        return {
            'level': level,
            'level_label': option['label'] if option else None,
            'configured': configured,
            'qualified': qualified,
            'summary': requirement_summary(level),
            'selected_requirements': selected_requirements,
            'module_status': module_status,
            'missing_credits': missing,
            'selected_source_uuids': [course['source_uuid'] for course in selected_courses],
            'selected_courses': selected_courses,
            'matched_source_uuids': matched_source_uuids,
            'matched_courses': matched_courses,
            'message': message,
        }

    def _match_courses(self, all_course_uuids: Set[str]) -> Dict[str, Dict]:
        assignments = {}
        excluded_uuids = set()
        if all_course_uuids:
            assignment_rows = CourseListAssignment.query.filter(
                CourseListAssignment.user_id == self.user_id,
                CourseListAssignment.source_uuid.in_(list(all_course_uuids)),
            ).all()
            for assignment in assignment_rows:
                if assignment.source_type == 'college_english_excluded':
                    excluded_uuids.add(assignment.source_uuid)
                elif assignment.source_type == 'course':
                    assignments[assignment.source_uuid] = assignment

        pool = CollegeEnglishCoursePool.query.filter_by(active=True).order_by(
            CollegeEnglishCoursePool.order_index,
            CollegeEnglishCoursePool.id,
        ).all()
        by_course_id = defaultdict(list)
        by_name = defaultdict(list)
        for item in pool:
            by_course_id[item.course_id].append(item.module)
            by_name[normalize_name(item.course_name)].append(item.module)

        matches: Dict[str, Dict] = {}
        for source_uuid in all_course_uuids:
            if source_uuid in excluded_uuids:
                continue

            info = CourseInfoResolver.resolve(self.user_id, source_uuid, self.channel)
            if not info:
                continue

            modules = []
            assignment = assignments.get(source_uuid)
            if assignment:
                # A normal assignment is authoritative. An English course
                # only remains eligible for the English requirement when it
                # is assigned to an English module list.
                assigned_module = _college_english_module(assignment.course_list)
                if not assigned_module:
                    continue
                modules.append(assigned_module)
                assigned_english = True
            else:
                if info.get('course_id') in by_course_id:
                    modules.extend(by_course_id[info['course_id']])
                name_key = normalize_name(info.get('course_name'))
                if not modules and name_key in by_name:
                    modules.extend(by_name[name_key])
                assigned_english = False
            if not modules:
                continue

            matches[source_uuid] = {
                **info,
                'english_modules': sorted(set(modules)),
                'assigned_english': assigned_english,
            }

        return matches

    def _attempt_requirement(self, matches: Dict[str, Dict], requirements: Dict[str, float]) -> Dict:
        used_uuids: Set[str] = set()
        selected_courses: List[Dict] = []
        module_status: Dict[str, Dict[str, Any]] = {}

        for module, required_credits in requirements.items():
            credits = 0.0
            module_courses = []
            candidates = [
                course for course in matches.values()
                if module in course.get('english_modules', [])
            ]
            candidates.sort(key=lambda c: (
                0 if c.get('has_grade') else 1,
                -float(c.get('credits') or 0),
                c.get('course_name') or '',
                c.get('source_uuid') or '',
            ))

            for course in candidates:
                if course['source_uuid'] in used_uuids:
                    continue
                selected = {
                    **course,
                    'english_module': module,
                    'english_module_label': module_label(module),
                }
                module_courses.append(selected)
                selected_courses.append(selected)
                used_uuids.add(course['source_uuid'])
                credits += float(course.get('credits') or 0)
                if credits >= float(required_credits) - 0.01:
                    break

            module_status[module] = {
                'module': module,
                'label': module_label(module),
                'required': float(required_credits),
                'credits': credits,
                'qualified': credits >= float(required_credits) - 0.01,
                'courses': module_courses,
            }

        qualified = all(status['qualified'] for status in module_status.values())
        total_required = sum(float(value) for value in requirements.values())
        total_credits = sum(float(status['credits']) for status in module_status.values())
        missing = sum(max(0.0, float(status['required']) - float(status['credits']))
                      for status in module_status.values())
        return {
            'requirements': requirements,
            'module_status': module_status,
            'selected_courses': selected_courses,
            'qualified': qualified,
            'total_required': total_required,
            'total_credits': total_credits,
            'missing': missing,
        }

    def _choose_best_attempt(self, attempts: List[Dict]) -> Optional[Dict]:
        if not attempts:
            return None
        return max(
            attempts,
            key=lambda attempt: (
                1 if attempt['qualified'] else 0,
                -abs(attempt['total_credits'] - attempt['total_required']) if attempt['qualified'] else attempt['total_credits'],
                -attempt['missing'],
            )
        )


class DissertationCalculator:
    """
    毕业论文计算器
    """
    
    def __init__(self, user_id: int):
        self.user_id = user_id
    
    def calculate(self, course_list: CourseList) -> List[Dict]:
        """计算毕业论文列表"""
        info = CourseInfoResolver.resolve_dissertation(self.user_id)
        
        if info:
            return [info]
        
        return []


class CourseListResultBuilder:
    """
    课程列表结果构建器
    
    整合不可重复列表（从数据库查询）和可重复列表（当场计算）的结果
    """
    
    def __init__(self, user_id: int, channel: int,
                 excluded_source_uuids: Optional[Set[str]] = None):
        self.user_id = user_id
        self.channel = channel
        self.excluded_source_uuids = excluded_source_uuids or set()
    
    def build(self, course_list: CourseList, 
              non_repeatable_assignments: Dict[str, Optional[int]],
              repeatable_results: Dict[int, List[Dict]]) -> Dict:
        """
        构建单个课程列表的完整结果
        """
        if course_list.is_dissertation:
            # 毕业论文
            courses = DissertationCalculator(self.user_id).calculate(course_list)
        elif course_list.is_repeatable:
            # 可重复列表 - 从当场计算的结果获取
            courses = repeatable_results.get(course_list.id, [])
        else:
            # 不可重复列表 - 从数据库查询归属
            courses = self._get_assigned_courses(course_list.id)
        
        # 检查合格规则
        qualified = self._check_qualification(course_list, courses)
        
        return {
            'id': course_list.id,
            'type': 'course_list',
            'name': course_list.name,
            'credits': sum(c['credits'] for c in courses),
            'course_count': len(courses),
            'qualified': qualified,
            'is_repeatable': course_list.is_repeatable,
            'is_dissertation': course_list.is_dissertation,
            'filters': course_list.filters,
            'max_courses': course_list.max_courses,
            'qualification_rules': course_list.qualification_rules,
            'courses': courses
        }
    
    def _get_assigned_courses(self, list_id: int) -> List[Dict]:
        """获取已分配到该列表的所有课程"""
        assignments = CourseListAssignment.query.filter_by(
            user_id=self.user_id,
            course_list_id=list_id,
            source_type='course'
        ).all()
        
        courses = []
        for a in assignments:
            if a.source_uuid in self.excluded_source_uuids:
                continue
            info = CourseInfoResolver.resolve(self.user_id, a.source_uuid, self.channel)
            if info:
                courses.append(info)
        
        return courses
    
    def _check_qualification(self, course_list: CourseList, 
                            courses: List[Dict]) -> bool:
        """检查课程列表是否满足合格规则"""
        rules = course_list.qualification_rules or []
        
        if not rules:
            return True
        
        matcher = PriorityMatcher()
        
        for rule in rules:
            # 用 rule.filters 进一步筛选
            filtered = []
            if rule.get('filters'):
                for c in courses:
                    level = matcher.get_match_level(c, rule['filters'])
                    if level < 5:
                        filtered.append(c)
            else:
                filtered = courses
            
            credits = sum(c['credits'] for c in filtered)
            course_count = len(filtered)
            
            # 检查学分要求
            min_credits = rule.get('min_credits')
            if min_credits is not None and credits < min_credits:
                return False
            
            # 检查门数要求
            min_courses = rule.get('min_courses')
            if min_courses is not None and course_count < min_courses:
                return False
        
        return True


class NodeCalculator:
    """
    节点计算器
    """
    
    def __init__(self, user_id: int, channel: int, program_id: int,
                 special_node_results: Optional[Dict[int, Dict]] = None,
                 excluded_source_uuids: Optional[Set[str]] = None):
        self.user_id = user_id
        self.channel = channel
        self.program_id = program_id
        self.result_builder = CourseListResultBuilder(
            user_id, channel, excluded_source_uuids
        )
        self.special_node_results = special_node_results or {}
    
    def calculate(self, node: Node, 
                  non_repeatable_assignments: Dict[str, Optional[int]],
                  repeatable_results: Dict[int, List[Dict]]) -> Dict:
        """
        计算节点的学分、门数和合格状态
        """
        if node.id in self.special_node_results:
            return self.special_node_results[node.id]

        # 1. 计算本节点的课程列表
        list_results = []
        for cl in node.course_lists:
            result = self.result_builder.build(cl, non_repeatable_assignments, repeatable_results)
            list_results.append(result)
        
        # 2. 递归计算子节点
        child_results = []
        for child in node.children:
            result = self.calculate(child, non_repeatable_assignments, repeatable_results)
            child_results.append(result)
        
        # 3. 聚合所有子项
        all_children = list_results + child_results
        
        # 4. 计算总分和总门数
        total_credits = sum(c['credits'] for c in all_children)
        total_courses = sum(c['course_count'] for c in all_children)
        
        # 5. 合格判定
        qualified = self._check_qualification(node, all_children)
        
        return {
            'id': node.id,
            'type': 'node',
            'name': node.name,
            'credits': total_credits,
            'course_count': total_courses,
            'qualified': qualified,
            'qualification_rules': node.qualification_rules,
            'children': all_children
        }
    
    def _check_qualification(self, node: Node, children: List[Dict]) -> bool:
        """检查节点是否合格"""
        rules = node.qualification_rules or []
        
        if not rules:
            return all(c['qualified'] for c in children)
        
        for rule in rules:
            # 筛选指定的子项
            selected = []
            subnodes = rule.get('subnodes', [])
            sublists = rule.get('sublists', [])
            
            # 如果没有指定 subnodes 或 sublists，则选择所有子项
            if not subnodes and not sublists:
                selected = children[:]
            else:
                selected = [c for c in children if 
                            (c['type'] == 'node' and c['id'] in subnodes) or
                            (c['type'] == 'course_list' and c['id'] in sublists)]
            
            # 应用 node_filter 进一步筛选
            node_filter = rule.get('node_filter', {})
            if node_filter:
                min_credits = node_filter.get('min_credits', 0)
                min_courses = node_filter.get('min_courses', 0)
                require_qualified = node_filter.get('require_qualified', False)
                
                filtered = []
                for child in selected:
                    # 注意：这里应该是筛选出满足条件的子项
                    # 子项学分 >= min_credits 且 子项门数 >= min_courses
                    if child['credits'] < min_credits:
                        continue
                    if child['course_count'] < min_courses:
                        continue
                    if require_qualified and not child['qualified']:
                        continue
                    filtered.append(child)
                selected = filtered
            
            # 如果没有选中任何子项
            if not selected:
                # 如果显式指定了子节点或子列表但无一匹配，说明规则要求的节点/列表不存在，判定不合格
                if subnodes or sublists:
                    return False
                sum_req = rule.get('sum_requirements', {})
                if sum_req.get('min_credits', 0) > 0 or sum_req.get('min_courses', 0) > 0:
                    return False
                continue  # 如果没有要求，继续检查下一个规则
            
            # 求和 - 使用浮点数计算学分
            total_credits = sum(float(c['credits']) for c in selected)
            total_courses = sum(c['course_count'] for c in selected)
            qualified_count = sum(1 for c in selected if c['qualified'])
            
            # 检查 sum_requirements
            sum_req = rule.get('sum_requirements', {})
            
            min_credits_req = sum_req.get('min_credits')
            if min_credits_req is not None:
                # 使用浮点数比较，允许小误差
                if total_credits < float(min_credits_req) - 0.01:
                    return False
            
            min_courses_req = sum_req.get('min_courses')
            if min_courses_req is not None:
                if total_courses < min_courses_req:
                    return False
            
            req_qualified_count = sum_req.get('qualified_count')
            if req_qualified_count is not None:
                if req_qualified_count == 0:
                    # 不需要任何合格的子项，直接通过
                    continue
                elif req_qualified_count > 0:
                    if qualified_count < req_qualified_count:
                        return False
            else:
                # 默认要求所有选中的子项都合格
                if qualified_count < len(selected):
                    return False
        
        return True


class UnassignedCollector:
    """
    未分配课程收集器
    
    收集当前通道下所有未分配到不可重复列表的课程
    """
    
    def __init__(self, user_id: int, channel: int, course_uuids: Optional[Set[str]] = None):
        self.user_id = user_id
        self.channel = channel
        self.course_uuids = course_uuids
    
    def collect(self) -> List[Dict]:
        """收集未分配的课程（只包含本通道的）"""
        # 获取本通道的所有课程uuid
        uuids = self.course_uuids if self.course_uuids is not None else self._collect_course_uuids()
        if not uuids:
            return []
        
        # 查询这些课程中未分配的；没有 assignment 记录的课程也视为未分配
        assignments = CourseListAssignment.query.filter(
            CourseListAssignment.user_id == self.user_id,
            CourseListAssignment.source_type == 'course',
            CourseListAssignment.source_uuid.in_(list(uuids))
        ).all()
        assignment_map = {a.source_uuid: a for a in assignments}
        unassigned_uuids = [
            uuid for uuid in uuids
            if uuid not in assignment_map or assignment_map[uuid].course_list_id is None
        ]
        
        courses = []
        for uuid in unassigned_uuids:
            info = CourseInfoResolver.resolve(self.user_id, uuid, self.channel)
            if info:
                courses.append(info)
        
        return courses
    
    def _collect_course_uuids(self) -> Set[str]:
        """收集本通道所有课程的 uuid"""
        uuids = set()
        
        # 从成绩单收集
        transcripts = Transcript.query.filter_by(
            user_id=self.user_id,
            channel=self.channel
        ).filter(Transcript.score != 'W').all()
        
        for t in transcripts:
            uuids.add(t.uuid)
        
        # 从已选课程收集
        selected = SelectedCourse.query.filter_by(
            user_id=self.user_id,
            channel=self.channel
        ).all()
        
        for s in selected:
            uuids.add(s.course_uuid)
        
        return uuids


class CourseMoveManager:
    """
    课程移动管理器
    
    只支持移动到不可重复列表
    """
    
    def __init__(self, user_id: int, channel: int, program_id: int):
        self.user_id = user_id
        self.channel = channel
        self.program_id = program_id
        self.matcher = PriorityMatcher()
    
    def get_available_targets(self, source_uuid: str) -> List[Dict]:
        """
        获取可以移动到的目标列表
        
        条件：
        1. 不可重复列表
        2. 未达到门数上限
        3. filter 与课程匹配
        """
        # 获取课程信息
        info = CourseInfoResolver.resolve(self.user_id, source_uuid, self.channel)
        if not info:
            return []
        
        # 获取所有不可重复列表
        program = Program.query.get(self.program_id)
        targets = []
        
        for category in program.categories:
            for node in category.nodes:
                for cl in node.course_lists:
                    if cl.is_dissertation or cl.is_repeatable:
                        continue
                    
                    # 检查是否已满
                    if self._is_list_full(cl.id, cl.max_courses):
                        continue
                    
                    # 检查是否匹配
                    level = self.matcher.get_match_level(info, cl.filters or {})
                    if level < 5:  # 匹配
                        targets.append({
                            'id': cl.id,
                            'name': cl.name,
                            'match_level': level,
                            'max_courses': cl.max_courses
                        })
        
        # 按匹配层级排序
        targets.sort(key=lambda x: x['match_level'])
        return targets
    
    def move(self, source_uuid: str, target_list_id: int) -> Tuple[bool, str]:
        """
        移动课程到目标列表
        """
        # 获取课程信息
        info = CourseInfoResolver.resolve(self.user_id, source_uuid, self.channel)
        if not info:
            return False, "课程不存在"
        
        # 检查目标列表
        target_list = CourseList.query.get(target_list_id)
        if not target_list:
            return False, "目标列表不存在"
        
        if target_list.is_dissertation or target_list.is_repeatable:
            return False, "只能移动到不可重复列表"
        
        if self._is_list_full(target_list_id, target_list.max_courses):
            return False, f"目标列表已满（最多{target_list.max_courses}门）"
        
        # 检查匹配
        level = self.matcher.get_match_level(info, target_list.filters or {})
        if level >= 5:
            return False, "课程不匹配目标列表的筛选条件"
        
        # 执行移动
        try:
            assignment = CourseListAssignment.query.filter_by(
                user_id=self.user_id,
                source_type='course',
                source_uuid=source_uuid
            ).first()
            
            if not assignment:
                # 创建新记录
                assignment = CourseListAssignment(
                    user_id=self.user_id,
                    course_list_id=target_list_id,
                    source_type='course',
                    source_uuid=source_uuid
                )
                db.session.add(assignment)
            else:
                assignment.course_list_id = target_list_id

            # A successful manual move supersedes the legacy English
            # exclusion marker, regardless of the destination list.
            CourseListAssignment.query.filter_by(
                user_id=self.user_id,
                source_type='college_english_excluded',
                source_uuid=source_uuid,
            ).delete()
            CourseListAssignment.query.filter_by(
                user_id=self.user_id,
                source_type=PHYSICAL_EDUCATION_EXCLUDED_SOURCE_TYPE,
                source_uuid=source_uuid,
            ).delete()
            
            db.session.commit()
            return True, "移动成功"
            
        except Exception as e:
            db.session.rollback()
            return False, f"移动失败：{str(e)}"
    
    def _is_list_full(self, list_id: int, max_courses: Optional[int]) -> bool:
        """检查列表是否已满"""
        if max_courses is None:
            return False
        
        count = CourseListAssignment.query.filter_by(
            user_id=self.user_id,
            course_list_id=list_id
        ).count()
        
        return count >= max_courses


class ProgramProgressCalculator:
    """
    培养方案进度计算器 - 入口类
    """
    
    def __init__(self, user_id: int):
        self.user_id = user_id
    
    def calculate(self, program_id: int, channel: int, auto_distribute: bool = False) -> Dict:
        """
        计算指定培养方案的进度
        
        Args:
            program_id: 培养方案ID
            channel: 通道 0=主修, 1=辅双
            auto_distribute: 是否自动重新分配课程（默认False，只在recalculate时True）
        """
        program = Program.query.get(program_id)
        if not program:
            raise ValueError(f"Program {program_id} not found")
        
        # 1. 收集所有课程 uuid
        all_uuids = self._collect_course_uuids(channel)
        physical_results, physical_education_uuids = self._build_physical_education_results(
            program,
            channel,
            all_uuids,
            persist_lists=auto_distribute,
        )
        labor_results, dynamic_labor_result = self._build_labor_education_results(
            program, channel, all_uuids
        )
        physical_matched_uuids = set()
        for result in physical_results.values():
            physical_matched_uuids.update(
                result.get('physical_education_requirement', {}).get(
                    'matched_source_uuids', []
                )
            )

        # On recalculation, assign ordinary courses first, then rebuild the
        # special requirement views. Physical education courses are excluded
        # from ordinary assignment because their type alone determines their
        # requirement membership.
        if auto_distribute:
            self._migrate_physical_education_assignments(physical_results)
            self._build_college_english_results(program, channel, all_uuids)
            distributor = NonRepeatableDistributor(self.user_id, channel, program_id)
            distributor.distribute(all_uuids - physical_matched_uuids)
            english_results, college_english_uuids = self._build_college_english_results(
                program,
                channel,
                all_uuids,
            )
            special_node_results = {**english_results, **physical_results, **labor_results}
            consumed_uuids = college_english_uuids | physical_education_uuids
            distributable_uuids = all_uuids - consumed_uuids
            non_repeatable_assignments = self._load_existing_assignments(channel, distributable_uuids)
        else:
            english_results, college_english_uuids = self._build_college_english_results(
                program,
                channel,
                all_uuids,
            )
            special_node_results = {**english_results, **physical_results, **labor_results}
            consumed_uuids = college_english_uuids | physical_education_uuids
            distributable_uuids = all_uuids - consumed_uuids
            # Read the current assignments from the database.
            non_repeatable_assignments = self._load_existing_assignments(channel, distributable_uuids)
        
        # 3. 计算可重复列表（当场计算，不保存）
        repeatable_calc = RepeatableCalculator(self.user_id, channel, program_id)
        repeatable_results = repeatable_calc.calculate(distributable_uuids)
        
        # 4. 计算每个主类别
        node_calc = NodeCalculator(
            self.user_id,
            channel,
            program_id,
            special_node_results,
            excluded_source_uuids=consumed_uuids,
        )
        
        category_results = []
        for category in program.categories:
            root_nodes = Node.query.filter_by(
                main_category_id=category.id,
                parent_id=None
            ).order_by(Node.order_index).all()
            
            node_results = [node_calc.calculate(node, non_repeatable_assignments, repeatable_results) 
                          for node in root_nodes]

            if dynamic_labor_result and category.id == dynamic_labor_result['_category_id']:
                node_results.append({
                    key: value for key, value in dynamic_labor_result.items()
                    if key != '_category_id'
                })
            
            category_results.append({
                'id': category.id,
                'name': category.name,
                'nodes': node_results,
                'credits': sum(n['credits'] for n in node_results),
                'course_count': sum(n['course_count'] for n in node_results),
                'qualified': all(n['qualified'] for n in node_results)
            })
        
        # 5. 获取未分配课程（只显示本通道）
        unassigned = UnassignedCollector(self.user_id, channel, distributable_uuids).collect()
        
        # 6. 总体合格判定
        is_qualified = all(c['qualified'] for c in category_results)
        
        return {
            'program_id': program_id,
            'program_name': program.name,
            'channel': channel,
            'categories': category_results,
            'is_qualified': is_qualified,
            'total_credits': sum(c['credits'] for c in category_results),
            'total_courses': sum(c['course_count'] for c in category_results),
            'unassigned_courses': unassigned
        }
    
    def _build_college_english_results(
        self,
        program: Program,
        channel: int,
        all_uuids: Set[str],
    ) -> Tuple[Dict[int, Dict], Set[str]]:
        calculator = CollegeEnglishCalculator(self.user_id, channel)
        results: Dict[int, Dict] = {}
        matched_uuids: Set[str] = set()

        for category in program.categories:
            for node in category.nodes:
                if not is_college_english_node(category.name, node.name):
                    continue
                result = calculator.calculate_node(node, category.name, all_uuids)
                results[node.id] = result
                matched_uuids.update(
                    result.get('english_requirement', {}).get('selected_source_uuids', [])
                )

        return results, matched_uuids

    def _build_labor_education_results(
        self,
        program: Program,
        channel: int,
        all_uuids: Set[str],
    ) -> Tuple[Dict[int, Dict], Optional[Dict]]:
        """Build the labor education view without consuming ordinary courses."""
        results: Dict[int, Dict] = {}
        if int(program.year or 0) < 2021:
            return results, None

        pool = LaborEducationCoursePool.query.order_by(
            LaborEducationCoursePool.course_id
        ).all()
        pool_by_course_id = {item.course_id: item for item in pool}
        matched_courses = []
        for source_uuid in sorted(all_uuids):
            info = CourseInfoResolver.resolve(self.user_id, source_uuid, channel)
            if not info:
                continue
            pool_item = pool_by_course_id.get(info.get('course_id'))
            if not pool_item:
                continue
            matched_courses.append({
                **info,
                'labor_hours': float(pool_item.labor_hours or 0),
                'labor_course_system': pool_item.course_system,
            })

        matched_courses.sort(key=lambda course: (
            0 if course.get('has_grade') else 1,
            course.get('course_name') or '',
            course.get('source_uuid') or '',
        ))
        total_hours = sum(float(course.get('labor_hours') or 0) for course in matched_courses)
        total_credits = sum(float(course.get('credits') or 0) for course in matched_courses)
        pool_course_ids = list(pool_by_course_id.keys())

        labor_nodes = []
        for category in program.categories:
            for node in category.nodes:
                if is_labor_education_node(node.name):
                    labor_nodes.append((category, node))

        def make_result(node_id, node_name, required_hours, category_id=None):
            required_hours = max(32.0, float(required_hours or 0))
            qualified = total_hours >= required_hours - 0.01
            virtual_id = f'labor-education-list-{program.id}'
            result = {
                'id': node_id,
                'type': 'node',
                'name': node_name,
                # Labor courses are displayed here but are counted in their
                # original program lists, so they do not inflate totals.
                'credits': 0,
                'course_count': 0,
                'qualified': qualified,
                'qualification_rules': [],
                'is_labor_education': True,
                'labor_education_requirement': {
                    'required_hours': required_hours,
                    'hours': total_hours,
                    'course_count': len(matched_courses),
                    'course_credits': total_credits,
                    'qualified': qualified,
                    'matched_source_uuids': [course['source_uuid'] for course in matched_courses],
                },
                'children': [{
                    'id': virtual_id,
                    'type': 'course_list',
                    'name': '劳动教育课程（可同时计入原课程体系）',
                    'credits': total_credits,
                    'course_count': len(matched_courses),
                    'hours': total_hours,
                    'required_hours': required_hours,
                    'qualified': qualified,
                    'is_repeatable': False,
                    'is_dissertation': False,
                    'is_labor_education_virtual': True,
                    'filters': {'course_id': pool_course_ids},
                    'max_courses': None,
                    'qualification_rules': [],
                    'courses': matched_courses,
                }],
            }
            if category_id is not None:
                result['_category_id'] = category_id
            return result

        for category, node in labor_nodes:
            required = node.requirement_min
            if required is None:
                required = node.requirement_max
            results[node.id] = make_result(node.id, node.name, required)

        if labor_nodes:
            return results, None

        target_category = next(
            (category for category in program.categories if category.name == '公共基础课程'),
            next(iter(program.categories), None),
        )
        if not target_category:
            return results, None
        return results, make_result(
            f'labor-education-{program.id}',
            '劳动教育课',
            32,
            target_category.id,
        )

    def _build_physical_education_results(
        self,
        program: Program,
        channel: int,
        all_uuids: Set[str],
        persist_lists: bool = False,
    ) -> Tuple[Dict[int, Dict], Set[str]]:
        """Build the physical education node from course type and plan credits."""
        results: Dict[int, Dict] = {}
        selected_uuids: Set[str] = set()

        for category in program.categories:
            for node in category.nodes:
                if not is_physical_education_node(node.name):
                    continue

                required_credits = node.requirement_min
                if required_credits is None:
                    required_credits = node.requirement_max
                if required_credits is None:
                    for rule in node.qualification_rules or []:
                        if rule.get('min_credits') is not None:
                            required_credits = rule['min_credits']
                            break
                if required_credits is None:
                    required_credits = 4.0
                required_credits = float(required_credits)

                physical_course_list = None
                if persist_lists:
                    physical_course_list = self._ensure_physical_education_course_list(
                        node, required_credits
                    )
                elif node.course_lists:
                    physical_course_list = next(
                        (
                            course_list for course_list in node.course_lists
                            if not course_list.is_dissertation and not course_list.is_repeatable
                        ),
                        None,
                    )

                matched_courses = []
                assignments = {}
                excluded_source_uuids = set()
                if not persist_lists and all_uuids:
                    assignment_rows = CourseListAssignment.query.filter(
                        CourseListAssignment.user_id == self.user_id,
                        CourseListAssignment.source_uuid.in_(list(all_uuids)),
                    ).all()
                    for assignment in assignment_rows:
                        if assignment.source_type == PHYSICAL_EDUCATION_EXCLUDED_SOURCE_TYPE:
                            excluded_source_uuids.add(assignment.source_uuid)
                        elif assignment.source_type == 'course':
                            assignments[assignment.source_uuid] = assignment

                for source_uuid in sorted(all_uuids):
                    info = CourseInfoResolver.resolve(self.user_id, source_uuid, channel)
                    if not info or info.get('course_type') != '体育':
                        continue
                    if source_uuid in excluded_source_uuids:
                        continue
                    assignment = assignments.get(source_uuid)
                    assigned_to_physical = bool(
                        assignment and physical_course_list
                        and assignment.course_list_id == physical_course_list.id
                    )
                    if assignment and not assigned_to_physical:
                        continue
                    matched_courses.append({
                        **info,
                        'assigned_physical_education': assigned_to_physical,
                    })

                matched_courses.sort(key=lambda course: (
                    0 if course.get('assigned_physical_education') else 1,
                    0 if course.get('has_grade') else 1,
                    course.get('course_name') or '',
                    course.get('source_uuid') or '',
                ))

                selected_courses = []
                selected_credits = 0.0
                for course in matched_courses:
                    if selected_credits >= required_credits - 0.01:
                        break
                    selected_courses.append(course)
                    selected_uuids.add(course['source_uuid'])
                    selected_credits += float(course.get('credits') or 0)

                qualified = selected_credits >= required_credits - 0.01
                virtual_list_id = (
                    physical_course_list.id
                    if physical_course_list
                    else f'physical-education-{node.id}'
                )
                results[node.id] = {
                    'id': node.id,
                    'type': 'node',
                    'name': node.name,
                    'credits': selected_credits,
                    'course_count': len(selected_courses),
                    'qualified': qualified,
                    'qualification_rules': node.qualification_rules or [],
                    'is_physical_education': True,
                    'physical_education_requirement': {
                        'required_credits': required_credits,
                        'course_list_id': physical_course_list.id
                        if physical_course_list else None,
                        'qualified': qualified,
                        'matched_source_uuids': [
                            course['source_uuid'] for course in matched_courses
                        ],
                        'selected_source_uuids': [
                            course['source_uuid'] for course in selected_courses
                        ],
                    },
                    'children': [{
                        'id': virtual_list_id,
                        'type': 'course_list',
                        'name': '体育课程（按课程类型统计）',
                        'credits': selected_credits,
                        'course_count': len(selected_courses),
                        'qualified': qualified,
                        'is_repeatable': False,
                        'is_dissertation': False,
                        'is_physical_education_virtual': True,
                        'filters': {'course_type': ['体育']},
                        'max_courses': None,
                        'qualification_rules': [{
                            'min_credits': required_credits,
                            'min_courses': None,
                            'filters': {'course_type': ['体育']},
                        }],
                        'courses': selected_courses,
                    }],
                }

        return results, selected_uuids

    def _ensure_physical_education_course_list(
        self,
        node: Node,
        required_credits: float,
    ) -> CourseList:
        """Return the canonical persisted list used by the physical node."""
        course_list = next(
            (
                item for item in node.course_lists
                if not item.is_dissertation and not item.is_repeatable
            ),
            None,
        )
        if not course_list:
            course_list = CourseList(
                node_id=node.id,
                name='体育课程',
                order_index=0,
                raw='physical_education:auto',
                course_category='体育',
                requirement_type='credits',
                requirement_min=required_credits,
                requirement_max=required_credits,
                filters={'course_type': ['体育']},
                is_repeatable=False,
                is_dissertation=False,
                qualification_rules=[{'min_credits': required_credits}],
            )
            db.session.add(course_list)
        else:
            course_list.raw = 'physical_education:auto'
            course_list.course_category = '体育'
            course_list.requirement_type = 'credits'
            course_list.requirement_min = required_credits
            course_list.requirement_max = required_credits
            course_list.filters = {'course_type': ['体育']}
            course_list.qualification_rules = [{'min_credits': required_credits}]
        db.session.flush()
        return course_list

    def _migrate_physical_education_assignments(
        self,
        physical_results: Dict[int, Dict],
    ) -> None:
        """Persist the selected physical courses into the canonical list."""
        selected_to_list: Dict[str, int] = {}
        matched_uuids: Set[str] = set()
        for result in physical_results.values():
            requirement = result.get('physical_education_requirement', {})
            course_list_id = requirement.get('course_list_id')
            matched = set(requirement.get('matched_source_uuids', []))
            matched_uuids.update(matched)
            if course_list_id:
                for source_uuid in requirement.get('selected_source_uuids', []):
                    selected_to_list[source_uuid] = course_list_id

        if not matched_uuids:
            return

        assignments = CourseListAssignment.query.filter(
            CourseListAssignment.user_id == self.user_id,
            CourseListAssignment.source_type == 'course',
            CourseListAssignment.source_uuid.in_(list(matched_uuids)),
        ).all()
        assignments_by_uuid = {assignment.source_uuid: assignment for assignment in assignments}

        for source_uuid in matched_uuids:
            target_list_id = selected_to_list.get(source_uuid)
            assignment = assignments_by_uuid.get(source_uuid)
            if target_list_id:
                if not assignment:
                    assignment = CourseListAssignment(
                        user_id=self.user_id,
                        course_list_id=target_list_id,
                        source_type='course',
                        source_uuid=source_uuid,
                    )
                    db.session.add(assignment)
                else:
                    assignment.course_list_id = target_list_id
            elif assignment:
                # Courses beyond the plan's required credits must not remain
                # attached to an old ordinary/体育 list after migration.
                assignment.course_list_id = None

        CourseListAssignment.query.filter(
            CourseListAssignment.user_id == self.user_id,
            CourseListAssignment.source_type == PHYSICAL_EDUCATION_EXCLUDED_SOURCE_TYPE,
            CourseListAssignment.source_uuid.in_(list(matched_uuids)),
        ).delete(synchronize_session=False)
        db.session.commit()

    def _load_existing_assignments(self, channel: int, all_uuids: Optional[Set[str]] = None) -> Dict[str, Optional[int]]:
        """从数据库加载现有的分配关系"""
        # 获取本通道的所有课程uuid
        if all_uuids is None:
            all_uuids = self._collect_course_uuids(channel)
        
        # 查询这些课程的现有分配
        assignments = CourseListAssignment.query.filter(
            CourseListAssignment.user_id == self.user_id,
            CourseListAssignment.source_uuid.in_(list(all_uuids)),
            CourseListAssignment.source_type == 'course'
        ).all()
        
        # 构建 {uuid: course_list_id or None} 字典
        result = {}
        for uuid in all_uuids:
            result[uuid] = None  # 默认未分配
        
        for a in assignments:
            result[a.source_uuid] = a.course_list_id
        
        return result
    
    def calculate_all(self) -> Dict:
        """计算用户所有培养方案的进度"""
        user = User.query.get(self.user_id)
        if not user:
            raise ValueError(f"User {self.user_id} not found")
        
        results = {
            'major': None,
            'minor': None
        }
        
        if user.major_program_id:
            results['major'] = self.calculate(user.major_program_id, channel=0)
        
        if user.minor_program_id:
            results['minor'] = self.calculate(user.minor_program_id, channel=1)
        
        return results
    
    def _collect_course_uuids(self, channel: int) -> Set[str]:
        """收集所有课程的 uuid"""
        uuids = set()
        
        # 从成绩单收集
        transcripts = Transcript.query.filter_by(
            user_id=self.user_id,
            channel=channel
        ).filter(Transcript.score != 'W').all()
        
        for t in transcripts:
            uuids.add(t.uuid)
        
        # 从已选课程收集
        selected = SelectedCourse.query.filter_by(
            user_id=self.user_id,
            channel=channel
        ).all()
        
        for s in selected:
            uuids.add(s.course_uuid)
        
        return uuids
    
    def recalculate(self):
        """重新计算所有归属"""
        user = User.query.get(self.user_id)
        if not user:
            return
        
        # Clear normal assignments and legacy/manual English exclusions so a
        # recalculation can assign every eligible course again.
        CourseListAssignment.query.filter_by(
            user_id=self.user_id
        ).update({'course_list_id': None})
        CourseListAssignment.query.filter_by(
            user_id=self.user_id,
            source_type='college_english_excluded',
        ).delete()
        db.session.commit()
        
        # 重新计算 - 传入 auto_distribute=True
        if user.major_program_id:
            self.calculate(user.major_program_id, channel=0, auto_distribute=True)
        
        if user.minor_program_id:
            self.calculate(user.minor_program_id, channel=1, auto_distribute=True)
