"""Signal sources. Only public feeds / public job-board APIs and data the user provides.
Nothing here logs in to, scrapes or automates LinkedIn."""
import csv
import html
import io
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

UA = "LinkedInAgents/1.0 (personal single-user research tool)"

SOURCE_TYPES = {
    "rss": {"label": "RSS / Atom news feed", "field": "url", "hint": "Feed URL", "kind": "company_news"},
    "remotive": {"label": "Remotive public jobs API", "field": None, "hint": "", "kind": "job_posting"},
    "remoteok": {"label": "Remote OK public jobs API", "field": None, "hint": "", "kind": "job_posting"},
    "greenhouse": {"label": "Greenhouse job board (one company)", "field": "board", "hint": "Board token, e.g. the 'acme' in boards.greenhouse.io/acme", "kind": "job_posting"},
    "lever": {"label": "Lever job board (one company)", "field": "board", "hint": "Company slug, e.g. the 'acme' in jobs.lever.co/acme", "kind": "job_posting"},
    "ashby": {"label": "Ashby job board (one company)", "field": "board", "hint": "Board name, e.g. the 'acme' in jobs.ashbyhq.com/acme", "kind": "job_posting"},
}

FUNDING_WORDS = ["raises", "raised", "funding", "seed round", "pre-seed", "series a", "series b", "series c",
                 "investment round", "closes round", "secures", "backed by", "led by", "million round", "valuation"]
CAREER_WORDS = ["sdr", "bdr", "sales development", "business development", "new business", "partnerships",
                "partnership", "ecosystem", "outbound", "marketing assistant", "marketing coordinator",
                "marketing associate", "content writer", "copywriter", "social media", "account executive",
                "client partner", "growth"]
# A remote job is kept only if its stated location is empty or contains one of these.
BRAZIL_OK = ["worldwide", "anywhere", "global", "international", "latam", "latin america", "south america",
             "americas", "brazil", "brasil", "remote", "all countries", "emea, americas"]

DEFAULT_SOURCES = {
    "lit": [
        {"type": "rss", "name": "Cointelegraph — funding rounds", "config": {"url": "https://cointelegraph.com/rss", "keywords": FUNDING_WORDS}},
        {"type": "rss", "name": "Decrypt — funding rounds", "config": {"url": "https://decrypt.co/feed", "keywords": FUNDING_WORDS}},
        {"type": "rss", "name": "TechCrunch Venture — funding rounds", "config": {"url": "https://techcrunch.com/category/venture/feed/", "keywords": FUNDING_WORDS}},
        {"type": "rss", "name": "CoinDesk — funding rounds", "config": {"url": "https://www.coindesk.com/arc/outboundfeeds/rss/", "keywords": FUNDING_WORDS}},
        {"type": "rss", "name": "The Block — funding rounds", "config": {"url": "https://www.theblock.co/rss.xml", "keywords": FUNDING_WORDS}},
    ],
    "career": [
        {"type": "remotive", "name": "Remotive — remote BD, SDR, partnerships, marketing roles", "config": {"keywords": CAREER_WORDS, "brazil_ok": True, "max_age_days": 14}},
        {"type": "remoteok", "name": "Remote OK — remote BD, SDR, partnerships, marketing roles", "config": {"keywords": CAREER_WORDS, "brazil_ok": True, "max_age_days": 14}},
        {"type": "rss", "name": "We Work Remotely — sales and marketing", "config": {"url": "https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss", "keywords": CAREER_WORDS, "brazil_ok": True, "max_age_days": 14, "kind": "job_posting"}},
    ],
}


