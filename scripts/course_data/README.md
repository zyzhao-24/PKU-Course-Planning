# Course Data Tools

该目录包含课程数据的离线抓取和格式化工具，不参与桌面应用的日常运行。

## 安装依赖

```powershell
python -m pip install -r scripts/course_data/requirements.txt
```

## 抓取课程数据

```powershell
python scripts/course_data/crawl_courses.py --year 26-27-1
```

可选参数：

- `--type`：课程类型编号，默认为 `0`，表示不限制。
- `--dept`：开课单位编号，默认为 `0`，表示不限制。
- `--concurrent`：最大并发请求数，默认为 `20`。

原始结果会写入 `scripts/course_data/raw/RawCourses_<学期>.json`。

## 转换为应用导入格式

```powershell
python scripts/course_data/format_courses.py
```

脚本会转换 `raw/` 下的所有 JSON，并将结果写入 `scripts/course_data/courses/`。随后可以在应用的“课程与学期”页面导入相应的 `Courses_<学期>.json`。

`raw/` 和 `courses/` 都是可重新生成的数据目录，已在 `.gitignore` 中排除。
