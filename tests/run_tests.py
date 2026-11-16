"""End-to-end test with a mock Claude API and a mock RSS feed. No network, no real key.
Run:  python tests/run_tests.py"""
import json, os, shutil, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
tmp = tempfile.mkdtemp()
os.environ.update({"LIA_DATA_DIR": tmp, "ANTHROPIC_API_KEY": "test-key", "APP_PASSWORD": "correct-horse-battery", "CRON_TOKEN": "cron-secret", "no_proxy": "127.0.0.1,localhost", "NO_PROXY": "127.0.0.1,localhost"})
CALLS = []

RSS = """<?xml version="1.0"?><rss version="2.0"><channel><title>Mock</title>
<item><title>Acme Protocol raises $8M seed round</title><link>http://x/1</link><guid>g1</guid><description>&lt;p&gt;Founder Jane Doe says a rebrand is next.&lt;/p&gt;</description></item>
<item><title>Weather is nice</title><link>http://x/2</link><guid>g2</guid><description>nothing</description></item>
<item><title>Market irrelevant roundup: funding</title><link>http://x/3</link><guid>g3</guid><description>irrelevant</description></item>
</channel></rss>"""


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(RSS.encode())
    def do_POST(self):
        p = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert self.headers["x-api-key"] == "test-key"
        CALLS.append(p)
        tool = [t for t in p["tools"] if t.get("name") in ("record_analysis", "record_draft")][0]
        text = p["messages"][0]["content"]
        if tool["name"] == "record_analysis":
            crit = tool["input_schema"]["properties"]["scores"]["items"]["properties"]["criterion"]["enum"]
            src = text.split("--- SOURCE TEXT ---")[1]
            title = text.split("Title: ")[1].split("\n")[0]
            if "irrelevant" in src or "irrelevant" in title:
                inp = {"relevant": False, "irrelevance_reason": "No company to approach", "scores": [], "detected_signals": [], "facts": [], "contacts": []}
            else:
                low = "LOWSCORE" in src
                inp = {"relevant": True, "company": {"name": "Acme Protocol", "industry": "DeFi", "stage": "Seed"},
                       "headline": "Acme raised a seed round", "summary": "Acme raised and plans a rebrand.",
                       "detected_signals": [{"type": tool["input_schema"]["properties"]["detected_signals"]["items"]["properties"]["type"]["enum"][0], "evidence": "raised $8M", "basis": "stated_in_source"}],
                       "facts": [{"statement": "Raised $8M", "basis": "stated_in_source"}, {"statement": "Has 12 staff", "basis": "public_web"}],
                       "scores": [{"criterion": c, "points": 2 if low else 999, "reason": "because"} for c in crit],
                       "contacts": [{"name": "Jane Doe", "title": "Founder", "basis": "stated_in_source", "why": "Decision maker", "linkedin_url": "https://www.linkedin.com/in/janedoe/"},
                                    {"name": "", "title": "Head of Marketing", "basis": "stated_in_source", "why": "Owns brand"}],
                       "next_step": "Connect with Jane", "potential_services": ["Branding & Brand Identity"],
                       "role": {"title": "SDR", "category": "2. SDR / BDR", "has_public_opening": True, "level": "Entry", "salary": "not stated", "brazil_evidence": "LATAM welcome", "published": "2026-11-14", "why_fit": "Outbound to founders", "highlights": ["9 deals closed", "3 years of outbound"], "remote": "Hybrid or on-site" if "ONSITE" in src else "Unknown"}}
        else:
            inp = {"signal_reference": "Seed round", "why_this_makes_sense": "Fresh funding", "angle": "Funding Congratulation",
                   "suggested_message": "Congrats on the round, Jane. Our services could help.", "alternative_message": "Alt version",
                   "recommended_follow_up": "Following up"}
        out = json.dumps({"content": [{"type": "tool_use", "name": tool["name"], "input": inp}]}).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)


mock = ThreadingHTTPServer(("127.0.0.1", 0), Mock)
threading.Thread(target=mock.serve_forever, daemon=True).start()
MURL = "http://127.0.0.1:%d" % mock.server_port
os.environ["LIA_ANTHROPIC_URL"] = MURL

import app  # noqa
from core import db, engine
from core.agents import AGENTS

app.seed_sources()
R = lambda m, p, b=None: app.route(m, p, {}, b or {})
n = 0
def ok(cond, label):
    global n; n += 1
    print(("PASS  " if cond else "FAIL  ") + label)
    if not cond: sys.exit(1)
def raises(fn, exc):
    try: fn()
    except exc as e: return str(e) or True
    return False

lit, car = AGENTS["lit"], AGENTS["career"]
if db.backend() == "sqlite":
    ok(os.path.exists(os.path.join(tmp, "lit.db")) and os.path.exists(os.path.join(tmp, "career.db")), "separate database files per agent")
