#!/usr/bin/env python3
"""
format_courses.py - Convert raw course data into the application's import format.

Read raw JSON files from the sibling 'raw' directory, process and convert
the course data into a standardized format, and save the formatted data
to the sibling 'courses' directory.

The output format follows the course data structure defined in requirements.md:
{
  "uuid": "执行计划编号",
  "course_id": "课程号", 
  "course_name": "课程名称",
  "course_type": "课程性质",
  "department_code": "学院编码",
  "class_number": "班号",
  "credits": 学分,
  "week_range": "周次范围字符串",
  "class_times": [
    {
      "day": 1,           // 星期几（1-7）
      "start_period": 1,  // 开始节次
      "end_period": 2,    // 结束节次  
      "week_type": 0（全部周次）/1（单周）/2（双周）
    }
  ],
  "teachers": ["教师列表"],
  "remarks": "备注"
}
"""

import json
import os
import re
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Mapping of Chinese weekdays to numbers
DAY_MAP = {
    "星期一": 1, "星期二": 2, "星期三": 3, "星期四": 4,
    "星期五": 5, "星期六": 6, "星期日": 7
}

# Mapping of department names to their codes
DEPARTMENT_CODE_MAP = {
    "数学科学学院": "00001",
    "力学与工程科学学院": "00003",
    "物理学院": "00004",
    "化学与分子工程学院": "00010",
    "生命科学学院": "00011",
    "地球与空间科学学院": "00012",
    "心理与认知科学学院": "00016",
    "软件与微电子学院": "00017",
    "新闻与传播学院": "00018",
    "中国语言文学系": "00020",
    "历史学系": "00021",
    "考古文博学院": "00022",
    "哲学系": "00023",
    "国际关系学院": "00024",
    "经济学院": "00025",
    "光华管理学院": "00028",
    "法学院": "00029",
    "信息管理系": "00030",
    "社会学系": "00031",
    "政府管理学院": "00032",
    "英语语言文学系": "00038",
    "外国语学院": "00039",
    "马克思主义学院": "00040",
    "体育教研部": "00041",
    "艺术学院": "00043",
    "对外汉语教育学院": "00044",
    "元培学院": "00046",
    "深圳研究生院": "00047",
    "信息科学技术学院": "00048",
    "国家发展研究院": "00062",
    "教育学院": "00067",
    "人口研究所": "00068",
    "前沿交叉学科研究院": "00084",
    "工学院": "00086",
    "集成电路学院": "00100",
    "计算机学院": "00101",
    "智能学院": "00106",
    "电子学院": "00107",
    "城市与环境学院": "00126",
    "环境科学与工程学院": "00127",
    "中国社会科学调查中心": "00187",
    "建筑与景观设计学院": "00195",
    "汇丰商学院": "00201",
    "新媒体研究院": "00206",
    "燕京学堂": "00208",
    "现代农学院": "00211",
    "南南合作与发展学院": "00217",
    "习近平新时代中国特色社会主义思想研究院": "00221",
    "人工智能研究院": "00225",
    "材料科学与工程学院": "00232",
    "未来技术学院": "00233",
    "先进制造与机器人学院": "00240",
    "学生工作部人民武装部": "00607",
    "教务部": "00612",
    "研究生院": "00614",
    "中国共产主义青年团北京大学委员会": "00651",
    "创新创业学院": "00671",
    "医学部教学办": "10180",
    "国际合作部": "00610",
    "歌剧研究院": "00192",
    "产业技术研究院": "00199",
}


def parse_class_time(time_str: str) -> Optional[Dict[str, Any]]:
    """
    Parse a single class time string into structured data,
    containing day, start_period, end_period, and week_type.
    
    Args:
        time_str (str): Class time string, e.g.: "星期三(第1节-第2节)(单)"
    
    Returns:
        result (Optional[Dict[str, Any]]): A dictionary containing day, start_period, end_period, and week_type,
        or None if parsing fails.
    """
    if not time_str or not time_str.strip():
        return None
    
    pattern = r'([一二三四五六日]+)(?:\(第(\d+)节-第(\d+)节\))(?:\(([单双])\))?'
    match = re.search(pattern, time_str)
    
    if not match:
        pattern2 = r'([一二三四五六日]+)\(第(\d+)节-第(\d+)节\)'
        match = re.search(pattern2, time_str)
        if not match:
            logger.warning(f"Failed to parse time string: {time_str}")
            return None
    
    day_chinese = match.group(1)
    start_period = int(match.group(2))
    end_period = int(match.group(3))
    
    # 转换星期
    day_key = f"星期{day_chinese}" if len(day_chinese) == 1 else day_chinese
    day = DAY_MAP.get(day_key)
    if not day:
        logger.warning(f"Unrecognized day: {day_key} (Original: {time_str})")
        return None
    
    # 确定周次类型：0=全部周次，1=单周，2=双周
    week_type = 0  # 默认全部周次
    if len(match.groups()) > 3 and match.group(4):
        if match.group(4) == "单":
            week_type = 1
        elif match.group(4) == "双":
            week_type = 2
    
    return {
        "day": day,
        "start_period": start_period,
        "end_period": end_period,
        "week_type": week_type
    }


