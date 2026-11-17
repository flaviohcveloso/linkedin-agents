"""Storage. One database per agent (lit, career) so their data can never be joined, plus `system` for
things that belong to the platform itself (settings, run log, imported connections).

Locally each is its own SQLite file. In the cloud (DATABASE_URL set) each is its own Postgres schema on
one shared connection; every table reference is rewritten to its schema, so the agents never read each
other's tables. Every write bumps `DB.version`, which the engine uses to cache read-heavy views."""
import json
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone

DATA_DIR = os.environ.get("LIA_DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

AGENT_SCHEMA = """
CREATE TABLE IF NOT EXISTS signals(
  id INTEGER PRIMARY KEY, created_at TEXT, source_id INTEGER, source_name TEXT, kind TEXT,
  provenance TEXT, url TEXT, title TEXT, company TEXT, author TEXT, author_title TEXT, body TEXT,
  dedupe TEXT UNIQUE, status TEXT DEFAULT 'new', error TEXT, opportunity_id INTEGER, attempts INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS opportunities(
  id INTEGER PRIMARY KEY, created_at TEXT, updated_at TEXT, signal_id INTEGER,
  company TEXT, company_url TEXT, industry TEXT, company_stage TEXT, headline TEXT, summary TEXT,
  score INTEGER, classification TEXT, breakdown TEXT, detected TEXT, facts TEXT, services TEXT, role TEXT,
  next_step TEXT, stage TEXT, stage_changed_at TEXT, parked INTEGER DEFAULT 0, notes TEXT,
  meeting_at TEXT, conflict TEXT, conflict_ack INTEGER DEFAULT 0, researched INTEGER DEFAULT 0,
  ai_verdict TEXT DEFAULT 'relevant', rejection_reason TEXT, decision TEXT DEFAULT 'new', decided_at TEXT);
CREATE TABLE IF NOT EXISTS contacts(
  id INTEGER PRIMARY KEY, opportunity_id INTEGER, name TEXT, title TEXT, linkedin_url TEXT,
  basis TEXT, why TEXT, connected INTEGER DEFAULT 0,
  location TEXT, url_status TEXT DEFAULT 'missing', url_evidence TEXT, url_checked_at TEXT);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, opportunity_id INTEGER, contact_id INTEGER, created_at TEXT, type TEXT,
  signal_ref TEXT, rationale TEXT, angle TEXT, suggested TEXT, alternative TEXT, follow_up TEXT, final_text TEXT,
  status TEXT DEFAULT 'drafted', edited INTEGER DEFAULT 0, lint TEXT,
  approved_at TEXT, sent_at TEXT, reply TEXT DEFAULT 'none', replied_at TEXT);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, at TEXT, opportunity_id INTEGER, type TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS sources(
  id INTEGER PRIMARY KEY, type TEXT, name TEXT, config TEXT, enabled INTEGER DEFAULT 1,
  last_run_at TEXT, last_status TEXT, last_new INTEGER);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_contacts_opp ON contacts(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_messages_opp ON messages(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_events_opp ON events(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_opp ON signals(opportunity_id)
"""

# Columns added after the first release. Existing databases get them through ALTER TABLE on start.
ADDED_COLUMNS = {
    "signals": [("attempts", "INTEGER DEFAULT 0")],
    "opportunities": [("ai_verdict", "TEXT DEFAULT 'relevant'"), ("rejection_reason", "TEXT"),
                      ("decision", "TEXT DEFAULT 'new'"), ("decided_at", "TEXT")],
    "contacts": [("location", "TEXT"), ("url_status", "TEXT DEFAULT 'missing'"), ("url_evidence", "TEXT"),
                 ("url_checked_at", "TEXT")],
}

SYSTEM_SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS runs(
  id INTEGER PRIMARY KEY, agent TEXT, started_at TEXT, finished_at TEXT, trigger TEXT,
  fetched INTEGER DEFAULT 0, new_signals INTEGER DEFAULT 0, analyzed INTEGER DEFAULT 0, errors TEXT);
CREATE TABLE IF NOT EXISTS network(
  id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, company TEXT, position TEXT,
  url TEXT UNIQUE, connected_on TEXT)
"""

JSON_COLS = {"breakdown", "detected", "facts", "services", "role", "config", "lint", "data"}


def _clean_url(raw):
    """Neon's Connect dialog shows `psql 'postgresql://...'`; accept that paste as well as the bare URL."""
    raw = (raw or "").strip()
    m = re.search(r"postgres(?:ql)?://[^\s'\"]+", raw)
    return m.group(0) if m else raw


DATABASE_URL = _clean_url(os.environ.get("DATABASE_URL"))
TABLES = "signals|opportunities|contacts|messages|events|sources|meta|settings|runs|network"
_TABLE_RE = re.compile(r"\b(FROM|JOIN|INTO|UPDATE|TABLE IF NOT EXISTS|ALTER TABLE|ON)\s+(%s)\b" % TABLES)

# Per-request diagnostics: how many round trips and how long they took (read by app.py).
_tl = threading.local()


def reset_stats():
    _tl.q, _tl.ms = 0, 0.0


def stats():
    return getattr(_tl, "q", 0), getattr(_tl, "ms", 0.0)


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def backend():
    return "postgres" if DATABASE_URL else "sqlite"


class _PG:
    """The single Postgres connection shared by all schemas, and the lock that serialises its use."""
    conn = None
    lock = threading.RLock()

    @classmethod
    def connect(cls):
        import psycopg
        from psycopg.rows import dict_row
        if cls.conn is not None:
            try:
                cls.conn.close()
            except Exception:
                pass
        cls.conn = psycopg.connect(DATABASE_URL, autocommit=True, row_factory=dict_row, connect_timeout=20,
                                   keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=3)


class DB:
    def __init__(self, name, schema):
        self.name = name
        self.version = 0
        self.pg = bool(DATABASE_URL)
        if self.pg:
            self.lock = _PG.lock
            with self.lock:
                if _PG.conn is None:
                    _PG.connect()
                _PG.conn.execute(f"CREATE SCHEMA IF NOT EXISTS {name}")
                for stmt in schema.split(";"):
                    if stmt.strip():
                        _PG.conn.execute(self._sql(stmt.replace("INTEGER PRIMARY KEY", "BIGSERIAL PRIMARY KEY")))
        else:
            self.lock = threading.RLock()
            os.makedirs(DATA_DIR, exist_ok=True)
            self.path = os.path.join(DATA_DIR, name + ".db")
            self.conn = sqlite3.connect(self.path, check_same_thread=False)
            self.conn.row_factory = sqlite3.Row
            # Create tables first, then add new columns, then indexes (an index may use a new column).
            stmts = [s for s in schema.split(";") if s.strip()]
            for s in stmts:
                if "CREATE INDEX" not in s:
                    self.conn.execute(s)
        if schema is AGENT_SCHEMA:
            self._add_columns()
        if not self.pg:
            for s in [s for s in schema.split(";") if "CREATE INDEX" in s]:
                self.conn.execute(s)
            self.conn.commit()

    def _add_columns(self):
        for table, cols in ADDED_COLUMNS.items():
            if self.pg:
                have = {r["column_name"] for r in _PG.conn.execute(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s", (self.name, table)).fetchall()}
            else:
                have = {r[1] for r in self.conn.execute(f"PRAGMA table_info({table})").fetchall()}
            for col, typ in cols:
                if col not in have:
                    if self.pg:
                        _PG.conn.execute(self._sql(f"ALTER TABLE {table} ADD COLUMN {col} {typ}"))
                    else:
                        self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")

    def _sql(self, sql):
        sql = _TABLE_RE.sub(lambda m: f"{m.group(1)} {self.name}.{m.group(2)}", sql)
        return sql.replace("?", "%s")

    def _exec(self, sql, args=()):
        """Returns a cursor. Postgres: reconnects once if the server dropped an idle connection."""
        t = time.perf_counter()
        try:
            if not self.pg:
                return self.conn.execute(sql, args)
            import psycopg
            q = self._sql(sql)
            for attempt in (0, 1):
                try:
                    return _PG.conn.execute(q, tuple(args) or None)
                except (psycopg.OperationalError, psycopg.InterfaceError):
                    if attempt:
                        raise
                    _PG.connect()
        finally:
            _tl.q = getattr(_tl, "q", 0) + 1
            _tl.ms = getattr(_tl, "ms", 0.0) + (time.perf_counter() - t) * 1000

    @staticmethod
    def _row(r):
        if r is None:
            return None
        d = dict(r)
        for k in d:
            if k in JSON_COLS and isinstance(d[k], str):
                try:
                    d[k] = json.loads(d[k])
                except ValueError:
                    pass
        return d

    def all(self, sql, args=()):
        with self.lock:
            return [self._row(r) for r in self._exec(sql, args).fetchall()]

    def one(self, sql, args=()):
        with self.lock:
            return self._row(self._exec(sql, args).fetchone())

    def val(self, sql, args=()):
        with self.lock:
            r = self._exec(sql, args).fetchone()
            return (list(r.values())[0] if self.pg else r[0]) if r else None

    def run(self, sql, args=()):
        """Writes. Bumps the version so cached views are rebuilt."""
        with self.lock:
            cur = self._exec(sql, args)
            if not self.pg:
                self.conn.commit()
            self.version += 1
            return cur

    def insert(self, table, row):
        row = {k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in row.items()}
        sql = f"INSERT INTO {table}({','.join(row)}) VALUES({','.join('?' * len(row))})"
        with self.lock:
            if self.pg:
                rid = self._exec(sql + " RETURNING id", tuple(row.values())).fetchone()["id"]
                self.version += 1
                return rid
            return self.run(sql, tuple(row.values())).lastrowid

    def update(self, table, id_, row):
        if not row:
            return
        row = {k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in row.items()}
        sets = ",".join(f"{k}=?" for k in row)
        self.run(f"UPDATE {table} SET {sets} WHERE id=?", tuple(row.values()) + (id_,))


_dbs = {}
_guard = threading.Lock()


def agent_db(agent):
    with _guard:
        if agent["key"] not in _dbs:
            _dbs[agent["key"]] = DB(agent["key"], AGENT_SCHEMA)
        return _dbs[agent["key"]]


def system_db():
    with _guard:
        if "system" not in _dbs:
            _dbs["system"] = DB("system", SYSTEM_SCHEMA)
        return _dbs["system"]


DEFAULT_SETTINGS = {
    "model": os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5"),
    "scheduler_enabled": "1",
    "interval_hours": "6",
    "analyze_per_run": "10",
    "daily_analysis_cap": "40",
    "web_research": "0",
    "profile_lookup": "1",
    "profile_lookup_min_score": "50",
    "profile_lookups_per_day": "10",
}

# Settings are read on almost every request (session check, model name); keep them in memory.
_settings_cache = {}
_settings_lock = threading.Lock()


def _load_settings():
    with _settings_lock:
        if not _settings_cache:
            _settings_cache.update({r["key"]: r["value"] for r in system_db().all("SELECT key, value FROM settings")})
            _settings_cache["__loaded__"] = "1"


def get_setting(key):
    _load_settings()
    v = _settings_cache.get(key)
    return v if v is not None else DEFAULT_SETTINGS.get(key)


def set_setting(key, value):
    system_db().run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (key, str(value)))
    _load_settings()
    with _settings_lock:
        _settings_cache[key] = str(value)
