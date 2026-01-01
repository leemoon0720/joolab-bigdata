# -*- coding: utf-8 -*-
"""
JooLab News Collector
- RSS/공식 검색 링크 기반(본문 저장 없음)
- 결과:
  - news/latest.json : 최신 통합 리스트
  - news/index.json  : 동일(프론트에서 공용 사용)
  - news/archive/YYYYMMDD.json : 일별 아카이브(옵션)
원칙:
- 실패해도 "샘플" 생성 금지
- 항상 0 exit (GitHub Actions 실패 방지)
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import feedparser
from zoneinfo import ZoneInfo


KST = ZoneInfo("Asia/Seoul")

NEWS_DIR = os.path.join("news")
ARCHIVE_DIR = os.path.join(NEWS_DIR, "archive")
LATEST_PATH = os.path.join(NEWS_DIR, "latest.json")
INDEX_PATH = os.path.join(NEWS_DIR, "index.json")

MAX_ITEMS = 250

# 키워드 히트(호재/악재/종목성)
KEYWORDS = [
    "호재", "악재", "실적", "어닝", "매출", "영업이익", "순이익",
    "공시", "전망", "상향", "하향", "목표가", "리포트",
    "상한가", "하한가", "급등", "급락",
    "수주", "계약", "수출", "수입",
    "인수", "합병", "M&A", "증자", "감자", "CB", "BW",
    "FDA", "임상", "허가", "승인",
    "반도체", "2차전지", "AI", "로봇", "바이오", "제약", "원전",
    "환율", "금리", "인플레", "CPI", "PPI", "FOMC", "연준",
    "코스피", "코스닥", "증시", "주가",
]

# RSS + (RSS가 없거나 막히는 매체는) Google News RSS 검색 링크를 섞어서 최대한 커버
# NOTE: URL이 변경/차단될 수 있으니, 실패해도 전체가 죽지 않게 설계(항상 0 exit)
FEEDS = [
    # 국내(증권/경제)
    ("HK", "한국경제", "https://www.hankyung.com/feed/finance"),
    ("MK", "매일경제", "https://www.mk.co.kr/rss/50200011/"),
    ("YNA", "연합뉴스(경제)", "https://www.yna.co.kr/rss/economy.xml"),
    ("ED_STOCK", "이데일리(증권)", "http://rss.edaily.co.kr/stock_news.xml"),
    ("ED_ECO", "이데일리(경제)", "http://rss.edaily.co.kr/economy_news.xml"),
    ("MT", "머니투데이", "http://rss.mt.co.kr/mt_news.xml"),
    ("ETNEWS_FIN", "전자신문(금융/증권)", "http://rss.etnews.co.kr/Section022.xml"),
    # 글로벌(경제/마켓) - Google News RSS
    ("GN_KR_STOCK", "GoogleNews(한국증시)", "https://news.google.com/rss/search?q=%ED%95%9C%EA%B5%AD+%EC%A6%9D%EC%8B%9C&hl=ko&gl=KR&ceid=KR:ko"),
    ("GN_US_STOCK", "GoogleNews(미국주식)", "https://news.google.com/rss/search?q=%EB%AF%B8%EA%B5%AD+%EC%A3%BC%EC%8B%9D&hl=ko&gl=KR&ceid=KR:ko"),
    ("GN_SEMI", "GoogleNews(반도체)", "https://news.google.com/rss/search?q=%EB%B0%98%EB%8F%84%EC%B2%B4+%EC%A3%BC%EA%B0%80&hl=ko&gl=KR&ceid=KR:ko"),
    ("GN_BIO", "GoogleNews(바이오)", "https://news.google.com/rss/search?q=%EB%B0%94%EC%9D%B4%EC%98%A4+%EC%A3%BC%EC%8B%9D&hl=ko&gl=KR&ceid=KR:ko"),
    ("GN_MACRO", "GoogleNews(환율/금리)", "https://news.google.com/rss/search?q=%ED%99%98%EC%9C%A8+%EA%B8%88%EB%A6%AC+%EC%A6%9D%EC%8B%9C&hl=ko&gl=KR&ceid=KR:ko"),
]

@dataclass
class SourceStatus:
    id: str
    name: str
    feed: str
    status: str  # OK / MISSING / ERROR
    note: str = ""


def _now_kst_str() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")


def _safe_mkdir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _sanitize_text(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\s+", " ", s)
    return s


def _keywords_hit(title: str) -> List[str]:
    hits = []
    t = title or ""
    for kw in KEYWORDS:
        if kw and kw in t:
            hits.append(kw)
    return hits[:10]


def _parse_dt(entry: Dict[str, Any]) -> Tuple[str, Optional[datetime]]:
    # feedparser: published_parsed / updated_parsed (struct_time)
    for key in ("published_parsed", "updated_parsed"):
        st = entry.get(key)
        if st:
            try:
                dt = datetime(st.tm_year, st.tm_mon, st.tm_mday, st.tm_hour, st.tm_min, tzinfo=KST)
                return dt.strftime("%Y-%m-%d %H:%M"), dt
            except Exception:
                pass
    # fallback: string
    for key in ("published", "updated", "dc:date"):
        val = entry.get(key)
        if val:
            return _sanitize_text(str(val))[:16], None
    return "-", None


def _collect_feed(feed_id: str, name: str, url: str) -> Tuple[SourceStatus, List[Dict[str, Any]]]:
    try:
        d = feedparser.parse(url)
        # feedparser: bozo=1 means parse error, but entries may still exist
        entries = getattr(d, "entries", []) or []
        if not entries:
            st = SourceStatus(feed_id, name, url, "MISSING", "no entries")
            return st, []
        items: List[Dict[str, Any]] = []
        for e in entries:
            title = _sanitize_text(e.get("title", ""))
            link = _sanitize_text(e.get("link", "")) or _sanitize_text(e.get("id", ""))
            if not title or not link:
                continue
            pub_str, pub_dt = _parse_dt(e)
            items.append({
                "source": feed_id,
                "press": name,
                "published_at": pub_str,
                "_dt": pub_dt.isoformat() if pub_dt else "",
                "title": title,
                "url": link,
                "keywords_hit": _keywords_hit(title),
            })
        st = SourceStatus(feed_id, name, url, "OK")
        return st, items
    except Exception as ex:
        st = SourceStatus(feed_id, name, url, "ERROR", str(ex)[:120])
        return st, []


def _merge_and_sort(all_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    merged = []
    for it in all_items:
        u = it.get("url", "")
        if not u or u in seen:
            continue
        seen.add(u)
        merged.append(it)

    def keyfn(x: Dict[str, Any]):
        dt_str = x.get("_dt") or ""
        if dt_str:
            try:
                return datetime.fromisoformat(dt_str)
            except Exception:
                return datetime(1970, 1, 1, tzinfo=KST)
        return datetime(1970, 1, 1, tzinfo=KST)

    merged.sort(key=keyfn, reverse=True)
    # internal field 제거
    for it in merged:
        it.pop("_dt", None)
    return merged[:MAX_ITEMS]


def _write_json(path: str, data: Dict[str, Any]) -> None:
    _safe_mkdir(os.path.dirname(path))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main() -> int:
    _safe_mkdir(NEWS_DIR)
    _safe_mkdir(ARCHIVE_DIR)

    sources: List[SourceStatus] = []
    all_items: List[Dict[str, Any]] = []

    for fid, nm, url in FEEDS:
        st, items = _collect_feed(fid, nm, url)
        sources.append(st)
        all_items.extend(items)

    merged = _merge_and_sort(all_items)

    payload = {
        "updated_at": _now_kst_str(),
        "sources": [s.__dict__ for s in sources],
        "count": len(merged),
        "items": merged,
    }

    # latest / index 동일 저장(프론트 단순화)
    _write_json(LATEST_PATH, payload)
    _write_json(INDEX_PATH, payload)

    # archive(오늘자)
    ymd = datetime.now(KST).strftime("%Y%m%d")
    _write_json(os.path.join(ARCHIVE_DIR, f"{ymd}.json"), payload)

    print(f"[OK] written: {LATEST_PATH} / {INDEX_PATH} / {ARCHIVE_DIR}/{ymd}.json  count={len(merged)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit as se:
        raise
    except Exception as e:
        # 어떤 예외가 터져도 샘플 생성 금지 + 빈 파일로라도 덮어쓰기 + 0 종료
        empty = {
            "updated_at": _now_kst_str(),
            "sources": [],
            "count": 0,
            "items": [],
            "note": f"collector_error: {str(e)[:160]}",
        }
        try:
            _write_json(LATEST_PATH, empty)
            _write_json(INDEX_PATH, empty)
        except Exception:
            pass
        print(f"[WARN] collector failed but wrote empty json: {e}")
        raise SystemExit(0)
