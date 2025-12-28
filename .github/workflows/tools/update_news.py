import json
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
    tm = getattr(e, "published_parsed", None) or getattr(e, "updated_parsed", None)
    if tm:
        utc_dt = dt.datetime(*tm[:6], tzinfo=dt.timezone.utc)
        return utc_dt.astimezone(KST)
    return None

def build_items():
    items = []
    source_status = []

    for s in FEEDS:
        try:
            d = feedparser.parse(s["feed"])
            status = "DEGRADED" if getattr(d, "bozo", 0) else "OK"
            source_status.append({"id": s["id"], "name": s["name"], "feed": s["feed"], "status": status})

            for e in d.entries[:80]:
                title = getattr(e, "title", "").strip()
                url = getattr(e, "link", "").strip()
                t = parse_entry_time(e)
                published_at = t.strftime("%Y-%m-%d %H:%M") if t else ""
                if not title or not url:
                    continue
                items.append({
                    "source": s["id"],
                    "press": s["name"],
                    "published_at": published_at,
                    "title": title,
                    "url": url,
                    "keywords_hit": [],
                })
        except Exception:
            source_status.append({"id": s["id"], "name": s["name"], "feed": s["feed"], "status": "FAIL"})

    items.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    return items[:50], source_status

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
    archive_path = ARCHIVE_DIR / f"{today}.json"
    write_json(archive_path, {
        "date": today,
        "updated_at": latest_obj["updated_at"],
        "count": latest_obj["count"],
        "items": latest_obj["items"],
    })

    idx_path = NEWS_DIR / "index.json"
    idx = load_json(idx_path, {"updated_at": latest_obj["updated_at"], "dates": []})
    dates = idx.get("dates", [])
    if today not in dates:
        dates.insert(0, today)
    idx["updated_at"] = latest_obj["updated_at"]
    idx["dates"] = dates[:180]
    write_json(idx_path, idx)

def main():
    ensure_dirs()
    items, sources = build_items()
    latest = {"updated_at": now_kst_str(), "sources": sources, "count": len(items), "items": items}
    write_json(NEWS_DIR / "latest.json", latest)

    today = dt.datetime.now(tz=KST).strftime("%Y-%m-%d")
    update_archive(today, latest)

if __name__ == "__main__":
    main()
