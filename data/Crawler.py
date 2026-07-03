#!/usr/bin/env python3
'''
Crawler.py - Fetch raw course data from the server asynchronously.
'''

import asyncio
import aiohttp
import time
import json
import argparse
from typing import List, Dict, Any
from rich.progress import Progress

# 默认并发请求数
DEFAULT_CONCURRENT = 20
# 每个请求之间的最小间隔（秒）
REQUEST_DELAY = 0.1


async def requestCourseData(
    session: aiohttp.ClientSession,
    yearandseme: str,
    coursetype: str,
    yuanxi: str,
    start_row: int
) -> dict:
    """
    Send an async request to fetch course data.

    Args:
        session: aiohttp ClientSession instance.
        yearandseme (str): Academic year and semester.
        coursetype (str): Course type identifier.
        yuanxi (str): Department identifier.
        start_row (int): Starting row for pagination.

    Returns:
        dict: JSON response from the server.
    """
    url = "https://dean.pku.edu.cn/service/web/courseSearch_do.php"
    headers = {
        "accept": "*/*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7,en-GB;q=0.6,zh-TW;q=0.5",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "sec-ch-ua": "\"Chromium\";v=\"142\", \"Microsoft Edge\";v=\"142\", \"Not_A Brand\";v=\"99\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-requested-with": "XMLHttpRequest",
        "Host": "dean.pku.edu.cn",
        "Referer": "https://dean.pku.edu.cn/service/web/courseSearch.php"
    }

    body = {
        "coursename": "",
        "teachername": "",
        "yearandseme": yearandseme,
        "coursetype": coursetype,
        "yuanxi": yuanxi,
        "startrow": start_row
    }

    async with session.post(url, headers=headers, data=body) as response:
        response.raise_for_status()
        return await response.json(content_type=None)


async def fetchPageWithRetry(
    session: aiohttp.ClientSession,
    yearandseme: str,
    coursetype: str,
    yuanxi: str,
    start_row: int,
    max_retries: int = 3
) -> dict:
    """
    Fetch a single page with retry logic.

    Args:
        session: aiohttp ClientSession instance.
        yearandseme (str): Academic year and semester.
        coursetype (str): Course type identifier.
        yuanxi (str): Department identifier.
        start_row (int): Starting row for pagination.
        max_retries (int): Maximum number of retry attempts.

    Returns:
        dict: JSON response from the server.
    """
    for attempt in range(max_retries):
        try:
            return await requestCourseData(session, yearandseme, coursetype, yuanxi, start_row)
        except (aiohttp.ClientError, json.JSONDecodeError) as e:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(1 * (attempt + 1))  # Exponential backoff
    return {}


