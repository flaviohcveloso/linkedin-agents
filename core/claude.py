"""Claude API client (standard library only). The key is read from the environment / .env and never
leaves this module except in the request header to Anthropic."""
import json
import os
import urllib.error
import urllib.request

from . import db

WEB_SEARCH_TOOL = os.environ.get("CLAUDE_WEB_SEARCH_TOOL", "web_search_20250305")


class ClaudeError(Exception):
    pass


def api_key():
    return (os.environ.get("ANTHROPIC_API_KEY") or "").strip()


def configured():
    return bool(api_key())


def _post(payload):
    base = (os.environ.get("LIA_ANTHROPIC_URL") or "https://api.anthropic.com").rstrip("/")
    req = urllib.request.Request(
        base + "/v1/messages", data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "x-api-key": api_key(), "anthropic-version": "2023-06-01"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        try:
            detail = json.loads(detail)["error"]["message"]
        except Exception:
            pass
        raise ClaudeError(f"Claude API error {e.code}: {detail}")
    except Exception as e:
        raise ClaudeError(f"Could not reach the Claude API: {e}")


def call_tool(system, user, tool, research=False, max_tokens=3000):
    """Ask Claude and get back the input of `tool` as a dict. With research=True Claude may first use
    Anthropic's server-side web search (public web only); returns (result, used_web_search)."""
    if not configured():
        raise ClaudeError("Claude is not configured. Add ANTHROPIC_API_KEY to the .env file and restart.")
    base = {"model": db.get_setting("model"), "max_tokens": max_tokens, "system": system,
            "messages": [{"role": "user", "content": user}]}
    if research:
        payload = dict(base, tools=[{"type": WEB_SEARCH_TOOL, "name": "web_search", "max_uses": 3}, tool],
                       tool_choice={"type": "auto"})
        try:
            resp = _post(payload)
            searched = any(b.get("type") == "server_tool_use" for b in resp.get("content", []))
            for b in resp.get("content", []):
                if b.get("type") == "tool_use" and b.get("name") == tool["name"]:
                    return b["input"], searched
        except ClaudeError:
            pass  # fall back to a plain call without web search
    resp = _post(dict(base, tools=[tool], tool_choice={"type": "tool", "name": tool["name"]}))
    for b in resp.get("content", []):
        if b.get("type") == "tool_use":
            return b["input"], False
    raise ClaudeError("Claude returned no structured result.")
