# -*- coding: utf-8 -*-
"""
JooLab News Collector — FINAL
- RSS 수집 → news/latest.json, news/index.json 생성
- 날짜별 아카이브 → news/archive/YYYYMMDD.json 생성
- GitHub Actions 환경(ubuntu)에서 안정적으로 동작하도록 방어적으로 작성

출력 스키마(사용자 지정):
{
  "updated_at": "YYYY-MM-DD HH:MM KST",
  "sources": [{"id","name","feed","status"}...],
  "count": N,
  "items": [{
      "source": "HK",
      "press": "한국경제",
      "published_at": "YYYY-MM-DD HH:MM",
      "title": "...",
      "url": "https://...",
      "keywords_hit": ["..."]
  }...]
}
"""
import os
import json
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import feedparser

KST = ZoneInfo("Asia/Seoul")

# Repo root (…/tools/update_news.py -> …/)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEWS_DIR = os.path.join(REPO_ROOT, "news")
ARCHIVE_DIR = os.path.join(NEWS_DIR, "archive")

os.makedirs(NEWS_DIR, exist_ok=True)
os.makedirs(ARCHIVE_DIR, exist_ok=True)

SOURCES = [
    {"id": "HK",  "name": "한국경제", "feed": "https://www.hankyung.com/feed/finance"},
    {"id": "MK",  "name": "매일경제", "feed": "https://www.mk.co.kr/rss/50200011/"},
    {"id": "YNA", "name": "연합뉴스", "feed": "https://www.yna.co.kr/rss/stock.xml"},
]

# 필요 시 여기만 늘리면 됨
KEYWORDS = [
    "코스피","코스닥","외국인","기관","환율","금리","반도체","실적","IPO","상장",
    "공시","배당","자사주","증자","감자","인수","M&A","적자","흑자","매출","영업이익",
    "AI","2차전지","바이오","방산","로봇","리츠","원유","유가"
]

_whitespace_re = re.compile(r"\s+")

def _now_kst_str() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")

def _fmt_kst(dt_obj: datetime) -> str:
    return dt_obj.astimezone(KST).strftime("%Y-%m-%d %H:%M")

def _entry_dt_kst(entry) -> str:
    """
    feedparser entry에서 가능한 날짜를 최대한 추출해서 KST 문자열로 반환.
    실패 시 빈 문자열 반환.
    """
    tm = None
    # 우선순위: published_parsed -> updated_parsed
    if getattr(entry, "published_parsed", None):
        tm = entry.published_parsed
    elif getattr(entry, "updated_parsed", None):
        tm = entry.updated_parsed

    if not tm:
        return ""

    # feedparser time.struct_time -> datetime(UTC 가정)
    try:
        dt_utc = datetime(tm.tm_year, tm.tm_mon, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec, tzinfo=timezone.utc)
        return _fmt_kst(dt_utc)
    except Exception:
        return ""

def _hits(text: str):
    t = _whitespace_re.sub(" ", (text or "")).strip()
    hits = []
    for k in KEYWORDS:
        if k in t and k not in hits:
            hits.append(k)
    return hits

def _safe_str(x):
    return (x or "").strip()

def collect(max_per_source: int = 20, max_total: int = 60):
    items = []
    sources_status = []
    seen_urls = set()

    for src in SOURCES:
        sid = src["id"]
        name = src["name"]
        feed_url = src["feed"]

        try:
            feed = feedparser.parse(feed_url)
            status = "OK" if not getattr(feed, "bozo", False) else "PARTIAL"
        except Exception:
            feed = None
            status = "ERROR"

        sources_status.append({
            "id": sid,
            "name": name,
            "feed": feed_url,
            "status": status
        })

        if status == "ERROR" or not feed or not getattr(feed, "entries", None):
            continue

        for e in feed.entries[:max_per_source]:
            title = _safe_str(getattr(e, "title", ""))
            link = _safe_str(getattr(e, "link", ""))

            if not link or link in seen_urls:
                continue

            published_at = _entry_dt_kst(e)
            item = {
                "source": sid,
                "press": name,
                "published_at": published_at,
                "title": title,
                "url": link,
                "keywords_hit": _hits(title),
            }
            items.append(item)
            seen_urls.add(link)

    # 날짜 내림차순 정렬(날짜 없는 항목은 뒤로)
    def _sort_key(it):
        # published_at: "YYYY-MM-DD HH:MM"
        s = it.get("published_at") or ""
        return s

    items.sort(key=_sort_key, reverse=True)

    if max_total and len(items) > max_total:
        items = items[:max_total]

    payload = {
        "updated_at": _now_kst_str(),
        "sources": sources_status,
        "count": len(items),
        "items": items
    }
    return payload

def write_json(path: str, data: dict):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def main():
    payload = collect()

    latest_path = os.path.join(NEWS_DIR, "latest.json")
    index_path = os.path.join(NEWS_DIR, "index.json")

    # 아카이브 파일명: YYYYMMDD
    today_ymd = datetime.now(KST).strftime("%Y%m%d")
    archive_path = os.path.join(ARCHIVE_DIR, f"{today_ymd}.json")

    write_json(latest_path, payload)
    write_json(index_path, payload)
    write_json(archive_path, payload)

if __name__ == "__main__":
    main()