async def fetchAllCourse(yearandseme: str, coursetype: str, yuanxi: str, max_concurrent: int = DEFAULT_CONCURRENT) -> Dict[str, Any]:
    """
    Fetch courses asynchronously and save them to a JSON file.
    Uses separate sessions for concurrent requests to bypass server-side session throttling.

    Args:
        yearandseme (str): Academic year and semester.
        coursetype (str): Course type identifier.
        yuanxi (str): Department identifier.
        max_concurrent (int): Maximum concurrent requests.

    Returns:
        Dict[str, Any]: The fetched course data.
    """
    # First request to get total count (using a temporary session)
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        first_data = await requestCourseData(session, yearandseme, coursetype, yuanxi, 0)
    
    count = int(first_data.get("count", 0))
    courselist = first_data.get("courselist", [])
    
    if count <= len(courselist):
        # All data fetched in first request
        pass
    else:
        # Calculate remaining pages to fetch
        page_size = len(courselist) if courselist else 10
        remaining_rows = list(range(len(courselist), count, page_size))
        
        # Create semaphore to control concurrency
        semaphore = asyncio.Semaphore(max_concurrent)
        completed_count = len(courselist)
        
        async def fetch_single_page(start_row: int, delay: float = 0) -> List[Dict]:
            """Fetch a single page with independent session and semaphore control."""
            nonlocal completed_count
            
            # Delay before acquiring semaphore to space out requests
            if delay > 0:
                await asyncio.sleep(delay)
            
            async with semaphore:
                # Create a new session for each concurrent request to bypass session-based throttling
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    try:
                        data = await fetchPageWithRetry(session, yearandseme, coursetype, yuanxi, start_row)
                        courses = data.get("courselist", [])
                        completed_count += len(courses)
                        return courses
                    except Exception as e:
                        print(f"Failed to fetch page starting at {start_row}: {e}")
                        return []
        
        # Create progress bar
        with Progress(transient=True, refresh_per_second=10) as progress:
            bar = progress.add_task(f"Fetching courses [blue]{completed_count}/{count}", total=count)
            progress.update(bar, completed=completed_count)
            
            # Create tasks with staggered delays
            tasks = []
            for i, start_row in enumerate(remaining_rows):
                delay = (i // max_concurrent) * REQUEST_DELAY
                tasks.append(fetch_single_page(start_row, delay))
            
            # Process results as they complete
            for coro in asyncio.as_completed(tasks):
                courses = await coro
                courselist.extend(courses)
                progress.update(bar, completed=min(completed_count, count), 
                              description=f"Fetching courses [blue]{min(completed_count, count)}/{count}")
    
    # Sort courselist by "xh" field (ascending)
    courselist.sort(key=lambda x: x.get('xh', 0))
    
    # Save all courses to a JSON file
    metadata = {
        "yearandseme": yearandseme,
        "coursetype": coursetype,
        "yuanxi": yuanxi,
        "count": count,
        "fetch_time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "version": "1.1"
    }
    
    result = {
        "metadata": metadata,
        "courses": courselist
    }
    
    return result


def saveResponse(yearandseme: str, coursetype: str, yuanxi: str, result: Dict[str, Any]) -> None:
    """
    Save the fetched course data to a JSON file.

    Args:
        yearandseme (str): Academic year and semester.
        coursetype (str): Course type identifier.
        yuanxi (str): Department identifier.
        result (Dict[str, Any]): The course data to save.
    """
    yx = "_" + yuanxi if yuanxi != "0" else ""
    ct = "_" + coursetype if coursetype != "0" else ""

    import os
    from pathlib import Path
    current_dir = Path(__file__).parent
    output_dir = current_dir / "raw"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / f"RawCourses_{yearandseme}{ct}{yx}.json"
    
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=4)

    print(f"Courses saved to {output_file}")


async def async_main(year: str, type: str, dept: str, concurrent: int = DEFAULT_CONCURRENT) -> None:
    """
    Async main function to fetch and save courses.
    
    Args:
        year (str): The academic year and semester.
        type (str): The course type identifier.
        dept (str): The department identifier.
        concurrent (int): Maximum concurrent requests.
    """
    result = await fetchAllCourse(year, type, dept, concurrent)
    saveResponse(year, type, dept, result)


def main() -> None:
    """
    Main function to parse arguments and fetch courses.
    """
    parser = argparse.ArgumentParser(description="Fetch course data from the server.")
    parser.add_argument("-y", "--year", type=str, required=True, help="The academic year and semester (e.g., '25-26-1').")
    parser.add_argument("-t", "--type", type=str, default="0", help="The course type identifier (default: '0').")
    parser.add_argument("-d", "--dept", type=str, default="0", help="The department identifier.")
    parser.add_argument("-c", "--concurrent", type=int, default=DEFAULT_CONCURRENT, 
                       help=f"Maximum concurrent requests (default: {DEFAULT_CONCURRENT}).")

    args = parser.parse_args()
    
    # Run async main
    asyncio.run(async_main(args.year, args.type, args.dept, args.concurrent))


if __name__ == "__main__":
    main()