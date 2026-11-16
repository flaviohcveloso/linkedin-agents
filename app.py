#!/usr/bin/env python3
"""LinkedIn Agents — web server.
Cloud: set APP_PASSWORD, DATABASE_URL, ANTHROPIC_API_KEY (see DEPLOY.md); the app requires login.
Local: python app.py, then open http://127.0.0.1:8765 (no login, localhost only)."""
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import time
import traceback
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env():
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()
from core import claude, db, engine, sources  # noqa: E402
from core.agents import AGENTS, public_config  # noqa: E402

PUBLIC = os.path.join(ROOT, "public")
PORT = int(os.environ.get("PORT", "8765"))
PASSWORD = os.environ.get("APP_PASSWORD") or ""
CRON_TOKEN = os.environ.get("CRON_TOKEN") or ""
SESSION_DAYS = 30
STATE = {"next_run": None, "running": set(), "fails": {}}


def session_secret():
    s = os.environ.get("SESSION_SECRET")
    if not s:
        s = db.get_setting("session_secret")
        if not s:
            s = secrets.token_hex(32)
            db.set_setting("session_secret", s)
    return s.encode()


def make_session():
    exp = str(int(time.time()) + SESSION_DAYS * 86400)
    return exp + "." + hmac.new(session_secret(), exp.encode(), hashlib.sha256).hexdigest()


def valid_session(cookie_header):
    m = re.search(r"(?:^|;\s*)lia_session=(\d+)\.([0-9a-f]{64})", cookie_header or "")
    if not m or int(m.group(1)) < time.time():
        return False
    return hmac.compare_digest(m.group(2), hmac.new(session_secret(), m.group(1).encode(), hashlib.sha256).hexdigest())


def login_allowed(ip):
    t, n = STATE["fails"].get(ip, (0, 0))
    return not (n >= 8 and time.time() - t < 900)


def login_failed(ip):
    t, n = STATE["fails"].get(ip, (0, 0))
    STATE["fails"][ip] = (time.time(), 1 if time.time() - t > 900 else n + 1)

LINKEDIN_ACCESS = [
    {"capability": "Read other people's profiles, posts or activity", "status": "unavailable", "detail": "No open API. Partner programs only; the Sales Navigator API (SNAP) is not accepting new partners.", "workflow": "You view the profile or post on LinkedIn and paste the text into Capture."},
    {"capability": "Search people or companies", "status": "unavailable", "detail": "No open endpoint for people search.", "workflow": "Claude names the role to look for; you search on LinkedIn and add the contact."},
    {"capability": "Send connection requests or messages", "status": "unavailable", "detail": "Messages and Invitations APIs are restricted to approved partners and bar automated sending. Bots and browser automation breach the User Agreement.", "workflow": "Approve here, then Copy and send it yourself on LinkedIn; mark it as sent."},
    {"capability": "Read your inbox / replies", "status": "unavailable", "detail": "Not exposed to individual developers.", "workflow": "Log the reply on the message card (positive / neutral / negative)."},
    {"capability": "Profile visitors, private engagement data", "status": "unavailable", "detail": "Not available through any API.", "workflow": "Not collected."},
    {"capability": "Your own connections list", "status": "manual", "detail": "Available through LinkedIn's own data export (Settings > Data privacy > Get a copy of your data).", "workflow": "Import Connections.csv below; contacts you already know are flagged."},
    {"capability": "Your own data via Member Data Portability API", "status": "unavailable", "detail": "Official, but only for members located in the EU/EEA/Switzerland.", "workflow": "Not applicable from Brazil."},
    {"capability": "Sign in with LinkedIn / Share on LinkedIn", "status": "not_needed", "detail": "Open self-serve products: your own basic profile and posting to your feed. Neither helps find or message prospects.", "workflow": "Not connected."},
    {"capability": "Public job postings and company news", "status": "available", "detail": "Public job-board APIs (Remotive, Remote OK, Greenhouse, Lever, Ashby) and RSS feeds, outside LinkedIn.", "workflow": "Fetched on a schedule by the sources below."},
]


