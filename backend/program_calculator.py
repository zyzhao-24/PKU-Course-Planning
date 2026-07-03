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
    SelectedCourse, Course, CourseNameMapping
)
from database import db
from typing import List, Dict, Any, Optional, Set, Tuple
from collections import defaultdict


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
        
        # 获取成绩信息
        score = None
        has_grade = False
        if transcript and transcript.score != 'W':
            score = transcript.score
            has_grade = True
        
        # 获取用于匹配的字段
        dept_code = course.department_code if course else (transcript.course_id[:3] if transcript and len(transcript.course_id) >= 3 else None)
        course_type = course.course_type if course else None
        teachers = course.teachers if course else None
        
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
        
        for category in program.categories:
            for node in category.nodes:
                for cl in node.course_lists:
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
    
    def __init__(self, user_id: int, channel: int):
        self.user_id = user_id
        self.channel = channel
    
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
    
    def __init__(self, user_id: int, channel: int, program_id: int):
        self.user_id = user_id
        self.channel = channel
        self.program_id = program_id
        self.result_builder = CourseListResultBuilder(user_id, channel)
    
    def calculate(self, node: Node, 
                  non_repeatable_assignments: Dict[str, Optional[int]],
                  repeatable_results: Dict[int, List[Dict]]) -> Dict:
        """
        计算节点的学分、门数和合格状态
        """
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
    
    def __init__(self, user_id: int, channel: int):
        self.user_id = user_id
        self.channel = channel
    
    def collect(self) -> List[Dict]:
        """收集未分配的课程（只包含本通道的）"""
        # 获取本通道的所有课程uuid
        uuids = self._collect_course_uuids()
        
        # 查询这些课程中未分配的
        assignments = CourseListAssignment.query.filter(
            CourseListAssignment.user_id == self.user_id,
            CourseListAssignment.source_type == 'course',
            CourseListAssignment.source_uuid.in_(list(uuids)),
            CourseListAssignment.course_list_id == None
        ).all()
        
        courses = []
        for a in assignments:
            info = CourseInfoResolver.resolve(self.user_id, a.source_uuid, self.channel)
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
        
        # 2. 只在recalculate时执行自动分配，否则读取现有分配
        if auto_distribute:
            distributor = NonRepeatableDistributor(self.user_id, channel, program_id)
            non_repeatable_assignments = distributor.distribute(all_uuids)
        else:
            # 读取现有的分配（从数据库查询）
            non_repeatable_assignments = self._load_existing_assignments(channel)
        
        # 3. 计算可重复列表（当场计算，不保存）
        repeatable_calc = RepeatableCalculator(self.user_id, channel, program_id)
        repeatable_results = repeatable_calc.calculate(all_uuids)
        
        # 4. 计算每个主类别
        node_calc = NodeCalculator(self.user_id, channel, program_id)
        
        category_results = []
        for category in program.categories:
            root_nodes = Node.query.filter_by(
                main_category_id=category.id,
                parent_id=None
            ).order_by(Node.order_index).all()
            
            node_results = [node_calc.calculate(node, non_repeatable_assignments, repeatable_results) 
                          for node in root_nodes]
            
            category_results.append({
                'id': category.id,
                'name': category.name,
                'nodes': node_results,
                'credits': sum(n['credits'] for n in node_results),
                'course_count': sum(n['course_count'] for n in node_results),
                'qualified': all(n['qualified'] for n in node_results)
            })
        
        # 5. 获取未分配课程（只显示本通道）
        unassigned = UnassignedCollector(self.user_id, channel).collect()
        
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
    
    def _load_existing_assignments(self, channel: int) -> Dict[str, Optional[int]]:
        """从数据库加载现有的分配关系"""
        # 获取本通道的所有课程uuid
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
        
        # 清除旧的分配（但保留记录）
        CourseListAssignment.query.filter_by(
            user_id=self.user_id
        ).update({'course_list_id': None})
        db.session.commit()
        
        # 重新计算 - 传入 auto_distribute=True
        if user.major_program_id:
            self.calculate(user.major_program_id, channel=0, auto_distribute=True)
        
        if user.minor_program_id:
            self.calculate(user.minor_program_id, channel=1, auto_distribute=True)
