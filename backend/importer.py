import json
import os
from datetime import datetime
from database import db
from models import Course, CourseNameMapping, Semester

def validate_course_data(data):
    required_fields = ['uuid', 'course_id', 'course_name', 'department_code', 'credits', 'class_times']
    for field in required_fields:
        if field not in data:
            return False, f"Missing field: {field}"
    return True, ""

def migrate_class_times_format(class_times, week_range=None):
    """
    将旧格式（课程级别 week_range）转换为新格式（每个时段自己的 week_range）
    """
    if not class_times or not isinstance(class_times, list):
        return []
    
    migrated = []
    for time in class_times:
        # 如果时段已经有 week_range，保留它
        if 'week_range' in time and time['week_range']:
            migrated.append(time)
        else:
            # 使用课程级别的 week_range
            new_time = {**time}
            if week_range:
                new_time['week_range'] = week_range
            migrated.append(new_time)
    
    return migrated

def import_courses_from_json(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        metadata = data.get('metadata')
        courses_data = data.get('courses')
        
        if not metadata or not courses_data:
            return False, "Invalid JSON format: missing metadata or courses"
            
        # Check version if needed
        if metadata.get('format_version') != "1.0":
            return False, "Unsupported format version"

        added_count = 0
        updated_count = 0
        
        semester = metadata.get('yearandseme')
        
        # 检查学期是否存在
        if semester:
            semester_config = Semester.query.filter_by(name=semester).first()
            if not semester_config:
                return False, f"学期 '{semester}' 不存在，请先创建学期"
        
        for course_dict in courses_data:
            is_valid, error_msg = validate_course_data(course_dict)
            if not is_valid:
                print(f"Skipping invalid course: {error_msg}")
                continue
            
            # 创建或更新课程名称映射（包含学分）
            mapping = CourseNameMapping.query.filter_by(course_id=course_dict['course_id']).first()
            if not mapping:
                mapping = CourseNameMapping(
                    course_id=course_dict['course_id'],
                    course_name=course_dict['course_name'],
                    credits=float(course_dict['credits'])
                )
                db.session.add(mapping)
            else:
                mapping.course_name = course_dict['course_name']
                mapping.credits = float(course_dict['credits'])
            
            # 迁移 class_times 格式（兼容旧数据）
            class_times = migrate_class_times_format(
                course_dict.get('class_times', []),
                course_dict.get('week_range')  # 旧格式可能有的课程级别 week_range
            )
            
            # Check if course exists
            existing_course = db.session.get(Course, course_dict['uuid'])
            
            if existing_course:
                # Update existing
                existing_course.course_id = course_dict['course_id']
                existing_course.course_type = course_dict.get('course_type')
                existing_course.department_code = course_dict['department_code']
                existing_course.class_number = course_dict.get('class_number')
                existing_course.semester = semester
                existing_course.class_times = class_times
                existing_course.teachers = course_dict.get('teachers', [])
                existing_course.remarks = course_dict.get('remarks')
                updated_count += 1
            else:
                # Create new
                new_course = Course(
                    uuid=course_dict['uuid'],
                    course_id=course_dict['course_id'],
                    course_type=course_dict.get('course_type'),
                    department_code=course_dict['department_code'],
                    class_number=course_dict.get('class_number'),
                    semester=semester,
                    class_times=class_times,
                    teachers=course_dict.get('teachers', []),
                    remarks=course_dict.get('remarks')
                )
                db.session.add(new_course)
                added_count += 1
        
        db.session.commit()
        return True, f"Successfully imported {added_count} new courses, updated {updated_count} courses."
        
    except Exception as e:
        db.session.rollback()
        return False, str(e)
