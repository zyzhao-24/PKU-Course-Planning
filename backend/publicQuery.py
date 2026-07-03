from client import Portal2017LoginClient
import re

def _parse_schedule(schedule_json: dict) -> dict:
    """
    Parse the schedule JSON.

    :param schedule_json: The raw schedule JSON obtained from the portal.
    :type schedule_json: dict
    :return: A structured dictionary containing course information.
    :rtype: dict

    ## Notes:
    ### Successful response structure:
    ```
    {
        "success": True, # indicates successful parsing
        "course": [
            {
                "course_name": "计算机系统导论", # course name
                "channel": 0,                   # 0: "主修", 1: "辅双"
                "class_times": [                # list of class time entries, may be empty
                    {
                        "day": 1,               # 1-7 for Monday-Sunday
                        "week_range": "1-16",   # e.g. "1,5-16"
                        "start_period": 5,      # starting period (e.g. 1 for first period)
                        "end_period": 6,        # ending period (inclusive)
                        "week_type": 0,         # 0: every week, 1: odd weeks, 2: even weeks
                        "location": "一教201"   # classroom location, may be empty string if not available
                    },
                    {
                        "day": 4,
                        "week_range": "1-16",
                        "start_period": 5,
                        "end_period": 6,
                        "week_type": 0,
                        "location": "一教201"
                    }
                ],
                "exam": {                        # final exam information, may be empty dict if no exam arranged
                    "date": "20251229",          # exam date in YYYYMMDD format
                    "period": 2,                 # 1: morning, 2: afternoon, 3: evening
                    "location": "二教301,二教309" # exam location, may be empty string if not available
                },
                "remarks": "小班课上课时间：每周三10-11节课。请选大班的同学空出小班上课时间，小班会手动添加，冲突选课无法添加。" # course remarks, may be empty string if no remarks
            },
            ...
        ]
        "year": "xx-xx", # e.g. "24-25"
        "semester": "x"  # "1", "2", or "3"
    }
    ```
    ### Failure response structure:
    ```
    {
        "success": False,
        "msg": "Error message describing the failure"
    }
    ```
    """
    if not schedule_json.get("success"):
        return {
            "success": False,
            "msg": "Schedule request was not successful"
        }

    courses_map = {} # Key: course_name, Value: course_dict
    
    # Mapping for days
    day_map = {
        "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 7
    }
    
    period_map = {
        "第一节": 1, "第二节": 2, "第三节": 3, "第四节": 4, "第五节": 5,
        "第六节": 6, "第七节": 7, "第八节": 8, "第九节": 9, "第十节": 10,
        "第十一节": 11, "第十二节": 12
    }
    # Pre-process rows to determine periods
    # Assumes "timeNum": "第一节" maps to period 1, etc.
    rows = schedule_json.get("course", [])
    
    for row in rows:
        # Fallback period index if timeNum mapping is complex, 
        # usually row index corresponds to 1..12 or 1..N
        period = row.get("timeNum", "")
        if period in period_map:
            period = period_map[period]
        else:
            period = 0 # Default to 0 if not recognized
        
        for day_key, day_num in day_map.items():
            cell = row.get(day_key, {})
            # Content example: "Course(Type)<br>上课信息：...<br>考试信息：..."
            content = cell.get("courseName", "")
            
            if not content:
                continue
                
            # Split content by <br> or similar
            parts = re.split(r'<br>', content)
            
            # Identify where new courses start in the parts list.
            # A part is likely a new course header if it does NOT start with "上课信息" or "考试信息"
            # and is not empty.
            
            course_indices = []
            for i, p in enumerate(parts):
                p = p.strip()
                if not p: continue
                # Remove common HTML tags for checking logic
                p_clean = re.sub(r'<[^>]+>', '', p).strip()
                if not p_clean: continue
                
                if not (p_clean.startswith("上课信息：") or p_clean.startswith("考试信息：")):
                    course_indices.append(i)
            
            # If no course found but content exists, assume first non-empty part is header
            if not course_indices and parts:
                for i, p in enumerate(parts):
                    if p.strip():
                        course_indices.append(i)
                        break

            # Process each course segment in this cell
            for i in range(len(course_indices)):
                start_idx = course_indices[i]
                end_idx = course_indices[i+1] if i + 1 < len(course_indices) else len(parts)
                
                segment_parts = parts[start_idx:end_idx]
                if not segment_parts: continue
                
                # 1. Course Name and Type
                header = segment_parts[0].strip()
                # Remove HTML tags from header if present (e.g. font tags in user example)
                header_clean = re.sub(r'<[^>]+>', '', header).strip()
                
                match = re.match(r'(.*)\((.*?)\)$', header_clean)
                if match:
                    course_name = match.group(1).strip()
                    channel = 1 if match.group(2).strip()!="主" else 0
                    # treat "主" as channel 0, "辅双" as channel 1; any other type: treat as chn 1
                else:
                    course_name = header_clean
                    channel = 0
                
                if not course_name: continue

                # Initialize course entry if new
                if course_name not in courses_map:
                    courses_map[course_name] = {
                        "course_name": course_name,
                        "channel": channel,
                        "class_times": [],
                        "exam": {},
                        "remarks": ""
                    }
                
                course_entry = courses_map[course_name]

                # 2. Iterate remaining parts of this segment
                
                # Variables for this specific cell (period/day)
                cell_location = ""
                cell_week_range = ""
                cell_week_type = 0
                
                # Variables for course-level info found in this cell
                current_exam = {}
                current_remarks = ""
                
                found_class_info = False

                for part in segment_parts[1:]:
                    part_clean = re.sub(r'<[^>]+>', '', part).strip() # clean HTML
                    if not part_clean: continue
                    
                    if part_clean.startswith("上课信息："):
                        found_class_info = True
                        # Format: 上课信息：1-16周 每周 理教307 教师：... 备注：...
                        info_str = part_clean[5:].strip()
                        
                        # Extract Remarks
                        r_match = re.search(r'备注：(.*)', info_str)
                        if r_match:
                            current_remarks = r_match.group(1).strip()
                        
                        # Extract Time/Location part
                        time_loc_part = info_str
                        # Teacher parsing SKIPPED intentionally
                        # If teacher is present, we need to locate it to slice string
                        t_idx = info_str.find("教师：")
                        if t_idx != -1:
                             time_loc_part = info_str[:t_idx]
                        elif r_match:
                            time_loc_part = time_loc_part[:r_match.start()]
                        
                        # Parse weeks: "12-12,16-16,6-6周" or "1-16周"
                        w_match = re.search(r'([\d,\-]+)周', time_loc_part)
                        if w_match:
                            raw_weeks = w_match.group(1)
                            # Parse complex ranges like "12-12,16-16,6-6" -> "6,12,16"
                            week_segs = raw_weeks.split(',')
                            normalized_segs = []
                            for seg in week_segs:
                                if '-' in seg:
                                    s_str, e_str = seg.split('-')
                                    if s_str.isdigit() and e_str.isdigit():
                                        s, e = int(s_str), int(e_str)
                                        if s == e:
                                            normalized_segs.append(s)
                                        else:
                                            normalized_segs.append(seg) # Keep range
                                    else:
                                         normalized_segs.append(seg)
                                else:
                                    normalized_segs.append(int(seg) if seg.isdigit() else seg)
                            
                            def parse_range_val(v):
                                if isinstance(v, int): return v
                                if isinstance(v, str) and '-' in v: 
                                    parts = v.split('-')
                                    if parts[0].isdigit():
                                        return int(parts[0])
                                return 999
                                
                            normalized_segs.sort(key=parse_range_val)
                            cell_week_range = ",".join(str(x) for x in normalized_segs)
                        else:
                            cell_week_range = ""
                        
                        # Parse frequency
                        if "单周" in time_loc_part: cell_week_type = 1
                        elif "双周" in time_loc_part: cell_week_type = 2
                        
                        # Parse Location
                        loc_clean = time_loc_part
                        if w_match:
                            loc_clean = loc_clean.replace(w_match.group(0), "")
                        cell_location = loc_clean.replace("每周", "").replace("单周", "").replace("双周", "").replace("上课信息：","").strip()
                        
                    elif part_clean.startswith("考试信息："):
                        exam_info_str = part_clean[5:].strip()
                        if len(exam_info_str) > 5:
                            date_match = re.search(r'\d{8}', exam_info_str)
                            if date_match:
                                current_exam['date'] = date_match.group(0)
                            
                            if "上午" in exam_info_str: current_exam['period'] = 1
                            elif "下午" in exam_info_str: current_exam['period'] = 2
                            elif "晚上" in exam_info_str: current_exam['period'] = 3
                            
                            # Parse Exam Location
                            eloc = exam_info_str
                            if date_match: eloc = eloc.replace(date_match.group(0), "")
                            for kw in ["星期一","星期二","星期三","星期四","星期五","星期六","星期七","上午","下午","晚上"]:
                                eloc = eloc.replace(kw, "")
                            current_exam['location'] = eloc.strip().strip(",").strip()
                
                # --- Update Course Level Info ---
                if current_exam and not course_entry["exam"]:
                    course_entry["exam"] = current_exam
                if current_remarks and len(current_remarks) > len(course_entry["remarks"]):
                    course_entry["remarks"] = current_remarks

                # --- Merge/Add Class Info ---
                if found_class_info:
                    times_list = course_entry["class_times"]
                    merged = False
                    for t in times_list:
                        if (t["day"] == day_num and 
                            t["week_range"] == cell_week_range and 
                            t["week_type"] == cell_week_type and
                            t["location"] == cell_location): # Merge if same time slot properties
                            
                            # Check continuity
                            if t["end_period"] == period - 1:
                                t["end_period"] = period
                                merged = True
                                break
                    
                    if not merged:
                        times_list.append({
                            "day": day_num,
                            "week_range": cell_week_range,
                            "start_period": period,
                            "end_period": period,
                            "week_type": cell_week_type,
                            "location": cell_location
                        })
    
    # Process "remark" field for courses without class times
    # Format: ...未在下面显示的课程还有：<br>Course1(Type)<br>Course2(Type) 备注：...<br>...</span>
    remark_html = schedule_json.get("remark", "")
    if "未在下面显示的课程还有：" in remark_html:
        # Extract content after "未在下面显示的课程还有："
        # Locate the start marker
        start_marker = "未在下面显示的课程还有："
        start_idx = remark_html.find(start_marker)
        if start_idx != -1:
            content_after = remark_html[start_idx + len(start_marker):]
            # Split by <br> similar to normal cells
            r_parts = re.split(r'<br>', content_after)
            
            for part in r_parts:
                part = re.sub(r'<[^>]+>', '', part).strip() # clean HTML
                if not part: continue
                
                # Check if it looks like a course header: "Name(Type)"
                # Optionally it might have remarks attached? "Name(Type) 备注：..."
                
                # Split name/type and remarks if present
                r_remarks = ""
                r_course_part = part
                
                remark_match = re.search(r'\s+备注：(.*)；', part)
                if remark_match:
                    r_remarks = remark_match.group(1).strip()
                    r_course_part = part[:remark_match.start()].strip()
                
                match = re.match(r'(.*)\((.*?)\)$', r_course_part)
                if match:
                    course_name = match.group(1).strip()
                    channel = 1 if match.group(2).strip() != "主" else 0
                else:
                    course_name = r_course_part.strip()
                    channel = 0
                
                if course_name and course_name not in courses_map:
                        courses_map[course_name] = {
                        "course_name": course_name,
                        "channel": channel,
                        "class_times": [],
                        "exam": {},
                        "remarks": r_remarks
                    }
                elif course_name and course_name in courses_map:
                    if r_remarks and len(r_remarks) > len(courses_map[course_name]["remarks"]):
                        courses_map[course_name]["remarks"] = r_remarks
                
    return {
        "success": True,
        "course": list(courses_map.values())
    }