else:
    names = {r["schema_name"] for r in db.system_db().all("SELECT schema_name FROM information_schema.schemata")}
    ok({"lit", "career", "system"} <= names and db.agent_db(AGENTS["lit"]).val("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='lit' AND table_name='opportunities'") == 1, "separate Postgres schema per agent")
ok(len(R("GET", "/api/lit/sources")) == 5 and len(R("GET", "/api/career/sources")) == 3, "default sources seeded once per agent")
from core import sources as _src
ok(all(x["type"] == "rss" for x in R("GET", "/api/lit/sources")), "Lit sources are funding news feeds only, no job boards")
ok(not _src.location_ok({"brazil_ok": True}, "USA Only") and _src.location_ok({"brazil_ok": True}, "Worldwide") and _src.location_ok({"brazil_ok": True}, "") and _src.location_ok({"brazil_ok": True}, "LATAM, Europe") and _src.location_ok({}, "USA Only"), "Career job filter drops remote jobs that exclude Brazil")

# --- monitoring run against the mock feed (Lit only)
for s in R("GET", "/api/lit/sources"): R("PATCH", f"/api/lit/sources/{s['id']}", {"enabled": 0})
sid = R("POST", "/api/lit/sources", {"type": "rss", "name": "Mock feed", "config": {"url": MURL + "/rss", "keywords": ["raises", "funding"]}})["id"]
engine.run_monitor(lit, "manual")
run = db.system_db().one("SELECT * FROM runs ORDER BY id DESC")
ok(run["fetched"] == 2 and run["new_signals"] == 2 and run["analyzed"] == 2, "run: keyword filter kept 2 of 3 items, both analyzed")
engine.run_monitor(lit, "manual")
ok(db.system_db().one("SELECT * FROM runs ORDER BY id DESC")["new_signals"] == 0, "second run adds no duplicates")
opps = R("GET", "/api/lit/opportunities")
ok(len(opps) == 1 and opps[0]["score"] == 100 and opps[0]["classification"] == "Hot lead", "scores clamped to rubric maxima, total 100 -> Hot lead")
ok(len(R("GET", "/api/lit/signals?status=irrelevant".split("?")[0])) == 0 and db.agent_db(lit).val("SELECT COUNT(*) FROM signals WHERE status='irrelevant'") == 1, "irrelevant signal filtered out with reason")
o = R("GET", f"/api/lit/opportunities/{opps[0]['id']}")
ok([f["basis"] for f in o["facts"]] == ["stated_in_source", "hypothesis"], "'public_web' fact downgraded to hypothesis when no web search ran")
ok(o["signal"]["provenance"] == "retrieved", "feed signal labelled as retrieved")
ok(o["stage"] == "Ready for Outreach" and [c["basis"] for c in o["contacts"]] == ["stated_in_source", "hypothesis"], "named contact -> Ready for Outreach; unnamed role stored as hypothesis")
ok(len(R("GET", "/api/career/opportunities")) == 0, "career database untouched by Lit run")

# --- drafting and approval gate
jane = o["contacts"][0]["id"]
ok(raises(lambda: R("POST", f"/api/lit/opportunities/{o['id']}/draft", {"contact_id": o["contacts"][1]["id"], "type": "first_message"}), ValueError), "cannot draft to an unnamed (hypothetical) contact")
o = R("POST", f"/api/lit/opportunities/{o['id']}/draft", {"contact_id": jane, "type": "connection_request"})
m = o["messages"][0]
ok(m["status"] == "drafted" and o["stage"] == "Message Drafted" and m["angle"] == "funding congratulation", "draft stored, stage -> Message Drafted")
ok(raises(lambda: R("POST", f"/api/lit/messages/{m['id']}", {"action": "sent"}), PermissionError), "unapproved message cannot be marked sent")
m = R("POST", f"/api/lit/messages/{m['id']}", {"action": "edit", "text": "Congrats on the seed round, Jane."})
ok(m["edited"] == 1, "edit recorded")
R("POST", f"/api/lit/messages/{m['id']}", {"action": "approve"})
R("POST", f"/api/lit/messages/{m['id']}", {"action": "sent"})
ok(R("GET", f"/api/lit/opportunities/{o['id']}")["stage"] == "Contacted", "approve -> sent -> Contacted")
R("POST", f"/api/lit/messages/{m['id']}", {"action": "reply", "reply": "positive"})
ok(R("GET", f"/api/lit/opportunities/{o['id']}")["stage"] == "Interested", "positive reply -> Interested")
R("PATCH", f"/api/lit/opportunities/{o['id']}", {"stage": "Meeting Scheduled", "meeting_at": "2026-12-01T15:00"})
ctype, cal = R("GET", f"/api/lit/opportunities/{o['id']}/ics")
ok("DTSTART:20261201T150000" in cal, "calendar file export")
a = R("GET", "/api/lit/analytics")
ok(a["by_signal"][0]["meetings"] == 1 and a["by_message_type"][0]["positive"] == 1 and a["by_service"][0]["group"] == "Branding & Brand Identity", "analytics attribute reply and meeting to signal, message type, service")
ov = R("GET", "/api/overview")
ok(ov["lit"]["metrics"]["meetings"] == 1 and ov["lit"]["metrics"]["positive"] == 1 and ov["career"]["metrics"]["opportunities"] == 0, "overview metrics separate per agent")
before = len(CALLS)
R("POST", f"/api/lit/opportunities/{o['id']}/draft", {"contact_id": jane, "type": "follow_up"})
ok("His version: Congrats on the seed round, Jane." in CALLS[-1]["messages"][0]["content"] and "Messages that got a positive reply" in CALLS[-1]["messages"][0]["content"], "learning: his edit and winning message are fed into the next draft")