def seed_sources():
    for key, agent in AGENTS.items():
        d = db.agent_db(agent)
        if not d.val("SELECT value FROM meta WHERE key='seeded'"):
            for s in sources.DEFAULT_SOURCES[key]:
                d.insert("sources", dict(s, enabled=1))
            d.run("INSERT INTO meta(key,value) VALUES('seeded','1')")


def status():
    sysdb = db.system_db()
    return {"claude": claude.configured(), "model": db.get_setting("model"),
            "settings": {k: db.get_setting(k) for k in db.DEFAULT_SETTINGS},
            "next_run": STATE["next_run"], "running": sorted(STATE["running"]),
            "last_runs": sysdb.all("SELECT * FROM runs ORDER BY id DESC LIMIT 8"),
            "connections": sysdb.val("SELECT COUNT(*) FROM network"),
            "linkedin_send": "manual", "database": db.backend(), "login": bool(PASSWORD), "cron": bool(CRON_TOKEN)}


def start_run(agent, trigger, only_source=None):
    def work():
        STATE["running"].add(agent["key"])
        try:
            engine.run_monitor(agent, trigger, only_source)
        except Exception:
            traceback.print_exc()
        finally:
            STATE["running"].discard(agent["key"])
    threading.Thread(target=work, daemon=True).start()


def run_if_due(force=False):
    """Start a monitoring run for both agents if the interval has passed. Used by the in-process timer
    and by the external /api/cron ping, so a sleeping host cannot cause double or missed runs."""
    if db.get_setting("scheduler_enabled") != "1":
        STATE["next_run"] = None
        return False
    hours = max(1.0, float(db.get_setting("interval_hours") or 6))
    last = db.system_db().val("SELECT MAX(started_at) FROM runs WHERE trigger='schedule'")
    due = datetime.strptime(last, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) + timedelta(hours=hours) if last else datetime.now(timezone.utc)
    STATE["next_run"] = due.strftime("%Y-%m-%dT%H:%M:%SZ")
    if (force or datetime.now(timezone.utc) >= due) and not STATE["running"]:
        for agent in AGENTS.values():
            start_run(agent, "schedule")
        return True
    return False


def scheduler():
    time.sleep(5)
    while True:
        try:
            if run_if_due():
                time.sleep(10)
        except Exception:
            traceback.print_exc()
        time.sleep(30)


class HttpError(Exception):
    def __init__(self, code, msg):
        self.code, self.msg = code, msg


def opp_detail(agent, oid):
    d = db.agent_db(agent)
    o = d.one("SELECT * FROM opportunities WHERE id=?", (oid,))
    if not o:
        raise HttpError(404, "Not found")
    o["contacts"] = d.all("SELECT * FROM contacts WHERE opportunity_id=? ORDER BY (name!='') DESC, id", (oid,))
    o["messages"] = d.all("SELECT * FROM messages WHERE opportunity_id=? ORDER BY id DESC", (oid,))
    o["signal"] = d.one("SELECT * FROM signals WHERE id=?", (o["signal_id"],))
    o["events"] = d.all("SELECT * FROM events WHERE opportunity_id=? ORDER BY id DESC LIMIT 30", (oid,))
    return o