def get_schedule(client: Portal2017LoginClient, year: str, semester: str) -> dict:
    '''
    Get schedule from an logged-in portal session.

    :param client: Logged-in Portal2017LoginClient instance.
    :type client: Portal2017LoginClient
    :param year: Academic year (e.g., "24-25").
    :type year: str
    :param semester: Semester ("1", "2" or "3").
    :type semester: str
    :return: Schedule data.
    :rtype: dict

    ## Notes:
    See docs for _parse_schedule for response structure details.
    '''
    login_status = client.chk_login_status()
    if not login_status.get("success"):
        return {
            "success": False,
            "msg": "Not authenticated"
        }
    client.portlet_redir("coursetable")

    params = {
        "xndxq": f"{year}-{semester}"
    }
    resp = client.get("https://portal.pku.edu.cn/publicQuery/ctrl/topic/myCourseTable/getCourseInfo.do", params=params)

    if resp.status_code == 200:
        try:
            json = resp.json()
            parsed = _parse_schedule(json)
            parsed["year"] = year
            parsed["semester"] = semester
            return parsed
        except Exception as e:
            return {
                "success": False,
                "msg": f"Failed to parse schedule data: {e}"
            }

def _parse_scores(scores_json: dict) -> dict:
    '''
    Parse the scores JSON.

    :param scores_json: The raw scores JSON obtained from the portal.
    :type scores_json: dict
    :return: A structured dictionary containing scores information.
    :rtype: dict
    
    ## Notes:
    ### Successful response structure:
    ```
    {
        "success": True,
        "transcripts": [
            {
                "year": "xx-xx", # e.g. "24-25"
                "semester": "x",  # "1", "2", or "3"
                "courses": [
                    {
                        "record_id": "bkcjxxxxxxxx",         # unique identifier for this score record
                        "uuid": "BZxxxxxxxx",                # unique identifier for the course
                        "course_id": "xxxxxxxx",             # course code
                        "class_number": "x",                 # class number
                        "course_name": "course name",        # course name
                        "score": "xx",                       # score value, an numerical string(int or fp) for percentage scores, 
                                                             # "A+"~"F" for grade scores, 
                                                             # or "P"/"NP"/"W"/"I"/"EX"/"IP" for pass/not pass courses or special cases
                        "score_type": "Percentage" or "Grade" or "P/NP",          # "Percentage" for percentage scores, 
                                                                                  # "Grade" for grade scores, 
                                                                                  # "P/NP" for pass/not pass courses or special cases
                        "credits": 2.0,                      # course credits, a float value
                        "additional_info": item              # unused items gathered here
                    },
                    ...
                ]
            },
            ...
        ],
        "minor_transcripts": [ # same structure as "transcripts", 
                               # but for minor courses if the student has any, 
                               # otherwise an empty list
            ...
        ],
        "exchange_transcripts": [
            {
                "year": "xx-xx", # e.g. "24-25"
                "semester": "x",  # "1", "2", or "3"
                "courses": [
                    {
                        "record_id": "xxx"                   # score conversion id
                        "course_name": "course name",
                        "course_english_name": "course english name",
                        "score": "score",                    # original score value
                        "score_type": "P/NP",                # all exchange courses treated as pass/not pass
                        "credits": credits,                  # credit assigned according to course duration and workload
                        "conversion_type": "学分认定" or "课程替代",               # type of the credit conversion for this exchange course
                        "additional_info": item              # due to that I don't have a sample with "zjlcjxx" containing actual data, 
                                                             # the structure of this field is not fully confirmed,
                                                             # so the unknown fields are gathered here
                                                             # ignore it for now
                    }
                ]
            },
            ...
        ],
        "dissertation_transcripts": {
            "complete": True or False,                       # whether the student has completed the dissertation

            # the following fields only exist when "complete" is true
            "title": "dissertation title",                   # dissertation title
            "english_title": "dissertation english title",   # dissertation english title
            "score": "score",                                # original score value
            "score_type": "Percentage" or "Grade" or "P/NP", # not sure if this field is the same as normal courses,
                                                             # but treating it as P/NP would not cause much problem even if it's not, 
                                                             # since dissertation scores are usually not counted in GPA calculation
            "credits": credits                               # credit assigned for the dissertation
            # additional information such as tutor information is ignored
        },
        "stu_type": "undergraduate" # student type, "undergraduate" or "graduate",
                                    # the rest values are not confirmed yet due to lack of samples, 
                                    # so parse it as "unknown"
                                    # note that if student type is "graduate",
                                    # the current parsing logic is invalid,
                                    # graduate courses are organized in different way and may contain different fields
        "stu_grade": "2024"         # student grade
    }
    ```
    ### Failure response structure:
    ```
    {
        "success": False,
        "msg": "Error message describing the failure"
    }
    ```
    '''
    if not scores_json.get("success"):
        return {
            "success": False,
            "msg": "Scores request was not successful"
        }

    def _parse_from_normal_transcript_structure(score_list: list, minor: bool) -> list:
        '''
        Helper: parse normal courses informations

        :param score_list: List of score data dictionaries.
        :type score_list: list
        :return: List of parsed transcript entries.
        :rtype: list
        '''
        transcripts = []
        for term_data in score_list:
            year = term_data.get("xnd")
            semester = term_data.get("xq")
            if not year or not semester:
                continue

            course_list = term_data.get("list", [])
            term_courses = []
            
            for item in course_list:
                student_type = item.get("xslb", "") # student type
                if minor and student_type != "辅双生":
                    continue
                if not minor and student_type == "辅双生":
                    continue

                # Field mapping
                record_id = item.get("bkcjbh", "")
                uuid = item.get("zxjhbh", "")
                course_id = item.get("kch", "")
                class_number = item.get("jxbh", "")
                course_name = item.get("kcmc", "")
                score = str(item.get("xqcj", ""))
                credits = float(item.get("xf", 0))
                
                # Convert pass/fail grades
                if score == "合格":
                    score = "P"
                elif score == "不合格":
                    score = "NP"
                
                # Determine score_type
                cjjlfs = item.get("cjjlfs", "")
                if cjjlfs == "百分制":
                    score_type = "Percentage"
                elif cjjlfs == "等级制":
                    score_type = "Grade"
                else: # cjjlfs == "合格制"
                    score_type = "P/NP"
                
                # clean up parsed traits
                for key in ["bkcjbh", "zxjhbh", "kch", "jxbh", "kcmc", "xqcj", "xf", "cjjlfs"]:
                    if key in item:
                        del item[key]
                
                course_entry = {
                    "record_id": record_id,
                    "uuid": uuid,
                    "course_id": course_id,
                    "class_number": class_number,
                    "course_name": course_name,
                    "score": score,
                    "score_type": score_type,
                    "credits": credits,
                    "additional_info": item # keep all other original fields for reference
                }
                term_courses.append(course_entry)
            
            transcript_entry = {
                "year": year,
                "semester": semester,
                "courses": term_courses
            }
            transcripts.append(transcript_entry)
        
        # sorting transcripts by year and semester in descending order (most recent first)
        transcripts.sort(key=lambda x: (x["year"], x["semester"]), reverse=True)
        return transcripts

    major_transcripts = _parse_from_normal_transcript_structure(scores_json.get("cjxx", []), False)
    minor_transcripts = _parse_from_normal_transcript_structure(scores_json.get("cjxx", []), True)

    exchange_list = scores_json.get("zjlcjxx", [])
    exchange_transcripts = []
    for term_data in exchange_list:
        year = term_data.get("xnd")
        semester = term_data.get("xq")
        if not year or not semester:
            continue

        course_list = term_data.get("list", [])
        term_courses = []
        
        for item in course_list:
            # Field mapping
            record_id = item.get("cjzhbh", "") # score conversion id
            course_name = item.get("kcmc", "")
            course_english_name = item.get("ywmc", "")
            score = str(item.get("xqcj", ""))
            credits = float(item.get("xf", 0))
            score_type = "P/NP" # all exchange courses treated as P/NP, no matter what the original score type is
            conversion_type =  item.get("zhlx", "") # 学分认定/课程替代
            
            # clean up parsed traits
            for key in ["cjzhbh", "kcmc", "ywmc", "xqcj", "xf", "zhlx"]:
                if key in item:
                    del item[key]

            course_entry = {
                "record_id": record_id,
                "course_name": course_name,
                "course_english_name": course_english_name,
                "score": score,
                "score_type": score_type,
                "credits": credits,
                "conversion_type": conversion_type,
                "additional_info": item # keep all other original fields for reference
            }
            term_courses.append(course_entry)
        
        transcript_entry = {
            "year": year,
            "semester": semester,
            "courses": term_courses
        }
        if term_courses:  # Only add the transcript if it has courses
            exchange_transcripts.append(transcript_entry)
    exchange_transcripts.sort(key=lambda x: (x["year"], x["semester"]), reverse=True)

    # parse dissertation score info
    dissertation_info = scores_json.get("bylwcjxx", {})
    if dissertation_info.get("sfybylw", "否") == "是":
        # Determine score_type
        cjlrfs = dissertation_info.get("cjlrfs", "")
        if cjlrfs == "百分制":
            score_type = "Percentage"
        elif cjlrfs == "等级制":
            score_type = "Grade"
        else: # cjlrfs == "合格制"
            score_type = "P/NP"

        dissertation_entry = {
            "complete": True,
            "title": dissertation_info.get("lwtm", ""),
            "english_title": dissertation_info.get("ylwtm", ""),
            "score": str(dissertation_info.get("bylwcj", "")),
            "score_type": score_type, # not sure if this field is the same as normal courses,
                                      # but treating it as P/NP would not cause much problem even if it's not, 
                                      # since dissertation scores are usually not counted in GPA calculation
            "credits": float(dissertation_info.get("xf", 0))
            # ignore tutor information
        }
    else:
        dissertation_entry = {
            "complete": False
        }
    # parse student type
    xslb = scores_json.get("xslb", "")
    if xslb == "bks":
        stu_type = "undergraduate"
    elif xslb == "yjs":
        stu_type = "graduate"
    else:
        stu_type = "unknown"
    
    return {
        "success": True,
        "transcripts": major_transcripts,
        "minor_transcripts": minor_transcripts,
        "exchange_transcripts": exchange_transcripts,
        "dissertation_transcripts": dissertation_entry,
        "stu_type": stu_type,
        "stu_grade": scores_json.get("grade", "")
    }

def get_scores(client: Portal2017LoginClient) -> dict:
    '''
    Get scores from an logged-in portal session.

    :param client: Logged-in Portal2017LoginClient instance.
    :type client: Portal2017LoginClient
    :return: Scores data.
    :rtype: dict

    ## Notes:
    See docs for _parse_scores for response structure details.
    '''
    client.portlet_redir("myscores")
    resp = client.get("https://portal.pku.edu.cn/publicQuery/ctrl/topic/myScore/retrScores.do")

    if resp.status_code == 200:
        try:
            json = resp.json()
            return _parse_scores(json)
        except Exception as e:
            return {
                "success": False,
                "msg": f"Failed to parse scores data: {e}"
            }
