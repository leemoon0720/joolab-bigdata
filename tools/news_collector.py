import feedparser, json, datetime, os

FEEDS = {
    "연합뉴스": "https://www.yna.co.kr/rss/finance.xml",
    "매일경제": "https://www.mk.co.kr/rss/stock.xml",
    "Reuters": "https://feeds.reuters.com/reuters/businessNews"
}

items = []

for src, url in FEEDS.items():
    feed = feedparser.parse(url)
    for e in feed.entries[:15]:
        items.append({
            "source": src,
            "title": e.get("title"),
            "link": e.get("link"),
            "published": e.get("published", "")
        })

data = {
    "updated": datetime.datetime.utcnow().isoformat(),
    "count": len(items),
    "items": items
}

os.makedirs("news", exist_ok=True)
with open("news/latest.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