# --- career agent: manual capture, identity guard, lint
r = R("POST", "/api/career/signals", {"kind": "linkedin_post", "body": "Acme Protocol founder Jane Doe: we are growing the team", "author": "Jane Doe", "analyze": True})
co = R("GET", f"/api/career/opportunities/{r['result']['opportunity_id']}")
ok(co["signal"]["provenance"] == "user_provided" and co["stage"] == "Contact Identified", "career capture labelled user-provided, stage Contact Identified")
ok(len(co["breakdown"]) == 7 and "Flávio Veloso" in CALLS[-1]["system"] and "Lit Collective, a Web3-focused" not in CALLS[-1]["system"], "career uses its own rubric and persona")
ok(bool(co["conflict"]) and bool(R("GET", f"/api/lit/opportunities/{o['id']}")["conflict"]), "identity guard: same company in both pipelines flagged on both sides")
co = R("POST", f"/api/career/opportunities/{co['id']}/draft", {"contact_id": co["contacts"][0]["id"], "type": "founder_dm"})
cm = co["messages"][0]
ok(any("identity" in x.lower() for x in cm["lint"]), "lint flags agency-pitch wording in a career message")
ok(raises(lambda: R("POST", f"/api/career/messages/{cm['id']}", {"action": "approve"}), PermissionError), "approval blocked while identity conflict unconfirmed")
R("PATCH", f"/api/career/opportunities/{co['id']}", {"conflict_ack": 1})
R("POST", f"/api/career/messages/{cm['id']}", {"action": "approve"})
R("POST", f"/api/career/messages/{cm['id']}", {"action": "sent"})
ok(R("GET", f"/api/career/opportunities/{co['id']}")["stage"] == "Message Sent", "career: sent DM -> Message Sent")
r = R("POST", "/api/career/signals", {"kind": "job_posting", "body": "LOWSCORE Senior Solidity engineer at Other Co", "analyze": True})
low = R("GET", f"/api/career/opportunities/{r['result']['opportunity_id']}")
ok(low["parked"] == 1 and low["classification"] == "Low relevance" and low["score"] == 14, "low score parked off the board")
ok(raises(lambda: R("POST", "/api/career/signals", {"kind": "job_posting", "body": "LOWSCORE Senior Solidity engineer at Other Co"}), app.HttpError), "duplicate capture rejected")

r = R("POST", "/api/career/signals", {"kind": "job_posting", "body": "ONSITE Growth Manager at Gamma, office in Berlin", "analyze": True})
ok(r["result"]["relevant"] is False and "remote" in r["result"]["reason"].lower() or db.agent_db(car).one("SELECT status, error FROM signals WHERE id=?", (r["id"],))["status"] == "irrelevant", "Career rejects a hybrid or on-site role")
ok("MANDATORY: 100% remote" in CALLS[-1]["system"] and "9 deals closed" in CALLS[-1]["system"], "remote rule and new profile are in the Career instructions")
ok(co["role"]["highlights"] == ["9 deals closed", "3 years of outbound"] and co["role"]["category"] == "2. SDR / BDR" and co["role"]["brazil_evidence"] == "LATAM welcome", "role keeps track, Brazil evidence and the two points to highlight")
from datetime import datetime, timedelta, timezone
old_d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(); new_d = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%a, %d %b %Y %H:%M:%S +0000")
ok(not _src.recent({"max_age_days": 14}, old_d) and _src.recent({"max_age_days": 14}, new_d) and _src.recent({"max_age_days": 14}, "") and _src.recent({}, old_d), "postings older than 14 days are skipped")

