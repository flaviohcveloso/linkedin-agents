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


def _search_meta(content, meta):
    """Collect what web search actually returned, so callers can check that a URL really came from it."""
    for b in content or []:
        if b.get("type") == "server_tool_use":
            meta["searched"] = True
        if b.get("type") == "web_search_tool_result":
            c = b.get("content")
            if isinstance(c, dict):  # an error object, e.g. web search not enabled for the organization
                meta["errors"].append(c.get("error_code") or "web search error")
                continue
            for r in c or []:
                if r.get("type") == "web_search_result" and r.get("url"):
                    meta["results"][r["url"]] = r.get("title") or ""


def call_tool(system, user, tool, research=False, max_tokens=8000, require_search=False, max_searches=3):
    """Ask Claude and get back the input of `tool` as a dict, plus a meta dict:
    {"searched": bool, "results": {url: title} returned by web search, "errors": [...]}.
    With research=True Claude may use Anthropic's server-side web search (public web only). Without
    require_search, a failing search falls back to a plain call; with it, the error is raised.
    tool_choice stays "auto" because current models reject a forced tool; if Claude answers in text
    instead of calling the tool, it is asked once more."""
    if not configured():
        raise ClaudeError("Claude is not configured. Add ANTHROPIC_API_KEY to the environment and restart.")
    system = system + f"\n\nAlways finish by calling the `{tool['name']}` tool. Do not answer in plain text."
    base = {"model": db.get_setting("model"), "max_tokens": max_tokens, "system": system}
    meta = {"searched": False, "results": {}, "errors": []}
    if research:
        messages = [{"role": "user", "content": user}]
        tools = [{"type": WEB_SEARCH_TOOL, "name": "web_search", "max_uses": max_searches}, tool]
        try:
            for _ in range(4):
                resp = _post(dict(base, messages=messages, tool_choice={"type": "auto"}, tools=tools))
                _search_meta(resp.get("content"), meta)
                out = _tool_input(resp, tool["name"])
                if out is not None:
                    if require_search and meta["errors"] and not meta["results"]:
                        raise ClaudeError(", ".join(meta["errors"]))
                    return out, meta
                if resp.get("stop_reason") != "pause_turn":  # a long search turn is resumed as-is
                    messages = messages + [{"role": "assistant", "content": resp.get("content") or "(no answer)"},
                                           {"role": "user", "content": f"Now call the `{tool['name']}` tool."}]
                else:
                    messages = messages + [{"role": "assistant", "content": resp.get("content")}]
            raise ClaudeError("Claude returned no structured result.")
        except ClaudeError as e:
            if require_search:
                raise ClaudeError(f"Web search failed: {e}. Web search must be enabled for your organization in the Claude Console.")
        meta = {"searched": False, "results": {}, "errors": meta["errors"]}
    messages = [{"role": "user", "content": user}]
    for attempt in (0, 1):
        resp = _post(dict(base, messages=messages, tools=[tool], tool_choice={"type": "auto"}))
        out = _tool_input(resp, tool["name"])
        if out is not None:
            return out, meta
        if resp.get("stop_reason") == "max_tokens":
            raise ClaudeError("Claude ran out of output tokens before finishing. Try again or shorten the source text.")
        messages = messages + [{"role": "assistant", "content": resp.get("content") or "(no answer)"},
                               {"role": "user", "content": f"Now call the `{tool['name']}` tool with your assessment."}]
    raise ClaudeError("Claude returned no structured result.")