def route(method, path, q, body):
    seg = [s for s in path.split("/") if s][1:]  # drop 'api'
    if seg == ["config"]:
        return {"agents": {k: dict(public_config(a), criteria=engine.criteria(a), default_criteria=a["criteria"], guidance=engine.guidance(a)) for k, a in AGENTS.items()}, "source_types": sources.SOURCE_TYPES,
                "linkedin_access": LINKEDIN_ACCESS}
    if seg == ["status"]:
        return status()
    if seg == ["overview"]:
        return {k: engine.overview(a) for k, a in AGENTS.items()}
    if seg == ["settings"] and method == "POST":
        for k, v in body.items():
            if k in db.DEFAULT_SETTINGS:
                db.set_setting(k, v)
        return status()
    if seg == ["network", "import"] and method == "POST":
        rows = sources.parse_connections_csv(body.get("csv") or "")
        sysdb = db.system_db()
        for r in rows:
            sysdb.run("INSERT INTO network(first_name,last_name,company,position,url,connected_on) VALUES(?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET company=excluded.company, position=excluded.position",
                      (r["first_name"], r["last_name"], r["company"], r["position"], r["url"], r["connected_on"]))
        return {"imported": len(rows)}
    if not seg or seg[0] not in AGENTS:
        raise HttpError(404, "Not found")
    agent, rest = AGENTS[seg[0]], seg[1:]
    d = db.agent_db(agent)
    ident = int(rest[1]) if len(rest) > 1 and rest[1].isdigit() else None

    if rest == ["run"] and method == "POST":
        start_run(agent, "manual", body.get("source"))
        return {"started": True}

    if rest[:1] == ["signals"]:
        if method == "GET":
            st = q.get("status", ["open"])[0]
            where = "status IN('new','analyzing','error')" if st == "open" else "status='irrelevant'" if st == "irrelevant" else "1=1"
            return d.all(f"SELECT * FROM signals WHERE {where} ORDER BY id DESC LIMIT 200")
        if method == "POST" and rest[1:] == ["dismiss_all"]:
            d.run("UPDATE signals SET status='irrelevant', error='Dismissed by Flávio' WHERE status IN('new','error')")
            return {"ok": True}
        if method == "POST" and ident is None:
            if not (body.get("body") or "").strip():
                raise HttpError(400, "Paste the text of the post, profile or job description.")
            sid = engine.ingest(agent, body, "user_provided")
            if not sid:
                raise HttpError(409, "This was already captured.")
            result = None
            if body.get("analyze") and claude.configured():
                result = engine.analyze(agent, sid, research=db.get_setting("web_research") == "1")
            return {"id": sid, "result": result}
        if method == "POST" and rest[2:] == ["analyze"]:
            return engine.analyze(agent, ident, research=bool(body.get("research")) or db.get_setting("web_research") == "1")
        if method == "POST" and rest[2:] == ["dismiss"]:
            d.update("signals", ident, {"status": "irrelevant", "error": "Dismissed by Flávio"})
            return {"ok": True}

    if rest[:1] == ["opportunities"]:
        if method == "GET" and ident is None:
            rows = d.all("SELECT * FROM opportunities ORDER BY parked, score DESC, id DESC")
            for o in rows:
                o["contact"] = d.one("SELECT name,title,basis FROM contacts WHERE opportunity_id=? ORDER BY (name!='') DESC, id LIMIT 1", (o["id"],))
                o["messages"] = d.val("SELECT COUNT(*) FROM messages WHERE opportunity_id=? AND status!='rejected'", (o["id"],))
            return rows
        if method == "GET" and rest[2:] == ["ics"]:
            o = opp_detail(agent, ident)
            if not o["meeting_at"]:
                raise HttpError(400, "Set a date first")
            return ("text/calendar", engine.ics(agent, o))
        if method == "GET":
            return opp_detail(agent, ident)
        if method == "POST" and rest[2:] == ["contacts"]:
            if not (body.get("name") or "").strip():
                raise HttpError(400, "Name is required")
            engine.add_contact(agent, ident, body)
            return opp_detail(agent, ident)
        if method == "POST" and rest[2:] == ["draft"]:
            engine.draft(agent, ident, body.get("contact_id"), body.get("type"))
            return opp_detail(agent, ident)
        if method == "POST" and rest[2:] == ["research"]:
            o = opp_detail(agent, ident)
            engine.analyze(agent, o["signal_id"], research=True)
            return opp_detail(agent, ident)
        if method == "PATCH":
            if "stage" in body:
                engine.set_stage(agent, ident, body["stage"])
            upd = {k: body[k] for k in ("notes", "meeting_at", "parked", "conflict_ack") if k in body}
            if upd:
                d.update("opportunities", ident, dict(upd, updated_at=db.now()))
            return opp_detail(agent, ident)

    if rest[:1] == ["contacts"] and method == "DELETE":
        if d.val("SELECT 1 FROM messages WHERE contact_id=?", (ident,)):
            raise HttpError(400, "This contact has messages and cannot be removed.")
        d.run("DELETE FROM contacts WHERE id=?", (ident,))
        return {"ok": True}

    if rest[:1] == ["messages"]:
        if method == "GET":
            return d.all("""SELECT m.*, o.company, o.score, o.classification, o.conflict, o.conflict_ack, o.headline,
                            c.name contact_name, c.title contact_title, c.linkedin_url, c.connected
                            FROM messages m JOIN opportunities o ON o.id=m.opportunity_id LEFT JOIN contacts c ON c.id=m.contact_id
                            ORDER BY m.id DESC LIMIT 300""")
        if method == "POST" and ident:
            return engine.message_action(agent, ident, body.get("action"), body)

    if rest == ["scoring"] and method == "POST":
        engine.save_scoring(agent, body.get("weights") or {}, body.get("guidance"))
        return {"ok": True}

    if rest == ["analytics"]:
        return engine.analytics(agent)

    if rest[:1] == ["sources"]:
        if method == "GET":
            return d.all("SELECT * FROM sources ORDER BY id")
        if method == "POST" and ident is None:
            if body.get("type") not in sources.SOURCE_TYPES:
                raise HttpError(400, "Unknown source type")
            cfg = body.get("config") or {}
            cfg["keywords"] = [k.strip() for k in cfg.get("keywords") or [] if k.strip()]
            return {"id": d.insert("sources", {"type": body["type"], "name": body.get("name") or body["type"], "config": cfg, "enabled": 1})}
        if method == "PATCH":
            upd = {k: body[k] for k in ("enabled", "name", "config") if k in body}
            d.update("sources", ident, upd)
            return {"ok": True}
        if method == "DELETE":
            d.run("DELETE FROM sources WHERE id=?", (ident,))
            return {"ok": True}
    raise HttpError(404, "Not found")