def parse_html_teachers(teacher_html: str) -> List[str]:
    """
    Parse teacher information from HTML format and extract a list of teacher names.
    
    Args:
        teacher_html (str): HTML string containing teacher names, e.g.: "<p>教师1</p><p>教师2</p>"
    
    Returns:
        teachers (List[str]): A list of teacher names extracted from the HTML.
    """
    if not teacher_html:
        return []
    
    # 提取<p>标签内的内容
    teacher_pattern = r'<p>([^<]+)</p>'
    teachers = re.findall(teacher_pattern, teacher_html)
    
    # 清理空白字符
    teachers = [t.strip() for t in teachers if t.strip()]
    
    return teachers


def parse_class_times(sksj_html: str) -> List[Dict[str, Any]]:
    """
    Parse all class times from HTML format into a list of structured data.
    
    Args:
        sksj_html (str): HTML string containing class times, e.g.: "<p>星期一(第7节-第8节)</p><p>星期三(第1节-第2节)(单)</p>"
    
    Returns:
        class_times (List[Dict[str, Any]]): A list of class time dictionaries.
    """
    if not sksj_html:
        return []
    
    time_pattern = r'<p>([^<]+)</p>'
    time_strings = re.findall(time_pattern, sksj_html)
    
    class_times = []
    for time_str in time_strings:
        class_time = parse_class_time(time_str)
        if class_time:
            class_times.append(class_time)
    
    return class_times

def convert_course(raw_course: Dict[str, Any], metadata: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert a single raw course entry into the standardized format.

    Args:
        raw_course (Dict[str, Any]): The raw course data.
        metadata (Dict[str, Any]): Additional metadata.

    Returns:
        formatted_course (Dict[str, Any]): The course data in standardized format.
    """
    department_name = raw_course.get("kkxsmc", "")
    department_code = DEPARTMENT_CODE_MAP.get(department_name, "0")
    
    teachers = parse_html_teachers(raw_course.get("teacher", ""))
    
    class_times = parse_class_times(raw_course.get("sksj", ""))
    
    credits_str = raw_course.get("xf", "0")
    try:
        credits = float(credits_str) if credits_str else 0.0
    except (ValueError, TypeError):
        credits = 0.0
        logger.warning(f"Failed to parse credits: {credits_str} (Course: {raw_course.get('kcmc', 'Unknown')})")
    
    # Construct the standardized course data
    formatted_course = {
        "uuid": raw_course.get("zxjhbh", ""),
        "course_id": raw_course.get("kch", ""),
        "course_name": raw_course.get("kcmc", ""),
        "course_type": raw_course.get("kctxm", ""),
        "department_code": department_code,
        "class_number": raw_course.get("jxbh", ""),
        "credits": credits,
        "week_range": raw_course.get("qzz", ""),
        "class_times": class_times,
        "teachers": teachers,
        "remarks": raw_course.get("bz", "")
    }
    
    return formatted_course

def process_raw_file(raw_file_path: Path, output_dir: Path) -> bool:
    """
    Process a single raw data file.

    Args:
        raw_file_path (Path): Path to the raw JSON file.
        output_dir (Path): Directory to save the formatted JSON file.

    Returns:
        success (bool): True if processing was successful, False otherwise.
    """
    try:
        logger.info(f"Processing file: {raw_file_path}")
        
        # Read raw data
        with open(raw_file_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)
        
        # Extract metadata and course list
        metadata = raw_data.get("metadata", {})
        if isinstance(metadata, list):
            metadata = metadata[0] if metadata else {}
        
        metadata["format_version"] = "1.0"
        raw_courses = raw_data.get("courses", [])
        
        if not raw_courses:
            logger.warning(f"No course data in file: {raw_file_path}")
            return False
        
        # Convert all courses
        formatted_courses = []
        for raw_course in raw_courses:
            formatted_course = convert_course(raw_course, metadata)
            formatted_courses.append(formatted_course)
        
        # Prepare output data
        output_data = {
            "metadata": metadata,
            "courses": formatted_courses,
        }
        
        # Generate output filename
        year_seme = metadata.get("yearandseme", "unknown")
        department = metadata.get("yuanxi", "unknown")
        coursetype = metadata.get("coursetype", "unknown")

        yx = "_"+department if department != "0" else ""
        ct = "_"+coursetype if coursetype != "0" else ""

        output_filename = f"Courses_{year_seme}{ct}{yx}.json"
        output_path = output_dir / output_filename
        
        # Save to file
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=4)
        
        logger.info(f"Successfully processed {len(formatted_courses)} courses, saved to: {output_path}")
        return True
        
    except Exception as e:
        logger.error(f"Error processing file {raw_file_path}: {e}", exc_info=True)
        return False


def main():
    """Main function"""
    # Define paths
    current_dir = Path(__file__).parent
    raw_data_dir = current_dir / "raw"
    output_dir = current_dir / "courses"
    
    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Check if raw data directory exists
    if not raw_data_dir.exists():
        logger.error(f"Raw data directory does not exist: {raw_data_dir}")
        return
    
    # Find all JSON files
    raw_files = list(raw_data_dir.glob("*.json"))
    if not raw_files:
        logger.warning(f"No JSON files found in {raw_data_dir}")
        return
    
    logger.info(f"Found {len(raw_files)} raw data files")
    
    # Process each file
    success_count = 0
    for raw_file in raw_files:
        if process_raw_file(raw_file, output_dir):
            success_count += 1
    
    # Output summary
    logger.info(f"Processing completed: {success_count}/{len(raw_files)} files succeeded")
    
    if success_count > 0:
        logger.info(f"Formatted data saved in: {output_dir}")
    else:
        logger.error("No files were successfully processed")


if __name__ == "__main__":
    main()