def recent(cfg, when):
    """With max_age_days set, drop postings older than that. Unparseable or missing dates are kept."""
    days = cfg.get("max_age_days")
    if not days or not when:
        return True
    try:
        if isinstance(when, (int, float)):
            dt = datetime.fromtimestamp(when, timezone.utc)
        else:
            try:
                dt = parsedate_to_datetime(when)
            except (TypeError, ValueError):
                dt = datetime.fromisoformat(str(when).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - dt <= timedelta(days=int(days))
    except Exception:
        return True


def location_ok(cfg, location):
    """With brazil_ok set, drop remote jobs whose stated location excludes Brazil (e.g. 'USA Only')."""
    loc = (location or "").strip().lower()
    return not cfg.get("brazil_ok") or not loc or any(k in loc for k in BRAZIL_OK)


def clean(text, limit=6000):
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text or "", flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def http_get(url, timeout=30):
    if not re.match(r"^https?://", url or ""):
        raise ValueError("URL must start with http:// or https://")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(8_000_000)


def _matches(text, keywords):
    if not keywords:
        return True
    t = (text or "").lower()
    return any(k.lower() in t for k in keywords)


def _local(tag):
    return tag.rsplit("}", 1)[-1].lower()


def fetch_rss(cfg):
    root = ET.fromstring(http_get(cfg["url"]))
    items = []
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        f = {}
        for c in el:
            name = _local(c.tag)
            if name == "link":
                f.setdefault("link", (c.text or "").strip() or c.attrib.get("href", ""))
            elif name in ("title", "description", "summary", "encoded", "content", "guid", "id", "creator", "region", "pubdate", "published", "updated"):
                f.setdefault(name, c.text or "")
        body = clean(f.get("encoded") or f.get("content") or f.get("description") or f.get("summary") or "")
        title = clean(f.get("title", ""), 300)
        if not title or not _matches(title + " " + body, cfg.get("keywords")):
            continue
        posted = (f.get("pubdate") or f.get("published") or f.get("updated") or "").strip()
        if not location_ok(cfg, f.get("region")) or not recent(cfg, posted):
            continue
        if cfg.get("kind") == "job_posting":
            body = f"Job posting: {title}. Location requirement: {(f.get('region') or 'not stated').strip()}. Posted: {posted or 'not stated'}.\n\n{body}"[:6000]
        items.append({"title": title, "url": f.get("link", ""), "body": body, "company": "",
                      "author": clean(f.get("creator", ""), 120),
                      "external_id": f.get("guid") or f.get("id") or f.get("link") or title})
    return items


def _job(title, company, url, body, ext, extra=""):
    head = f"Job posting: {title} at {company}. {extra}".strip()
    return {"title": f"{title} — {company}", "url": url, "company": company, "author": "",
            "body": (head + "\n\n" + clean(body))[:6000], "external_id": str(ext)}


def fetch_remotive(cfg):
    url = "https://remotive.com/api/remote-jobs"
    if cfg.get("search"):
        url += "?search=" + urllib.parse.quote(cfg["search"])
    out = []
    for j in json.loads(http_get(url)).get("jobs", []):
        if _matches(j.get("title", ""), cfg.get("keywords")) and location_ok(cfg, j.get("candidate_required_location")) and recent(cfg, j.get("publication_date")):
            extra = f"Location requirement: {j.get('candidate_required_location', 'n/a')}. Salary: {j.get('salary') or 'not stated'}. Type: {j.get('job_type', '')}. Posted: {j.get('publication_date', '')}."
            out.append(_job(j.get("title", ""), j.get("company_name", ""), j.get("url", ""), j.get("description", ""), "remotive-%s" % j.get("id"), extra))
    return out


def fetch_remoteok(cfg):
    out = []
    for j in json.loads(http_get("https://remoteok.com/api")):
        if not isinstance(j, dict) or not j.get("position"):
            continue
        if _matches(j["position"], cfg.get("keywords")) and location_ok(cfg, j.get("location")) and recent(cfg, j.get("date")):
            sal = f"{j.get('salary_min')}-{j.get('salary_max')} USD" if j.get("salary_max") else "not stated"
            extra = f"Location: {j.get('location') or 'n/a'}. Salary: {sal}. Tags: {', '.join(j.get('tags') or [])}. Posted: {j.get('date', '')}."
            out.append(_job(j["position"], j.get("company", ""), j.get("url") or j.get("apply_url", ""), j.get("description", ""), "remoteok-%s" % j.get("id"), extra))
    return out


def _slug(cfg):
    slug = (cfg.get("board") or "").strip().strip("/")
    if not re.match(r"^[A-Za-z0-9._-]+$", slug):
        raise ValueError("Board name should be a single slug such as 'acme'")
    return slug


def fetch_greenhouse(cfg):
    s = _slug(cfg)
    data = json.loads(http_get(f"https://boards-api.greenhouse.io/v1/boards/{s}/jobs?content=true"))
    return [_job(j.get("title", ""), cfg.get("company") or s, j.get("absolute_url", ""), html.unescape(j.get("content", "")),
                 f"gh-{s}-{j.get('id')}", f"Location: {(j.get('location') or {}).get('name', 'n/a')}.")
            for j in data.get("jobs", []) if _matches(j.get("title", ""), cfg.get("keywords"))]


def fetch_lever(cfg):
    s = _slug(cfg)
    data = json.loads(http_get(f"https://api.lever.co/v0/postings/{s}?mode=json"))
    out = []
    for j in data if isinstance(data, list) else []:
        if _matches(j.get("text", ""), cfg.get("keywords")):
            c = j.get("categories") or {}
            extra = f"Location: {c.get('location', 'n/a')}. Workplace: {j.get('workplaceType', 'n/a')}. Team: {c.get('team', '')}."
            out.append(_job(j.get("text", ""), cfg.get("company") or s, j.get("hostedUrl", ""), j.get("descriptionPlain") or j.get("description", ""), f"lever-{s}-{j.get('id')}", extra))
    return out


def fetch_ashby(cfg):
    s = _slug(cfg)
    data = json.loads(http_get(f"https://api.ashbyhq.com/posting-api/job-board/{s}?includeCompensation=true"))
    out = []
    for j in data.get("jobs", []):
        if _matches(j.get("title", ""), cfg.get("keywords")):
            comp = (j.get("compensation") or {}).get("compensationTierSummary") or "not stated"
            extra = f"Location: {j.get('location', 'n/a')}. Remote: {j.get('isRemote')}. Compensation: {comp}."
            out.append(_job(j.get("title", ""), cfg.get("company") or s, j.get("jobUrl", ""), j.get("descriptionPlain") or j.get("descriptionHtml", ""), f"ashby-{s}-{j.get('id')}", extra))
    return out


FETCHERS = {"rss": fetch_rss, "remotive": fetch_remotive, "remoteok": fetch_remoteok,
            "greenhouse": fetch_greenhouse, "lever": fetch_lever, "ashby": fetch_ashby}


def fetch(source):
    return FETCHERS[source["type"]](source["config"] or {})


def parse_connections_csv(text):
    """LinkedIn's own data export (Settings > Data privacy > Get a copy of your data > Connections)."""
    lines = text.lstrip("﻿").splitlines()
    start = next((i for i, l in enumerate(lines) if l.lower().startswith("first name")), None)
    if start is None:
        raise ValueError("This does not look like LinkedIn's Connections.csv (no 'First Name' header found).")
    rows = []
    for r in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        if r.get("URL"):
            rows.append({"first_name": r.get("First Name", ""), "last_name": r.get("Last Name", ""),
                         "company": r.get("Company", ""), "position": r.get("Position", ""),
                         "url": r["URL"].strip(), "connected_on": r.get("Connected On", "")})
    return rows
