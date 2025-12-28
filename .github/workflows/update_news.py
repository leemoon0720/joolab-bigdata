import os
import json
import time
import datetime as dt
from pathlib import Path

import feedparser
from dateutil import tz

KST = tz.gettz("Asia/Seoul")

FEEDS = [
    {"id": "HK", "name": "한국경제", "feed": "https://www.hankyung.com/feed/finance"},
    {"id": "MK", "name": "매일경제", "feed": "https://www.mk.co.kr/rss/50200011/"},
]

ROOT = Path(__file__).resolve().parents[1]
NEWS_DIR = ROOT / "news"
ARCHIVE_DIR = NEWS_DIR / "archive"

def now_kst_str():
    return dt.datetime.now(tz=KST).strftime("%Y-%m-%d %H:%M KST")

def ensure_dirs():
    NEWS_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

def parse_entry_time(e):
    # feedparser는 published_parsed / updated_parsed 둘 중 하나가 있을 수 있음
    tm = getattr(e, "published_parsed", None) or getattr(e, "updated_parsed", None)
    if tm:
        utc_dt = dt.datetime(*tm[:6], tzinfo=dt.timezone.utc)
        return utc_dt.astimezone(KST)
    return None

def fetch_feed(feed_url):
    # User-Agent 기본
    return feedparser.parse(feed_url)

def build_items():
    items = []
    source_status = []
    for s in FEEDS:
        try:
            d = fetch_feed(s["feed"])
            if getattr(d, "bozo", 0):
                # 파싱 문제 (가능하면 진행은 하되 상태 표시)
                status = "DEGRADED"
            else:
                status = "OK"

            source_status.append(
                {"id": s["id"], "name": s["name"], "feed": s["feed"], "status": status}
            )

            for e in d.entries[:80]:
                title = getattr(e, "title", "").strip()
                url = getattr(e, "link", "").strip()
                t = parse_entry_time(e)
                published_at = t.strftime("%Y-%m-%d %H:%M") if t else ""

                if not title or not url:
                    continue

                items.append(
                    {
                        "source": s["id"],
                        "press": s["name"],
                        "published_at": published_at,
                        "title": title,
                        "url": url,
                        "keywords_hit": [],
                    }
                )
        except Exception:
            source_status.append(
                {"id": s["id"], "name": s["name"], "feed": s["feed"], "status": "FAIL"}
            )

    # 시간 내림차순(문자열이라도 YYYY-MM-DD HH:MM 포맷이면 정렬됨)
    items.sort(key=lambda x: x.get("published_at", ""), reverse=True)

    # 최신 50개만
    items = items[:50]
    return items, source_status

def write_json(path: Path, obj: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default

def update_archive(today: str, latest_obj: dict):
    # 같은 날 파일은 덮어쓰기(누적형으로 쓰고 싶으면 여기 로직 바꾸면 됨)
    archive_path = ARCHIVE_DIR / f"{today}.json"
    archive_obj = {
        "date": today,
        "updated_at": latest_obj["updated_at"],
        "count": latest_obj["count"],
        "items": latest_obj["items"],
    }
    write_json(archive_path, archive_obj)

    # index.json에 날짜 누적(최신이 앞)
    idx_path = NEWS_DIR / "index.json"
    idx = load_json(idx_path, {"updated_at": latest_obj["updated_at"], "dates": []})
    dates = idx.get("dates", [])
    if today not in dates:
        dates.insert(0, today)
    idx["updated_at"] = latest_obj["updated_at"]
    idx["dates"] = dates[:180]  # 최대 180일만 유지
    write_json(idx_path, idx)

def main():
    ensure_dirs()

    items, sources = build_items()
    latest = {
        "updated_at": now_kst_str(),
        "sources": sources,
        "count": len(items),
        "items": items,
    }

    write_json(NEWS_DIR / "latest.json", latest)

    today = dt.datetime.now(tz=KST).strftime("%Y-%m-%d")
    update_archive(today, latest)

if __name__ == "__main__":
    main()