class Handler(BaseHTTPRequestHandler):
    server_version = "LinkedInAgents/1.0"

    def log_message(self, *a):
        pass

    def send(self, code, payload, ctype="application/json"):
        data = payload if isinstance(payload, bytes) else (payload if ctype != "application/json" else json.dumps(payload)).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith(("text", "application/j")) else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if self.https():
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        for h in getattr(self, "extra_headers", []):
            self.send_header(*h)
        self.end_headers()
        self.wfile.write(data)

    def https(self):
        return self.headers.get("X-Forwarded-Proto", "") == "https"

    def client_ip(self):
        return (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()

    def cookie(self, value, max_age):
        self.extra_headers = [("Set-Cookie", f"lia_session={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}" + ("; Secure" if self.https() else ""))]

    def special(self, u, body):
        """Routes that work without a session: health check, login, and the token-protected cron ping."""
        if u.path == "/healthz":
            return {"ok": True}
        if u.path == "/api/session":
            return {"login_required": bool(PASSWORD), "authenticated": not PASSWORD or valid_session(self.headers.get("Cookie"))}
        if u.path == "/api/login" and self.command == "POST":
            ip = self.client_ip()
            if not login_allowed(ip):
                raise HttpError(429, "Too many attempts. Try again in 15 minutes.")
            if PASSWORD and hmac.compare_digest(str(body.get("password") or "").encode(), PASSWORD.encode()):
                STATE["fails"].pop(ip, None)
                self.cookie(make_session(), SESSION_DAYS * 86400)
                return {"ok": True}
            login_failed(ip)
            time.sleep(0.6)
            raise HttpError(401, "Wrong password")
        if u.path == "/api/logout" and self.command == "POST":
            self.cookie("0.0", 0)
            return {"ok": True}
        if u.path.startswith("/api/cron"):
            given = (self.headers.get("Authorization") or "").replace("Bearer ", "")
            if not CRON_TOKEN or not hmac.compare_digest(given.encode(), CRON_TOKEN.encode()):
                raise HttpError(403, "Forbidden")
            started = run_if_due() if u.path == "/api/cron" else False
            time.sleep(1 if started else 0)
            return {"started": started, "running": sorted(STATE["running"]), "next_run": STATE["next_run"]}
        return None

    def handle_any(self):
        self.extra_headers = []
        u = urlparse(self.path)
        if not u.path.startswith("/api/") and u.path != "/healthz":
            if self.command != "GET":
                return self.send(405, {"error": "Method not allowed"})
            rel = "index.html" if u.path == "/" else u.path.lstrip("/")
            full = os.path.realpath(os.path.join(PUBLIC, rel))
            if not full.startswith(os.path.realpath(PUBLIC) + os.sep) or not os.path.isfile(full):
                return self.send(404, b"Not found", "text/plain")
            return self.send(200, open(full, "rb").read(), mimetypes.guess_type(full)[0] or "application/octet-stream")
        try:
            # Refuse state-changing requests that come from another site.
            origin = self.headers.get("Origin")
            if origin and self.command != "GET" and urlparse(origin).netloc != self.headers.get("Host"):
                raise HttpError(403, "Forbidden")
            body = {}
            n = int(self.headers.get("Content-Length") or 0)
            if n > 6_000_000:
                raise HttpError(413, "Too large")
            if n:
                body = json.loads(self.rfile.read(n) or b"{}")
            out = self.special(u, body)
            if out is None:
                if PASSWORD and not valid_session(self.headers.get("Cookie")):
                    raise HttpError(401, "Sign in required")
                out = route(self.command, u.path, parse_qs(u.query), body)
            if isinstance(out, tuple):
                return self.send(200, out[1], out[0])
            self.send(200, out)
        except HttpError as e:
            self.send(e.code, {"error": e.msg})
        except PermissionError as e:
            self.send(409, {"error": str(e)})
        except (ValueError, claude.ClaudeError) as e:
            self.send(400, {"error": str(e)})
        except Exception as e:
            traceback.print_exc()
            self.send(500, {"error": f"{type(e).__name__}: {e}"})

    do_GET = do_POST = do_PATCH = do_DELETE = handle_any


def main():
    if db.DATABASE_URL and not db.DATABASE_URL.startswith("postgres"):
        sys.exit("DATABASE_URL is set but is not a Postgres connection string. It must start with postgresql://")
    try:
        seed_sources()
    except Exception as e:
        if db.DATABASE_URL:
            sys.exit(f"Could not connect to the database with DATABASE_URL: {type(e).__name__}: {str(e)[:300]}")
        raise
    # Signals left mid-analysis or failed before this start go back to the queue.
    for a in AGENTS.values():
        db.agent_db(a).run("UPDATE signals SET status='new', error=NULL WHERE status IN('analyzing','error')")
    for a in AGENTS.values():
        engine.repair_stored_companies(a)
    threading.Thread(target=scheduler, daemon=True).start()
    cloud = bool(os.environ.get("RENDER") or db.DATABASE_URL or os.environ.get("HOST"))
    if cloud and len(PASSWORD) < 10:
        sys.exit("Refusing to start on a public host without APP_PASSWORD (at least 10 characters).")
    host = os.environ.get("HOST") or ("0.0.0.0" if cloud else "127.0.0.1")
    srv = ThreadingHTTPServer((host, PORT), Handler)
    print(f"LinkedIn Agents running at http://{host}:{PORT} — database: {db.backend()}, login: {'on' if PASSWORD else 'off (localhost only)'}")
    print("Claude API key: " + ("configured" if claude.configured() else "NOT configured (add ANTHROPIC_API_KEY to .env)"))
    print("Press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    if sys.version_info < (3, 9):
        sys.exit("Python 3.9 or newer is required.")
    main()