# --- connections import
csvtext = "Notes:\n\"When exporting...\"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nJohn,Roe,https://www.linkedin.com/in/johnroe,,Beta,CEO,01 Jan 2025\n"
ok(R("POST", "/api/network/import", {"csv": csvtext})["imported"] == 1, "LinkedIn Connections.csv import")
x = R("POST", f"/api/career/opportunities/{low['id']}/contacts", {"name": "John Roe", "title": "CEO", "linkedin_url": "https://linkedin.com/in/johnroe/"})
john = [c for c in x["contacts"] if c["name"] == "John Roe"][0]
ok(john["connected"] == 1 and john["basis"] == "user_provided", "added contact matched to existing connection")

# --- editable scoring
ok(raises(lambda: R("POST", "/api/lit/scoring", {"weights": {"icp_fit": 90}}), ValueError), "scoring weights must add up to 100")
R("POST", "/api/lit/scoring", {"weights": {"icp_fit": 10, "buying_signals": 30}, "guidance": "Skip gambling projects."})
cfg = R("GET", "/api/config")["agents"]
ok({c["key"]: c["max"] for c in cfg["lit"]["criteria"]}["buying_signals"] == 30 and {c["key"]: c["max"] for c in cfg["career"]["criteria"]}["experience_fit"] == 20, "Lit weights changed, Career rubric untouched")
r = R("POST", "/api/lit/signals", {"kind": "note", "body": "Beta Labs raised a round", "analyze": True})
ok("buying_signals (0-30)" in CALLS[-1]["messages"][0]["content"] and "Skip gambling projects." in CALLS[-1]["system"], "new weights and standing preferences reach Claude")

# --- login, sessions and the cron endpoint over real HTTP
import urllib.request, urllib.error
srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % srv.server_port
def http(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=dict({"Content-Type": "application/json"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b"{}"), r.headers
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}"), e.headers
ok(http("GET", "/healthz")[0] == 200 and http("GET", "/api/overview")[0] == 401 and http("GET", "/api/lit/opportunities")[0] == 401, "API refuses requests without a session")
ok(http("POST", "/api/login", {"password": "wrong"})[0] == 401, "wrong password rejected")
code, _, hd = http("POST", "/api/login", {"password": "correct-horse-battery"})
cookie = hd["Set-Cookie"].split(";")[0]
ok(code == 200 and "HttpOnly" in hd["Set-Cookie"] and "SameSite=Lax" in hd["Set-Cookie"], "login sets an HttpOnly session cookie")
ok(http("GET", "/api/overview", headers={"Cookie": cookie})[0] == 200 and http("GET", "/api/overview", headers={"Cookie": cookie[:-3] + "abc"})[0] == 401, "valid session accepted, tampered session refused")
ok(http("POST", "/api/settings", {"model": "x"}, {"Cookie": cookie, "Origin": "https://evil.example"})[0] == 403, "cross-site write refused")
ok("frame-ancestors 'none'" in http("GET", "/healthz")[2]["Content-Security-Policy"], "security headers present")
for s in R("GET", "/api/lit/sources") + R("GET", "/api/career/sources"):
    R("PATCH", f"/api/{'lit' if s in R('GET', '/api/lit/sources') else 'career'}/sources/{s['id']}", {"enabled": 0})
ok(http("POST", "/api/cron")[0] == 403 and http("POST", "/api/cron", headers={"Authorization": "Bearer nope"})[0] == 403, "cron endpoint refuses a missing or wrong token")
code, out, _ = http("POST", "/api/cron", headers={"Authorization": "Bearer cron-secret"})
ok(code == 200 and out["started"] is True, "cron ping with the token starts a due monitoring run")
import time
for _ in range(40):
    if not http("GET", "/api/cron/status", headers={"Authorization": "Bearer cron-secret"})[1]["running"]: break
    time.sleep(0.25)
ok(db.system_db().val("SELECT COUNT(*) FROM runs WHERE trigger='schedule'") == 2 and http("POST", "/api/cron", headers={"Authorization": "Bearer cron-secret"})[1]["started"] is False, "scheduled run recorded for both agents; second ping does not double-run")
for i in range(9): http("POST", "/api/login", {"password": "guess%d" % i})
ok(http("POST", "/api/login", {"password": "correct-horse-battery"})[0] == 429, "login locks after repeated wrong passwords")

# --- without a key nothing is faked
os.environ["ANTHROPIC_API_KEY"] = ""
r = R("POST", "/api/lit/signals", {"kind": "note", "body": "Some startup is rebranding", "analyze": True})
ok(r["result"] is None and db.agent_db(lit).one("SELECT status FROM signals WHERE id=?", (r["id"],))["status"] == "new", "no API key: signal stored, nothing analyzed or invented")
ok(raises(lambda: R("POST", f"/api/lit/signals/{r['id']}/analyze"), Exception), "no API key: analysis refuses with a clear error")
ok("test-key" not in json.dumps(R("GET", "/api/status")) and "test-key" not in json.dumps(R("GET", "/api/config")), "API key never returned by the API")
print(f"\nAll {n} checks passed.")
shutil.rmtree(tmp, ignore_errors=True)
