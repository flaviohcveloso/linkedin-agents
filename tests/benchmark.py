"""Counts database round trips and wall time per screen, with a simulated per-query latency.
Usage: python tests/benchmark.py . new [n_leads] [latency_ms]   (simulates DB latency; prints round trips per screen)"""
import json, os, random, sys, tempfile, time
APP, FLOW = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 500
LAT = float(sys.argv[4]) / 1000 if len(sys.argv) > 4 else 0.02
os.environ.update({"LIA_DATA_DIR": tempfile.mkdtemp(), "ANTHROPIC_API_KEY": ""})
sys.path.insert(0, APP)
import app
from core import db
from core.agents import AGENTS
app.seed_sources()
random.seed(1)
for k, a in AGENTS.items():
    d = db.agent_db(a)
    for i in range(N):
        sid = d.insert("signals", {"created_at": db.now(), "source_name": "bench", "kind": "company_news", "provenance": "retrieved",
                                   "title": f"Signal {i}", "body": "x" * 3000, "dedupe": f"{k}{i}", "status": "analyzed"})
        oid = d.insert("opportunities", {"created_at": db.now(), "updated_at": db.now(), "signal_id": sid, "company": f"Co {i}",
            "headline": "h", "summary": "s" * 300, "score": random.randint(0, 100), "classification": "x", "breakdown": [{"label": "a", "points": 1, "max": 2, "reason": "r" * 200}] * 7,
            "detected": [{"type": "funding_round", "evidence": "e" * 100, "basis": "stated_in_source"}], "facts": [{"statement": "f" * 100, "basis": "hypothesis"}] * 3,
            "services": [], "role": {}, "next_step": "n", "stage": a["stages"][2], "stage_changed_at": db.now(), "parked": i % 3 == 0})
        d.update("signals", sid, {"opportunity_id": oid})
        d.insert("contacts", {"opportunity_id": oid, "name": f"Person {i}", "title": "CEO", "linkedin_url": "", "basis": "stated_in_source", "why": "w"})
        if i % 10 == 0:
            d.insert("messages", {"opportunity_id": oid, "contact_id": None, "created_at": db.now(), "type": "connection_request", "suggested": "m", "final_text": "m", "status": "drafted"})
        d.insert("events", {"at": db.now(), "opportunity_id": oid, "type": "stage", "data": {"to": a["stages"][2]}})
    for i in range(N // 2):
        d.insert("signals", {"created_at": db.now(), "source_name": "bench", "kind": "company_news", "provenance": "retrieved",
                             "title": f"Rejected {i}", "body": "y" * 3000, "dedupe": f"{k}r{i}", "status": "irrelevant", "error": "Not relevant"})
for k in list(db._dbs): pass
# instrument
COUNT = {"q": 0}
orig = db.DB._exec
def timed(self, sql, args=()):
    COUNT["q"] += 1; time.sleep(LAT); return orig(self, sql, args)
db.DB._exec = timed
if hasattr(db, "_settings_cache"): db._settings_cache.clear()
R = lambda path: app.route("GET", path.split("?")[0], {k: [v] for k, v in (p.split("=") for p in path.split("?")[1].split("&"))} if "?" in path else {}, {})
FLOWS = {
 "old": {"Dashboard (every screen and every click reloads this)": ["/api/status", "/api/overview"] + [f"/api/{a}/{x}" for a in ("lit", "career") for x in ("opportunities", "signals", "messages")]},
 "new": {"Dashboard": ["/api/status", "/api/overview"], "Leads, first page": ["/api/leads?agent=all&category=all&page=1"],
         "Leads, next page / filter change (cached)": ["/api/leads?agent=all&category=qualified&page=2"], "Inbox": ["/api/messages?agent=all"]},
}
for name, calls in FLOWS[FLOW].items():
    COUNT["q"] = 0; t = time.time(); size = 0
    for c in calls:
        size += len(json.dumps(R(c), default=str))
    print(f"{name}: {len(calls)} requests, {COUNT['q']} DB round trips, {time.time()-t:.2f}s, {size/1024:.0f} KB of JSON")
