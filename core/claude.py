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


def _tool_input(resp, name):
    for b in resp.get("content", []):
        if b.get("type") == "tool_use" and b.get("name") == name:
            return b["input"]
    return None


def call_tool(system, user, tool, research=False, max_tokens=8000):
    """Ask Claude and get back the input of `tool` as a dict. With research=True Claude may first use
    Anthropic's server-side web search (public web only); returns (result, used_web_search).
    tool_choice stays "auto" because current models reject a forced tool; if Claude answers in text
    instead of calling the tool, it is asked once more."""
    if not configured():
        raise ClaudeError("Claude is not configured. Add ANTHROPIC_API_KEY to the .env file and restart.")
    system = system + f"\n\nAlways finish by calling the `{tool['name']}` tool. Do not answer in plain text."
    base = {"model": db.get_setting("model"), "max_tokens": max_tokens, "system": system}
    messages = [{"role": "user", "content": user}]
    if research:
        try:
            resp = _post(dict(base, messages=messages, tool_choice={"type": "auto"},
                              tools=[{"type": WEB_SEARCH_TOOL, "name": "web_search", "max_uses": 3}, tool]))
            out = _tool_input(resp, tool["name"])
            if out is not None:
                return out, any(b.get("type") == "server_tool_use" for b in resp.get("content", []))
        except ClaudeError:
            pass  # fall back to a plain call without web search
    for attempt in (0, 1):
        resp = _post(dict(base, messages=messages, tools=[tool], tool_choice={"type": "auto"}))
        out = _tool_input(resp, tool["name"])
        if out is not None:
            return out, False
        if resp.get("stop_reason") == "max_tokens":
            raise ClaudeError("Claude ran out of output tokens before finishing. Try again or shorten the source text.")
        messages = messages + [{"role": "assistant", "content": resp.get("content") or "(no answer)"},
                               {"role": "user", "content": f"Now call the `{tool['name']}` tool with your assessment."}]
    raise ClaudeError("Claude returned no structured result.")
