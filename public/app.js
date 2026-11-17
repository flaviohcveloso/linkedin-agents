"use strict";
/* LinkedIn Agents — single-page client.
   Each screen declares the API URLs it needs; responses are cached so switching screens is instant, and
   after a change only the current screen (and the open lead) is refetched. */
const AG = ["lit", "career"];
const S = {
  cfg: null, status: null, page: "dashboard", agent: "lit", agentTab: "leads", cache: {}, inflight: {}, tok: 0,
  drawer: null, opp: null, sig: null, editContact: null, sel: new Map(), inboxTab: "review", inboxAgent: "all", irr: false,
  lf: { agent: "all", category: "all", q: "", linkedin: "", sort: "newest", page: 1, size: 50 },
  af: { category: "all", q: "", linkedin: "", sort: "newest", page: 1, size: 50 },
};
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const day = (t) => (t ? String(t).slice(0, 10) : "");
const nice = (s) => String(s || "").replace(/_/g, " ");
const when = (t) => (t ? new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const short = (t, n) => { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const C = (k) => S.cfg.agents[k];
const AGN = { lit: "Lit Collective", career: "Career" };

/* ------------------------------------------------------------ data */
async function api(method, path, body) {
  const r = await fetch("/api" + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/login") { showLogin(); throw new Error("Sign in to continue"); }
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j;
}
function fetchUrl(u, force) {
  const c = S.cache[u];
  if (c && !force && Date.now() - c.t < 5000) return Promise.resolve(c.d);
  if (S.inflight[u]) return S.inflight[u];
  const p = api("GET", u).then((d) => { S.cache[u] = { d, t: Date.now() }; delete S.inflight[u]; return d; }, (e) => { delete S.inflight[u]; throw e; });
  return (S.inflight[u] = p);
}
const qs = (o) => Object.entries(o).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const leadsUrl = (f, agent) => "/leads?" + qs({ agent: agent || f.agent, category: f.category, q: f.q, linkedin: f.linkedin, sort: f.sort, page: f.page, size: f.size });
function invalidate() { S.cache = {}; }

const PAGES = {
  dashboard: { urls: () => ["/overview"], html: (o) => vDash(o) },
  leads: { urls: () => [leadsUrl(S.lf)], html: (d) => vLeadsPage(d) },
  agent: { urls: () => (S.agentTab === "capture" ? [`/${S.agent}/signals`] : [leadsUrl(S.af, S.agent)]), html: (d) => vAgent(d) },
  inbox: { urls: () => ["/messages?agent=all"].concat(S.inboxTab === "new" ? [leadsUrl({ category: "qualified", sort: "score", page: 1, size: 30 }, "all")] : []), html: (m, n) => vInbox(m, n) },
  pipelines: { urls: () => [`/${S.agent}/board`], html: (b) => vPipes(b) },
  analytics: { urls: () => [`/${S.agent}/analytics`, "/overview"], html: (a, o) => vAnalytics(a, o) },
  settings: { urls: () => ["/lit/sources", "/career/sources", "/diagnostics"], html: (l, c, d) => vSettings(l, c, d) },
};

async function show(force) {
  const pg = PAGES[S.page], urls = pg.urls(), tok = ++S.tok;
  const cached = urls.map((u) => S.cache[u] && S.cache[u].d);
  const have = cached.every((x) => x !== undefined);
  if (have) paint(pg, cached); else if (!force) $("#main").innerHTML = `<div class="loading">Loading…</div>`;
  try {
    const fresh = await Promise.all(urls.map((u) => fetchUrl(u, force)));
    if (tok === S.tok && (!have || fresh.some((d, i) => d !== cached[i]))) paint(pg, fresh);
  } catch (e) { if (tok === S.tok) toast(e.message, true); }
}
function paint(pg, data) {
  const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart;
  $("#main").className = S.page === "agent" ? S.agent : "";
  $("#main").innerHTML = pg.html(...data);
  renderNav();
  if (id && $("#" + id)) { const n = $("#" + id); n.focus(); if (pos != null && n.setSelectionRange) n.setSelectionRange(pos, pos); }
}
async function refreshDrawer() {
  if (!S.drawer) return;
  if (S.drawer.kind === "signal") S.sig = await api("GET", `/${S.drawer.agent}/signals/${S.drawer.id}`);
  else S.opp = await api("GET", `/${S.drawer.agent}/opportunities/${S.drawer.id}`);
  renderDrawer();
}
async function after(msg) { invalidate(); if (msg) toast(msg); await Promise.all([show(true), refreshDrawer(), loadStatus()]); }
async function loadStatus() { try { S.status = await api("GET", "/status"); renderNav(); } catch (e) { /* offline */ } }

function toast(msg, bad) {
  const t = $("#toast"); t.textContent = msg; t.className = bad ? "bad" : ""; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), bad ? 7000 : 2600);
}
async function busy(el, fn) {
  const old = el && el.textContent, isBtn = el && el.tagName === "BUTTON";
  if (isBtn) { el.disabled = true; el.textContent = "Working…"; }
  try { await fn(); } catch (e) { toast(e.message, true); }
  finally { if (isBtn && el.isConnected) { el.disabled = false; el.textContent = old; } }
}

/* ------------------------------------------------------------ small parts */
function badge(basis, prov) {
  if (basis === "hypothesis") return '<span class="chip b-hyp">AI hypothesis</span>';
  if (basis === "public_web") return '<span class="chip b-web">Public information</span>';
  if (basis === "user_provided" || prov === "user_provided") return '<span class="chip b-user">User-provided</span>';
  return '<span class="chip b-retrieved">Retrieved data</span>';
}
const scoreDot = (n, k) => (n == null ? '<div class="score s0" title="Not scored yet">–</div>' : `<div class="score ${k || ""} ${n >= 90 ? "s90" : n < 50 ? "s0" : ""}">${n}</div>`);
const CAT = {
  qualified: ["Qualified", "b-ok"], unqualified: ["Unqualified", ""], pipeline: ["In pipeline", "b-info"], rejected: ["Rejected by AI", "b-bad"],
  dismissed: ["Dismissed", "b-mute"], pending: ["Pending analysis", "b-warn"],
};
const catChip = (r) => (r.signal_status === "error" ? '<span class="chip b-bad">Analysis failed</span>' : `<span class="chip ${CAT[r.category][1]}">${CAT[r.category][0]}</span>`);
const URLSTAT = { user_provided: ["Added by you", "b-user"], stated_in_source: ["In the source", "b-retrieved"], web_search: ["Found by web search", "b-web"], unverified: ["Unverified, check it", "b-warn"] };
function liCell(r) {
  if (r.linkedin_url) {
    const st = URLSTAT[r.url_status] || ["", ""];
    return `<a class="li" href="${esc(r.linkedin_url)}" target="_blank" rel="noopener" title="${esc(r.url_evidence || "")}">Open profile</a><br><span class="chip ${st[1]}">${st[0]}</span>`;
  }
  const label = r.url_status === "no_person" ? "No person yet" : "Missing";
  const can = r.opp_id && S.status.claude;
  return `<span class="chip ${r.url_status === "no_person" ? "b-warn" : "b-bad"}" title="${esc(r.url_evidence || "No verified LinkedIn profile URL")}">${label}</span>${can ? `<br><button class="btn xs" data-a="lookup" data-agent="${r.agent}" data-opp="${r.opp_id}" ${r.contact_id ? `data-contact="${r.contact_id}"` : ""}>${r.contact_id ? "Find profile" : "Find person"}</button>` : ""}`;
}
function pill(a, stage) {
  const st = a.stages, i = st.indexOf(stage), at = (k) => st.indexOf(a.auto[k]);
  const cls = stage === a.won_stage ? "p-win" : a.closed_stages.includes(stage) ? "p-lost" : a.intake_stages.includes(stage) ? "p-new" : i >= at("replied") ? "p-good" : i >= Math.min(at("sent"), at("sent_connection")) ? "p-out" : "p-work";
  return `<span class="pill ${cls}">${esc(stage)}</span>`;
}
const agentSeg = (cur, action, withAll) => `<div class="seg">${(withAll ? [["all", "Both agents", ""]] : []).concat(AG.map((k) => [k, C(k).name, k])).map(([k, l, c]) => `<button class="${cur === k ? "on" : ""}" data-a="${action}" data-v="${k}">${c ? `<span class="dot ${c}"></span>` : ""}${esc(l)}</button>`).join("")}</div>`;
const noKey = () => (S.status.claude ? "" : `<div class="banner"><b>Claude is not configured.</b> Signals are still collected, but nothing is scored, drafted or looked up until <code>ANTHROPIC_API_KEY</code> is set on the host. No results are simulated.</div>`);

/* ------------------------------------------------------------ shell */
function renderNav() {
  const st = S.status; if (!st) return;
  const item = (page, label, extra = "", on = S.page === page) => `<button class="${on ? "on" : ""}" data-a="page" data-v="${page}" ${extra}>${label}</button>`;
  const job = st.job || {};
  $("#nav").innerHTML = `<div class="brand"><i></i><span>LinkedIn Agents</span></div>
    ${item("dashboard", '<span class="dot"></span>Dashboard')}${item("leads", '<span class="dot"></span>All leads')}
    ${item("inbox", `<span class="dot"></span>Inbox${st.inbox ? `<span class="n">${st.inbox}</span>` : ""}`)}
    <div class="sep">Agents</div>
    ${AG.map((k) => item("agent", `<span class="dot ${k}"></span>${AGN[k]}`, `data-agent="${k}"`, S.page === "agent" && S.agent === k)).join("")}
    <div class="sep">Workspace</div>
    ${item("pipelines", '<span class="dot"></span>Pipelines')}${item("analytics", '<span class="dot"></span>Analytics')}${item("settings", '<span class="dot"></span>Settings')}
    <div class="foot"><span class="live ${st.running.length || job.running ? "run" : st.claude ? "on" : ""}"></span><b>${st.running.length ? "Monitoring now" : job.running ? `Finding profiles ${job.done}/${job.total}` : st.claude ? "Claude connected" : "Claude not configured"}</b><br>
      ${st.next_run && !st.running.length ? "Next run " + when(st.next_run) + "<br>" : ""}LinkedIn sending is manual
      ${st.login ? '<br><a href="#" data-a="logout">Sign out</a>' : ""}</div>`;
}
function showLogin(msg) {
  $("#drawer").hidden = true;
  $("#app").innerHTML = `<div class="login" style="grid-column:1/-1"><form class="card" id="login"><div class="brand" style="padding:0 0 14px"><i></i><span>LinkedIn Agents</span></div>
    <h1>Sign in</h1><p class="mute" style="margin-top:4px">Private workspace of Flávio Veloso.</p>
    <label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" autofocus>
    <button class="btn pri" style="margin-top:14px;width:100%;justify-content:center">Sign in</button><p id="lerr" style="color:var(--bad);margin:10px 0 0">${esc(msg || "")}</p></form></div>`;
}

/* ------------------------------------------------------------ dashboard */
function vDash(o) {
  const st = S.status, M = (k) => AG.reduce((t, a) => t + o[a].metrics[k], 0);
  const follow = AG.reduce((t, a) => t + o[a].actions.filter((x) => x.kind === "follow_up").length, 0);
  const todo = (num, label, act, v, ag) => `<div class="todo ${num ? "" : "zero"}" data-a="${act}" data-v="${v}" ${ag ? `data-agent="${ag}"` : ""}><b>${num}</b><span>${label}</span></div>`;
  const tile = (k) => { const a = C(k), m = o[k].metrics, max = Math.max(1, o[k].funnel[0][1]); return `<section class="card c4 ${k}"><div class="tile-top"><h2><span class="dot ${k}"></span>${esc(a.name)}</h2><button class="btn sm" data-a="page" data-v="agent" data-agent="${k}">Open</button></div>
      <div class="kpis"><div><div class="big">${m.discovered}</div><span>leads found</span></div><div class="hot"><div class="big">${m.qualified}</div><span>qualified 50+</span></div><div><div class="big">${m.with_linkedin}</div><span>with LinkedIn URL</span></div></div>
      <div class="funnel">${o[k].funnel.map(([l, v]) => `<span class="mute">${esc(l)}</span><div class="track"><i style="width:${(100 * v) / max}%"></i></div><b>${v}</b>`).join("")}</div></section>`; };
  const actions = AG.flatMap((k) => o[k].actions.map((x) => ({ ...x, agent: k }))).sort((x, y) => y.score - x.score).slice(0, 8);
  const feed = AG.flatMap((k) => o[k].activity.map((e) => ({ ...e, agent: k }))).sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 10);
  const evt = (e) => ({ stage: "moved to " + (e.data.to || ""), drafted: "message drafted", approved: "message approved", sent: "message sent", reply: "reply logged: " + (e.data.reply || ""), decision: "marked " + ({ pursue: "to pursue", dismissed: "dismissed", new: "for review" }[e.data.to] || ""), profile_lookup: `LinkedIn lookup, ${e.data.found || 0} found` }[e.type] || e.type);
  const top3 = o.career.top_roles || [];
  const last = st.last_runs[0];
  return `<div class="head"><div><h1>Dashboard</h1><small>Everything both agents found, what needs you, and how the pipeline is moving.</small></div><button class="btn pri" data-a="page" data-v="leads">See all ${M("discovered")} leads</button></div>${noKey()}
  <div class="bento">
    <section class="card c4"><div class="tile-top"><h2>Needs you</h2></div>
      ${todo(M("qualified"), "qualified leads (50+)", "leadcat", "qualified")}
      ${todo(M("to_review"), "drafts to review", "inboxtab", "review")}${todo(M("to_send"), "approved, ready to send", "inboxtab", "send")}${todo(follow, "follow-ups due", "inboxtab", "waiting")}
      ${todo(M("pending_analysis"), "signals waiting for analysis", "leadcat", "pending")}</section>
    ${tile("lit")}${tile("career")}
    ${top3.length ? `<section class="card c12 career"><div class="tile-top"><h2><span class="dot career"></span>Top roles for Flávio right now</h2><button class="btn sm" data-a="page" data-v="agent" data-agent="career">All roles</button></div>
      <div class="grid3">${top3.map((x) => { const r = x.role || {}; return `<div class="row" style="margin:0" data-a="open" data-agent="career" data-id="${x.id}">${scoreDot(x.score)}<div class="body"><div class="co">${esc(r.title || x.headline)}</div><div class="mute">${esc(x.company)}, ${esc(r.category || "")}</div>
        <div style="margin:4px 0">${esc(r.why_fit || "")}</div>${(r.highlights || []).map((h) => `<div class="mute">Highlight: ${esc(h)}</div>`).join("")}</div></div>`; }).join("")}</div></section>` : ""}
    <section class="card c8"><div class="tile-top"><h2>Who to contact next</h2></div>
      ${actions.length ? actions.map((x) => `<div class="row ${x.agent}" data-a="open" data-agent="${x.agent}" data-id="${x.opp}">${scoreDot(x.score)}<div class="body">
        <div class="sp"><div><span class="co">${esc(x.company)}</span> <span class="mute">${esc(x.who || "")}</span> ${safeUrl(x.linkedin_url) ? `<a href="${esc(x.linkedin_url)}" target="_blank" rel="noopener" class="li">LinkedIn</a>` : ""}</div><span class="chip acc">${esc(x.label)}</span></div><div class="mute">${esc(short(x.detail, 190))}</div></div></div>`).join("")
      : `<div class="empty">No qualified leads waiting. Open <a href="#" data-a="page" data-v="leads">All leads</a> to see everything the agents found, including unqualified and rejected ones.</div>`}</section>
    <section class="card c4"><div class="tile-top"><h2>Monitoring</h2><button class="btn sm" data-a="runall" ${st.running.length ? "disabled" : ""}>${st.running.length ? "Running…" : "Run now"}</button></div>
      <p><span class="live ${st.running.length ? "run" : st.settings.scheduler_enabled === "1" ? "on" : ""}"></span>${st.running.length ? "Fetching and analyzing" : st.settings.scheduler_enabled === "1" ? `Every ${esc(st.settings.interval_hours)} hours` : "Schedule is off"}</p>
      <dl class="meta" style="grid-template-columns:96px 1fr"><dt>Last run</dt><dd>${last ? `${when(last.started_at)}, ${last.new_signals} new, ${last.analyzed} analyzed` : "none yet"}</dd><dt>Next run</dt><dd>${st.next_run ? when(st.next_run) : "—"}</dd>
        <dt>Background</dt><dd>${st.cron ? "external scheduler configured" : "runs while the server is awake"}</dd></dl>
      ${last && last.errors ? `<div class="banner bad" style="margin:10px 0 0;font-size:12px">${esc(short(last.errors, 260))}</div>` : ""}</section>
    <section class="card c6"><div class="tile-top"><h2>Recent activity</h2></div>${feed.length ? feed.map((e) => `<div class="feed" data-a="open" data-agent="${e.agent}" data-id="${e.opportunity_id}"><span class="dot ${e.agent}"></span><span><b>${esc(e.company)}</b> ${esc(evt(e))}</span><time>${when(e.at)}</time></div>`).join("") : '<div class="empty">Nothing has happened yet.</div>'}</section>
    <section class="card c6" style="padding:0;overflow:hidden"><table><tr><th>Metric</th>${AG.map((k) => `<th class="num"><span class="dot ${k}"></span> ${AGN[k]}</th>`).join("")}</tr>
      ${[["discovered", "Leads found (all)"], ["rejected", "Rejected by AI"], ["qualified", "Qualified 50+"], ["people", "People identified"], ["with_linkedin", "With a LinkedIn URL"], ["drafted", "Messages drafted"], ["sent", "Messages sent"], ["replies", "Replies"], ["meetings", "Meetings / interviews"], ["won", "Clients won / offers"]]
        .map(([k, l]) => `<tr><td>${l}</td>${AG.map((a) => `<td class="num">${o[a].metrics[k]}</td>`).join("")}</tr>`).join("")}</table></section>
  </div>`;
}

/* ------------------------------------------------------------ leads table (all leads / one agent) */
function vLeadsTable(d, f, fixed) {
  const cats = [["all", "All"], ["review", "Needs review"], ["qualified", "Qualified"], ["unqualified", "Unqualified"], ["pipeline", "In pipeline"], ["rejected", "Rejected by AI"], ["dismissed", "Dismissed"], ["pending", "Pending analysis"]];
  const sel = S.sel, on = d.rows.filter((r) => sel.has(r.key)).length, from = d.total ? (d.page - 1) * d.size + 1 : 0, to = Math.min(d.total, d.page * d.size);
  return `<div class="filters">${fixed ? "" : agentSeg(f.agent, "lfagent", true)}
      <input id="lq" type="search" placeholder="Search name, company, role, reason" value="${esc(f.q)}" data-f="q" aria-label="Search leads">
      <select data-f="linkedin" aria-label="LinkedIn URL"><option value="">Any LinkedIn status</option><option value="has" ${f.linkedin === "has" ? "selected" : ""}>Has LinkedIn URL</option><option value="missing" ${f.linkedin === "missing" ? "selected" : ""}>LinkedIn URL missing</option></select>
      <select data-f="sort" aria-label="Sort"><option value="newest">Newest first</option><option value="score" ${f.sort === "score" ? "selected" : ""}>Highest score</option></select></div>
    <div class="cats">${cats.map(([k, l]) => `<button class="cat ${f.category === k ? "on" : ""}" data-a="cat" data-v="${k}">${l}<span>${d.counts[k] || 0}</span></button>`).join("")}</div>
    ${on ? `<div class="bulk"><b>${on} selected</b><button class="btn sm" data-a="bulk" data-v="pursue">Pursue</button><button class="btn sm" data-a="bulk" data-v="dismissed">Dismiss</button><button class="btn sm" data-a="bulk" data-v="new">Back to review</button>${S.status.claude ? '<button class="btn sm" data-a="bulk" data-v="find_profiles">Find LinkedIn profiles</button>' : ""}<button class="btn sm" data-a="clearsel">Clear</button></div>` : ""}
    <div class="tablewrap"><table class="leads"><thead><tr><th class="ck"><input type="checkbox" data-a="selall" aria-label="Select page" ${on && on === d.rows.length ? "checked" : ""}></th><th>Person</th><th>Company</th><th>LinkedIn</th><th>Location</th><th>Score</th><th>Status</th><th>Why the AI flagged it</th><th>${fixed ? "Found" : "Agent, found"}</th><th></th></tr></thead><tbody>
    ${d.rows.map((r) => `<tr class="click ${r.category === "dismissed" ? "dim" : ""}" data-a="openrow" data-key="${esc(r.key)}" data-agent="${r.agent}" data-opp="${r.opp_id || ""}" data-sig="${r.signal_id || ""}">
      <td class="ck"><input type="checkbox" data-a="sel" data-key="${esc(r.key)}" aria-label="Select" ${sel.has(r.key) ? "checked" : ""}></td>
      <td data-l="Person">${r.name ? `<b>${esc(r.name)}</b>${r.connected ? ' <span class="chip b-ok">connected</span>' : ""}` : '<span class="mute">No person identified</span>'}<br><small>${esc(r.position || "")}</small></td>
      <td data-l="Company"><b>${esc(r.company || "—")}</b><br><small>${esc(short(r.headline, 70))}</small>${r.conflict ? '<br><span class="chip b-bad">identity conflict</span>' : ""}</td>
      <td data-l="LinkedIn">${liCell(r)}</td>
      <td data-l="Location"><small>${esc(r.location || "—")}</small></td>
      <td data-l="Score">${scoreDot(r.score)}</td>
      <td data-l="Status">${catChip(r)}${r.category === "pipeline" && r.stage ? `<br><small>${esc(r.stage)}</small>` : r.score != null ? `<br><small>${esc(r.classification)}</small>` : ""}</td>
      <td data-l="Why" class="why" title="${esc((r.why_person ? r.why_person + "\n\n" : "") + (r.why_lead || ""))}"><small>${esc(short(r.ai_verdict === "not_relevant" || r.kind === "signal" ? r.why_lead : r.why_person || r.why_lead, 150))}</small></td>
      <td data-l="${fixed ? "Found" : "Agent"}" class="ag">${fixed ? "" : `<span class="dot ${r.agent}"></span> <small>${AGN[r.agent]}</small><br>`}<small class="mute">${day(r.discovered_at)}</small></td>
      <td class="acts">${rowActions(r)}</td></tr>`).join("") || `<tr><td colspan="10"><div class="empty">${d.counts.all ? "Nothing matches these filters." : "No leads yet. Capture a signal on an agent page or run monitoring."}</div></td></tr>`}
    </tbody></table></div>
    <div class="pager"><span class="mute">${from}–${to} of ${d.total}</span><button class="btn sm" data-a="pg" data-v="-1" ${d.page <= 1 ? "disabled" : ""}>Previous</button><button class="btn sm" data-a="pg" data-v="1" ${d.page >= d.pages ? "disabled" : ""}>Next</button>
      <select data-f="size" aria-label="Rows per page">${[50, 100, 200].map((n) => `<option ${+f.size === n ? "selected" : ""}>${n}</option>`).join("")}</select></div>`;
}
function rowActions(r) {
  const b = (act, label) => `<button class="btn xs" data-a="decide" data-v="${act}" data-agent="${r.agent}" data-opp="${r.opp_id}">${label}</button>`;
  if (r.kind === "signal") {
    if (r.category === "dismissed" || r.category === "rejected") return `<button class="btn xs" data-a="sigact" data-v="restore" data-agent="${r.agent}" data-sig="${r.signal_id}">${r.category === "rejected" ? "Re-queue" : "Restore"}</button>`;
    return `${S.status.claude ? `<button class="btn xs" data-a="sigact" data-v="analyze" data-agent="${r.agent}" data-sig="${r.signal_id}">Analyze</button>` : ""}<button class="btn xs" data-a="sigact" data-v="dismiss" data-agent="${r.agent}" data-sig="${r.signal_id}">Dismiss</button>`;
  }
  if (r.category === "dismissed") return b("new", "Restore");
  if (r.category === "pipeline") return "";
  return b("pursue", "Pursue") + b("dismissed", "Dismiss");
}
const vLeadsPage = (d) => `<div class="head"><div><h1>All leads</h1><small>Every lead both agents found, whatever its score or status. Nothing is hidden; dismissed and rejected leads stay in the history.</small></div></div>${noKey()}${vLeadsTable(d, S.lf, false)}`;

/* ------------------------------------------------------------ agent page */
function vAgent(d) {
  const a = C(S.agent);
  return `<div class="head"><div><h1>${esc(a.name)}</h1><small>${esc(a.tagline)}</small></div>
      <div class="btns"><div class="seg"><button class="${S.agentTab === "leads" ? "on" : ""}" data-a="atab" data-v="leads">Leads</button><button class="${S.agentTab === "capture" ? "on" : ""}" data-a="atab" data-v="capture">Capture a signal</button></div>
      <button class="btn" data-a="run" data-agent="${a.key}" ${S.status.running.includes(a.key) ? "disabled" : ""}>${S.status.running.includes(a.key) ? "Running…" : "Run monitoring"}</button></div></div>
    ${noKey()}${S.agentTab === "leads" ? vLeadsTable(d, S.af, true) : vCapture(a, d)}`;
}
function vCapture(a, sigs) {
  return `<div class="grid2"><div class="card"><h2>Capture from LinkedIn</h2>
      <p class="mute">Paste a post, profile section or job description you saw. LinkedIn does not let tools read it for you, so this is the authorized route. Include the person's profile link if you have it.</p>
      <div class="form"><div><label for="c-kind">Type</label><select id="c-kind">${a.capture_kinds.map((k) => `<option value="${k}">${esc(nice(k))}</option>`).join("")}</select></div>
        <div><label for="c-url">Link (optional)</label><input id="c-url" placeholder="https://www.linkedin.com/posts/…"></div>
        <div><label for="c-author">Person (optional)</label><input id="c-author"></div><div><label for="c-atitle">Their title (optional)</label><input id="c-atitle"></div>
        <div class="full"><label for="c-company">Company (optional)</label><input id="c-company"></div>
        <div class="full"><label for="c-body">Text</label><textarea id="c-body" rows="8" placeholder="Paste the text here"></textarea></div></div>
      <div class="btns" style="margin-top:10px"><button class="btn pri" data-a="capture" data-analyze="1" ${S.status.claude ? "" : "disabled"}>Capture and analyze</button><button class="btn" data-a="capture">Capture only</button></div></div>
    <div class="card"><div class="sp"><h2>Waiting for analysis (${sigs.length})</h2>${sigs.length ? '<button class="btn sm" data-a="dismissall">Dismiss all</button>' : ""}</div>
      ${sigs.map((s) => `<div class="fact"><div class="sp"><b>${esc(s.title || nice(s.kind))}</b><small>${esc(s.source_name)}, ${day(s.created_at)}</small></div>
        <div class="mute">${esc(short(s.body, 220))}</div>${s.error ? `<div style="color:var(--bad)">${esc(s.error)}</div>` : ""}
        <div class="btns" style="margin-top:6px"><button class="btn sm pri" data-a="sigact" data-v="analyze" data-agent="${a.key}" data-sig="${s.id}" ${S.status.claude ? "" : "disabled"}>Analyze</button><button class="btn sm" data-a="sigact" data-v="dismiss" data-agent="${a.key}" data-sig="${s.id}">Dismiss</button></div></div>`).join("") || '<div class="empty">Nothing waiting.</div>'}</div></div>`;
}

/* ------------------------------------------------------------ inbox */
function msgCard(m, ctx) {
  const k = m.agent || ctx.agentKey, a = C(k), mt = a.message_types.find((t) => t.key === m.type) || { label: m.type, max_chars: 600 };
  const who = ctx ? ctx.contacts.find((c) => c.id === m.contact_id) || {} : { name: m.contact_name, title: m.contact_title, linkedin_url: m.linkedin_url };
  const co = ctx ? ctx.company : m.company, st = m.status, locked = st === "sent" || st === "rejected";
  const prof = safeUrl(who.linkedin_url);
  const conflict = ctx ? ctx.conflict : m.conflict, blocked = conflict && !(ctx ? ctx.conflict_ack : m.conflict_ack);
  const B = (act, label, cls = "", extra = "") => `<button class="btn ${cls}" data-a="mact" data-agent="${k}" data-id="${m.id}" data-act="${act}" ${extra}>${label}</button>`;
  return `<div class="msg ${k}"><div class="msg-h"><div><span class="dot ${k}"></span> <b>${esc(who.name || "?")}</b> <span class="mute">${esc(who.title || "")}, ${esc(co)}</span></div>
      <div><span class="chip acc">${esc(mt.label)}</span><span class="chip ${st === "sent" ? "b-ok" : st === "rejected" ? "b-bad" : st === "approved" ? "b-info" : ""}">${esc(st)}${st === "sent" ? " " + day(m.sent_at) : ""}</span>${m.reply !== "none" ? `<span class="chip ${m.reply === "positive" ? "b-ok" : m.reply === "negative" ? "b-bad" : ""}">reply: ${esc(m.reply)}</span>` : ""}</div></div>
    <div class="msg-b"><dl class="meta"><dt>Opportunity type</dt><dd>${k === "lit" ? "Commercial lead, sent as Lit Collective" : "Career opportunity, sent as Flávio"}${ctx ? "" : ` <a href="#" data-a="open" data-agent="${k}" data-id="${m.opportunity_id}">(open lead, score ${m.score})</a>`}</dd>
      <dt>LinkedIn profile</dt><dd>${prof ? `<a class="li" href="${esc(prof)}" target="_blank" rel="noopener">${esc(prof.replace("https://www.", ""))}</a>` : '<span class="chip b-bad">Missing</span> open the lead to find or add it'}</dd>
      <dt>Detected signal</dt><dd>${esc(m.signal_ref)}</dd><dt>Why it makes sense</dt><dd>${esc(m.rationale)}</dd></dl>
    ${(m.lint || []).map((x) => `<div class="banner bad" style="margin:8px 0 0">${esc(x)}</div>`).join("")}${blocked ? `<div class="banner bad" style="margin:8px 0 0">${esc(conflict)}</div>` : ""}
    <label for="mt-${k}-${m.id}">Suggested message${m.edited ? " (edited by you)" : ""}</label>
    <textarea id="mt-${k}-${m.id}" data-max="${mt.max_chars}" data-count="1" ${locked ? "readonly" : ""}>${esc(m.final_text)}</textarea>
    <div class="count ${m.final_text.length > mt.max_chars ? "over" : ""}">${m.final_text.length} / ${mt.max_chars}</div>
    ${locked ? "" : `<label>Alternative</label><div class="alt">${esc(m.alternative)}</div>`}
    <label>Recommended follow-up if there is no reply in about a week</label><div class="alt">${esc(m.follow_up)}</div>
    <div class="btns" style="margin-top:10px">
      ${st === "drafted" || st === "saved" ? B("approve", "Approve", "pri", blocked ? "disabled" : "") + B("edit", "Save edit") + `<button class="btn" data-a="usealt" data-agent="${k}" data-id="${m.id}">Use alternative</button>` + (st === "drafted" ? B("save", "Save for later") : "") + B("reject", "Reject", "danger") : ""}
      ${st === "approved" ? `<button class="btn pri" data-a="copy" data-agent="${k}" data-id="${m.id}">Copy message</button><a class="btn" href="${esc(prof || "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent((who.name || "") + " " + co))}" target="_blank" rel="noopener">${prof ? "Open profile on LinkedIn" : "Search LinkedIn"}</a>` + B("sent", "I sent it") + B("reopen", "Back to draft") : ""}
      ${st === "sent" ? `<span class="mute">Log the reply</span>${["positive", "neutral", "negative"].map((r) => B("reply", r, "sm " + (m.reply === r ? "pri" : ""), `data-reply="${r}"`)).join("")}<button class="btn sm" data-a="copyfu" data-agent="${k}" data-id="${m.id}">Copy follow-up</button>` : ""}
      ${st === "rejected" ? B("reopen", "Reopen") : ""}${st === "drafted" || st === "saved" ? `<button class="btn" data-a="copy" data-agent="${k}" data-id="${m.id}">Copy</button>` : ""}
    </div></div></div>`;
}
const INBOX = { review: ["To review", (m) => m.status === "drafted"], send: ["Ready to send", (m) => m.status === "approved"], waiting: ["Awaiting reply", (m) => m.status === "sent" && m.reply === "none"], replied: ["Replied", (m) => m.reply !== "none"], saved: ["Saved for later", (m) => m.status === "saved"], rejected: ["Rejected", (m) => m.status === "rejected"] };
function vInbox(msgs, fresh) {
  const ms = msgs.filter((x) => S.inboxAgent === "all" || x.agent === S.inboxAgent);
  const list = S.inboxTab === "new" ? [] : ms.filter(INBOX[S.inboxTab][1]);
  return `<div class="head"><div><h1>Inbox</h1><small>AI-drafted messages from both agents. Nothing is sent from here: approve, copy, send on LinkedIn, then mark it as sent.</small></div>${agentSeg(S.inboxAgent, "inboxagent", true)}</div>
    <div class="filters"><div class="seg"><button class="${S.inboxTab === "new" ? "on" : ""}" data-a="inboxtab" data-v="new">Qualified, no outreach yet</button>${Object.entries(INBOX).map(([k, [l, f]]) => `<button class="${S.inboxTab === k ? "on" : ""}" data-a="inboxtab" data-v="${k}">${l} ${ms.filter(f).length}</button>`).join("")}</div></div>
    ${S.inboxTab === "new" ? `<div class="card">${fresh.rows.filter((r) => S.inboxAgent === "all" || r.agent === S.inboxAgent).map((r) => `<div class="row ${r.agent}" data-a="open" data-agent="${r.agent}" data-id="${r.opp_id}">${scoreDot(r.score)}<div class="body"><div class="sp"><div><span class="co">${esc(r.company)}</span> <span class="mute">${esc(r.name || "No person identified")}${r.position ? ", " + esc(r.position) : ""}</span></div>${r.linkedin_url ? `<a class="li" href="${esc(r.linkedin_url)}" target="_blank" rel="noopener">LinkedIn</a>` : '<span class="chip b-bad">LinkedIn missing</span>'}</div>
        <div class="mute">${esc(short(r.why_lead, 200))}</div></div></div>`).join("") || '<div class="empty">No qualified leads waiting for outreach.</div>'}</div>`
      : list.map((m) => msgCard(m)).join("") || '<div class="card empty">Nothing in this queue.</div>'}`;
}

/* ------------------------------------------------------------ pipelines */
function vPipes(b) {
  const a = C(S.agent);
  return `<div class="head"><div><h1>Pipelines</h1><small>Leads you pursue, or that the AI qualified, by stage. Drag a card to move it. Rejected and dismissed leads are in All leads.</small></div>${agentSeg(S.agent, "setagent")}</div>
  <div class="board ${a.key}">${a.stages.map((st, i) => {
    let cards = b.cards.filter((o) => o.stage === st).map((o) => `<div class="kc" draggable="true" data-drag="${o.id}" data-a="open" data-agent="${a.key}" data-id="${o.id}"><span class="s">${o.score}</span><b>${esc(o.company)}</b>${esc(short(o.headline, 70))}${o.contact ? `<div class="mute">${esc(o.contact)}</div>` : ""}</div>`);
    if (i < a.intake_stages.length) cards = b.pending.filter((s) => (i === 0 ? s.status === "new" : s.status !== "new")).map((s) => `<div class="kc sig" data-a="opensig" data-agent="${a.key}" data-id="${s.id}"><b>${esc(short(s.title || "Signal", 60))}</b><span class="mute">${esc(s.source_name)}${s.status === "error" ? ", analysis failed" : ""}</span></div>`).concat(cards);
    return `<div class="col" data-stage="${esc(st)}" data-intake="${i === 0 ? 1 : ""}"><h4><span>${esc(st)}</span><span>${cards.length || ""}</span></h4>${cards.join("")}</div>`;
  }).join("")}</div>`;
}

/* ------------------------------------------------------------ analytics */
function vAnalytics(an, ov) {
  const a = C(S.agent), lit = a.key === "lit", m = ov[a.key].metrics, mw = a.meeting_stage.split(" ")[0];
  const pct = (x, y) => (y ? Math.round((100 * x) / y) + "%" : "—");
  const K = (v, l) => `<div class="card c3"><div class="big">${v}</div><div class="mute" style="margin-top:6px">${l}</div></div>`;
  const oppT = (title, rows, first) => `<section class="card c6" style="padding:0;overflow:hidden"><h2 style="padding:14px 16px 0">${title}</h2>${rows.length ? `<div style="overflow-x:auto"><table><tr><th>${first}</th><th class="num">Found</th><th class="num">Qualified</th><th class="num">Contacted</th><th class="num">Replied</th><th class="num">${esc(mw)}s</th><th class="num">${esc(a.won_stage)}</th></tr>
    ${rows.map((r) => `<tr><td>${esc(nice(r.group))}</td><td class="num">${r.opportunities}</td><td class="num">${r.qualified}</td><td class="num">${r.contacted}</td><td class="num">${r.replied}</td><td class="num">${r.meetings}</td><td class="num">${r.won}</td></tr>`).join("")}</table></div>` : '<div class="empty">No data yet.</div>'}</section>`;
  const msgT = (title, rows, first) => `<section class="card c6" style="padding:0;overflow:hidden"><h2 style="padding:14px 16px 0">${title}</h2>${rows.length ? `<div style="overflow-x:auto"><table><tr><th>${first}</th><th class="num">Sent</th><th class="num">Replied</th><th class="num">Reply rate</th><th class="num">Positive</th><th class="num">Led to ${esc(mw.toLowerCase())}</th></tr>
    ${rows.map((r) => `<tr><td>${esc(nice(r.group))}</td><td class="num">${r.sent}</td><td class="num">${r.replied}</td><td class="num">${pct(r.replied, r.sent)}</td><td class="num">${r.positive}</td><td class="num">${r.meetings}</td></tr>`).join("")}</table></div>` : '<div class="empty">No sent messages logged yet.</div>'}</section>`;
  return `<div class="head"><div><h1>Analytics</h1><small>Counts from what you logged for this agent only. Groups with 3 or more contacted, your edits and messages that got positive replies are passed to Claude for future scoring and drafting.</small></div>${agentSeg(S.agent, "setagent")}</div>
  <div class="bento ${a.key}">${K(m.discovered, "leads found")}${K(pct(m.qualified, m.discovered - m.pending_analysis), `qualified (${m.qualified})`)}${K(pct(m.replies, m.sent), `reply rate (${m.replies} of ${m.sent})`)}${K(m.meetings, lit ? "meetings booked" : "interviews")}
    ${oppT(lit ? "Which buying signals generate responses?" : "Which hiring signals lead to conversations?", an.by_signal, "Signal")}
    ${oppT(lit ? "Which industries generate qualified leads?" : "Which industries offer the best opportunities?", an.by_industry, "Industry")}
    ${lit ? oppT("Which services attract interest?", an.by_service, "Service") : oppT("Which roles generate responses?", an.by_role, "Role family")}
    ${oppT(lit ? "Which company stages convert?" : "Which company stages are most compatible?", an.by_stage, "Company stage")}
    ${msgT(lit ? "Which outreach messages generate meetings?" : "Which outreach approaches generate interviews?", an.by_message_type, "Message type")}
    ${msgT(lit ? "Which angles work?" : "Which professional positioning works best?", an.by_angle, "Angle")}
    ${lit ? `<section class="card c12"><h2>Companies that became clients</h2>${an.clients.length ? an.clients.map((c) => `<span class="chip acc">${esc(c.company)}, ${esc(c.industry)}</span>`).join("") : '<span class="mute">None marked Won yet.</span>'}</section>` : ""}</div>`;
}

/* ------------------------------------------------------------ lead drawer */
function contactBlock(c, o, a, prov) {
  const st = URLSTAT[c.url_status], ed = S.editContact === c.id;
  return `<div class="fact"><div class="sp"><div><b>${esc(c.name || "Person to identify")}</b>${c.title ? ", " + esc(c.title) : ""} ${badge(c.basis, prov)}${c.connected ? '<span class="chip b-ok">already connected</span>' : ""}</div>
      <div class="btns">${c.name && S.status.claude ? `<button class="btn sm" data-a="lookup" data-agent="${a.key}" data-opp="${o.id}" data-contact="${c.id}">Find LinkedIn profile</button>` : ""}<button class="btn sm" data-a="editc" data-id="${c.id}">${ed ? "Cancel" : "Edit"}</button><button class="btn sm" data-a="delcontact" data-id="${c.id}">Remove</button></div></div>
    <div class="li-line">${c.linkedin_url ? `<a class="li" href="${esc(c.linkedin_url)}" target="_blank" rel="noopener">${esc(c.linkedin_url.replace("https://www.", ""))}</a> <span class="chip ${st ? st[1] : ""}">${st ? st[0] : ""}</span>` : `<span class="chip b-bad">LinkedIn URL missing</span> <a class="mute" href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent((c.name || c.title) + " " + o.company)}" target="_blank" rel="noopener">search LinkedIn yourself</a>`}
      ${c.location ? ` <span class="mute">· ${esc(c.location)}</span>` : ""}</div>
    ${c.url_evidence ? `<div class="mute small">${esc(c.url_evidence)}</div>` : ""}<div class="mute">${esc(c.why)}</div>
    ${ed ? `<div class="form" style="margin-top:8px"><input id="e-name" value="${esc(c.name)}" placeholder="Name" aria-label="Name"><input id="e-title" value="${esc(c.title)}" placeholder="Position" aria-label="Position">
      <input id="e-url" value="${esc(c.linkedin_url)}" placeholder="https://www.linkedin.com/in/…" aria-label="LinkedIn URL"><input id="e-loc" value="${esc(c.location || "")}" placeholder="Location" aria-label="Location"></div>
      <button class="btn sm pri" style="margin-top:8px" data-a="savec" data-id="${c.id}">Save</button>` : ""}</div>`;
}
function vDrawer(o, a) {
  const prov = o.signal ? o.signal.provenance : "user_provided", named = o.contacts.filter((c) => c.name), r = o.role || {};
  o.agentKey = a.key;
  const rej = o.ai_verdict === "not_relevant", dec = o.decision || "new";
  const D = (v, l, cls = "") => `<button class="btn sm ${dec === v ? "pri" : cls}" data-a="decide" data-v="${v}" data-agent="${a.key}" data-opp="${o.id}" ${dec === v ? "disabled" : ""}>${l}</button>`;
  return `<div class="sp"><div class="btns" style="flex-wrap:nowrap">${scoreDot(o.score)}<div><h1>${esc(o.company)}</h1><small><span class="dot ${a.key}"></span> ${AGN[a.key]} · ${esc(o.classification)} · ${esc(o.industry)}, ${esc(o.company_stage)}${safeUrl(o.company_url) ? ` · <a href="${esc(o.company_url)}" target="_blank" rel="noopener">website</a>` : ""}</small></div></div><button class="btn" data-a="close">Close</button></div>
    ${rej ? `<div class="banner bad" style="margin-top:12px"><b>Rejected by AI.</b> ${esc(o.rejection_reason || "")} You can still pursue it.</div>` : ""}
    ${o.conflict ? `<div class="banner bad" style="margin-top:12px">${esc(o.conflict)} ${o.conflict_ack ? "<b>You confirmed outreach from this agent.</b>" : `<button class="btn sm" data-a="ack">Approach as ${a.key === "lit" ? "Lit Collective" : "a career contact"}</button>`}</div>` : ""}
    <div class="card" style="margin-top:14px"><div class="sp"><b>Your decision</b><div class="btns">${D("pursue", "Pursue")}${D("dismissed", "Dismiss", "danger")}${dec !== "new" ? D("new", "Back to review") : ""}</div></div>
      <p style="margin-top:10px"><b>${esc(o.headline)}</b></p><p>${esc(o.summary)}</p><p><b>Next step.</b> ${esc(o.next_step || "—")}</p>
      <div class="form"><div><label>Pipeline stage</label><select data-change="stage">${a.stages.slice(1).map((s) => `<option ${s === o.stage ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
        <div><label>${a.key === "lit" ? "Meeting" : "Interview"} date</label><div class="btns" style="flex-wrap:nowrap"><input type="datetime-local" data-change="meeting" value="${esc(o.meeting_at || "")}">${o.meeting_at ? `<a class="btn sm" href="/api/${a.key}/opportunities/${o.id}/ics" download="${a.key}-${o.id}.ics">Add to calendar</a>` : ""}</div></div></div>
      <div class="btns" style="margin-top:10px"><button class="btn sm" data-a="research" ${S.status.claude ? "" : "disabled"} title="Re-scores with Anthropic's web search; billed per search">Re-analyze with web research</button>${o.researched ? '<span class="chip b-web">web-researched</span>' : ""}</div></div>
    <h3>Who to contact</h3><div class="card">
      ${o.contacts.map((c) => contactBlock(c, o, a, prov)).join("") || '<span class="mute">No person identified yet.</span>'}
      ${!named.length && S.status.claude ? `<button class="btn sm pri" style="margin-top:10px" data-a="lookup" data-agent="${a.key}" data-opp="${o.id}">Find the decision-maker with web search</button>` : ""}
      <label style="margin-top:12px">Add a person yourself</label>
      <div class="form"><input id="n-name" placeholder="Name" aria-label="Name"><input id="n-title" placeholder="Position" aria-label="Position"><input id="n-url" placeholder="LinkedIn profile URL" aria-label="LinkedIn URL"><input id="n-loc" placeholder="Location" aria-label="Location"></div>
      <button class="btn sm" style="margin-top:8px" data-a="addcontact">Add person</button></div>
    ${a.key === "career" && r.title ? `<h3>Role</h3><div class="card"><div class="sp"><b>${esc(r.title)}</b>${o.signal && safeUrl(o.signal.url) ? `<a class="btn sm" href="${esc(o.signal.url)}" target="_blank" rel="noopener">Open posting</a>` : ""}</div>
      <div style="margin:6px 0"><span class="chip acc">${esc(r.category || "Other")}</span><span class="chip ${r.has_public_opening ? "" : "b-hyp"}">${r.has_public_opening ? "Public opening" : "No public vacancy (inferred need)"}</span><span class="chip ${r.remote === "Remote worldwide" ? "b-ok" : ""}">${esc(r.remote || "Unknown")}</span></div>
      <dl class="meta"><dt>Accepts Brazil?</dt><dd>${esc(r.brazil_evidence || "not stated")}</dd><dt>Level</dt><dd>${esc(r.level || "not stated")}</dd><dt>Salary</dt><dd>${esc(r.salary || "not stated")}</dd><dt>Published</dt><dd>${esc(r.published || "not stated")}</dd><dt>Why it fits</dt><dd>${esc(r.why_fit || "not stated")}</dd></dl>
      ${(r.highlights || []).length ? `<label>Highlight in your application</label>${r.highlights.map((h) => `<div class="fact">${esc(h)}</div>`).join("")}` : ""}</div>` : ""}
    ${a.key === "lit" && (o.services || []).length ? `<h3>Potential services</h3><div>${o.services.map((x) => `<span class="chip acc">${esc(x)}</span>`).join("")}</div>` : ""}
    <h3>Why this score: ${o.score} of 100</h3><div class="card">${(o.breakdown || []).map((b) => `<div class="bar-row"><span>${esc(b.label)}</span><div class="track"><i style="width:${b.max ? (100 * b.points) / b.max : 0}%"></i></div><b>${b.points}/${b.max}</b><div class="reason">${esc(b.reason)}</div></div>`).join("") || '<span class="mute">No breakdown recorded.</span>'}</div>
    <h3>${a.key === "lit" ? "Buying" : "Hiring"} signals</h3><div class="card">${(o.detected || []).map((x) => `<div class="fact"><span class="chip acc">${esc(nice(x.type))}</span>${badge(x.basis, prov)}<div>${esc(x.evidence)}</div></div>`).join("") || '<span class="mute">None recorded.</span>'}</div>
    <h3>What this is based on</h3><div class="card">${(o.facts || []).map((x) => `<div class="fact">${badge(x.basis, prov)} ${esc(x.statement)}</div>`).join("") || '<span class="mute">None recorded.</span>'}</div>
    <h3>Outreach</h3><div class="card"><div class="form"><div><label for="d-contact">To</label><select id="d-contact">${named.map((c) => `<option value="${c.id}">${esc(c.name)}, ${esc(c.title)}</option>`).join("") || "<option value=''>Add a named person first</option>"}</select></div>
        <div><label for="d-type">Message</label><select id="d-type">${a.message_types.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join("")}</select></div></div>
      <button class="btn pri" style="margin-top:10px" data-a="draft" ${S.status.claude && named.length ? "" : "disabled"}>Draft with Claude</button></div>
    <div style="margin-top:12px">${o.messages.map((m) => msgCard(m, o)).join("")}</div>
    <h3>Notes</h3><textarea data-change="notes" placeholder="Your notes" aria-label="Notes">${esc(o.notes || "")}</textarea>
    <h3>Source signal</h3><div class="mute" style="margin-bottom:6px">${esc(o.signal ? o.signal.source_name : "")} ${badge(prov === "retrieved" ? "stated_in_source" : "user_provided", prov)} found ${day(o.created_at)} ${o.signal && safeUrl(o.signal.url) ? `<a href="${esc(o.signal.url)}" target="_blank" rel="noopener">open original</a>` : ""}</div>
    <div class="pre">${esc(o.signal ? o.signal.body : "")}</div>
    <h3>History</h3><div class="mute">${o.events.map((e) => `${when(e.at)}: ${esc(e.type.replace("_", " "))}${e.data && e.data.to ? " → " + esc(e.data.to) : ""}${e.data && e.data.reply ? " " + esc(e.data.reply) : ""}${e.type === "profile_lookup" ? ` (${e.data.found || 0} found)` : ""}`).join("<br>")}</div>`;
}
function vSigDrawer(s, k) {
  const cat = { irrelevant: "Rejected by AI", dismissed: "Dismissed", error: "Analysis failed", new: "Pending analysis", analyzing: "Being analyzed" }[s.status] || s.status;
  return `<div class="sp"><div><h1>${esc(s.title || "Signal")}</h1><small><span class="dot ${k}"></span> ${AGN[k]} · ${esc(s.source_name)} · found ${day(s.created_at)}</small></div><button class="btn" data-a="close">Close</button></div>
    <div class="card" style="margin-top:14px"><p><span class="chip">${esc(cat)}</span> ${badge(s.provenance === "retrieved" ? "stated_in_source" : "user_provided", s.provenance)}</p>
      ${s.error ? `<p>${esc(s.error)}</p>` : ""}<p class="mute">Not scored yet${s.attempts ? `, ${s.attempts} analysis attempt(s)` : ""}.${s.status === "irrelevant" ? " This was rejected before rejected leads were kept with their scores; analyze it again to see the full assessment." : ""}</p>
      <div class="btns">${S.status.claude && s.status !== "analyzing" ? `<button class="btn pri" data-a="sigact" data-v="analyze" data-agent="${k}" data-sig="${s.id}">${s.status === "new" ? "Analyze now" : "Analyze again"}</button>` : ""}
        ${["dismissed", "irrelevant"].includes(s.status) ? `<button class="btn" data-a="sigact" data-v="restore" data-agent="${k}" data-sig="${s.id}">Back to the queue</button>` : `<button class="btn" data-a="sigact" data-v="dismiss" data-agent="${k}" data-sig="${s.id}">Dismiss</button>`}
        ${safeUrl(s.url) ? `<a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">Open source</a>` : ""}</div></div>
    ${s.author ? `<h3>Person mentioned</h3><div class="card"><b>${esc(s.author)}</b> ${esc(s.author_title || "")}<div class="mute">The LinkedIn profile is looked up after analysis.</div></div>` : ""}
    <h3>Source text</h3><div class="pre" style="max-height:none">${esc(s.body || "")}</div>`;
}
function renderDrawer() {
  const dr = $("#drawer");
  if (!S.drawer) { dr.hidden = true; return; }
  const keep = dr.querySelector(".panel")?.scrollTop || 0;
  const k = S.drawer.agent;
  const html = S.drawer.kind === "signal" ? (S.sig ? vSigDrawer(S.sig, k) : "") : S.opp ? vDrawer(S.opp, C(k)) : "";
  dr.hidden = false; dr.className = k;
  dr.innerHTML = `<div class="panel" data-agent="${k}">${html || '<div class="loading">Loading…</div>'}</div>`;
  dr.querySelector(".panel").scrollTop = keep;
}

/* ------------------------------------------------------------ settings */
function vSettings(litSrc, carSrc, diag) {
  const st = S.status, s = st.settings, T = S.cfg.source_types, srcs = { lit: litSrc, career: carSrc };
  const stat = { available: ["Available", "b-ok"], manual: ["Manual import", "b-user"], unavailable: ["Not available", "b-bad"], not_needed: ["Not used", ""] };
  const yes = (v, y, n) => `<span class="chip ${v ? "b-ok" : "b-bad"}">${v ? y : n}</span>`;
  const sel = (id, opts) => `<select id="set-${id}">${opts.map(([v, l]) => `<option value="${v}" ${s[id] === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const scoring = (k) => { const a = C(k); return `<section class="card c6 ${k}"><div class="tile-top"><h2><span class="dot ${k}"></span>${esc(a.name)}: scoring</h2><button class="btn sm" data-a="resetw" data-agent="${k}">Reset weights</button></div>
    <p class="mute">Points per criterion. They must add up to 100. Applies to signals analyzed from now on.</p>
    <div class="weights">${a.criteria.map((c) => `<label for="w-${k}-${c.key}" style="margin:0;color:var(--ink)">${esc(c.label)}</label><input id="w-${k}-${c.key}" type="number" min="0" max="100" value="${c.max}" data-w="${k}">`).join("")}<b>Total</b><b id="wt-${k}" style="text-align:right;padding-right:10px">${a.criteria.reduce((t, c) => t + c.max, 0)}</b></div>
    <p class="mute" style="margin-top:10px">Bands: ${a.bands.map(([n, l]) => `${esc(l)} ${n}+`).join(", ")}.</p>
    <label for="g-${k}">Standing preferences for this agent</label><textarea id="g-${k}" rows="3">${esc(a.guidance || "")}</textarea>
    <button class="btn pri" style="margin-top:10px" data-a="savescoring" data-agent="${k}">Save scoring</button></section>`; };
  const src = (k) => `<section class="card c12 ${k}"><div class="tile-top"><h2><span class="dot ${k}"></span>${esc(C(k).name)}: data sources</h2></div>
    <div style="overflow-x:auto"><table style="min-width:720px"><tr><th>Source</th><th>Keywords</th><th>Last run</th><th></th></tr>${srcs[k].map((x) => `<tr><td><b>${esc(x.name)}</b><br><small>${esc(T[x.type].label)} ${esc(x.config.url || x.config.board || "")}</small></td>
      <td><small>${esc((x.config.keywords || []).join(", ") || "all items")}</small></td><td><small>${x.last_run_at ? when(x.last_run_at) + "<br>" + esc(x.last_status) : "never"}</small></td>
      <td><div class="btns" style="flex-wrap:nowrap"><button class="btn sm" data-a="srctoggle" data-agent="${k}" data-id="${x.id}" data-v="${x.enabled ? 0 : 1}">${x.enabled ? "On" : "Off"}</button><button class="btn sm" data-a="srctest" data-agent="${k}" data-id="${x.id}">Fetch</button><button class="btn sm danger" data-a="srcdel" data-agent="${k}" data-id="${x.id}">Delete</button></div></td></tr>`).join("")}</table></div>
    <h3>Add a source</h3><div class="form"><div><label for="s-type-${k}">Type</label><select id="s-type-${k}">${Object.entries(T).map(([t, v]) => `<option value="${t}">${esc(v.label)}</option>`).join("")}</select></div><div><label for="s-name-${k}">Name</label><input id="s-name-${k}" placeholder="e.g. Acme careers"></div>
      <div><label for="s-val-${k}">Feed URL or board slug</label><input id="s-val-${k}" placeholder="https://…/feed  or  acme"></div><div><label for="s-kw-${k}">Keywords, comma-separated (blank for everything)</label><input id="s-kw-${k}"></div></div>
    <button class="btn sm" style="margin-top:10px" data-a="srcadd" data-agent="${k}">Add source</button></section>`;
  return `<div class="head"><div><h1>Settings</h1><small>Claude, monitoring, LinkedIn lookups, scoring, data sources and performance.</small></div></div>
  <div class="bento">
    <section class="card c6"><h2>Claude API</h2><p>${yes(st.claude, "API key set", "No API key")} <span class="mute">The key lives only in the host's environment variable <code>ANTHROPIC_API_KEY</code>.</span></p>
      <div class="form"><div><label for="set-model">Model</label><input id="set-model" value="${esc(s.model)}"></div>
        <div><label for="set-web_research">Web research during analysis</label>${sel("web_research", [["0", "Off, source text only"], ["1", "On, up to 3 searches per signal (billed)"]])}</div>
        <div><label for="set-analyze_per_run">Signals analyzed per run, per agent</label><input id="set-analyze_per_run" type="number" min="0" value="${esc(s.analyze_per_run)}"></div>
        <div><label for="set-daily_analysis_cap">Daily analysis cap, per agent</label><input id="set-daily_analysis_cap" type="number" min="0" value="${esc(s.daily_analysis_cap)}"></div></div></section>
    <section class="card c6"><h2>LinkedIn profile lookup</h2><p class="mute">Finds profile URLs with Anthropic's web search on the public web. Only links that appear in the search results, under the person's name, are kept; nothing is guessed. Web search must be enabled for your organization in the Claude Console, and costs $10 per 1,000 searches plus tokens (up to 3 searches per lookup).</p>
      <div class="form"><div><label for="set-profile_lookup">Automatic lookup after each run</label>${sel("profile_lookup", [["1", "On"], ["0", "Off, buttons only"]])}</div>
        <div><label for="set-profile_lookup_min_score">Only for leads scoring at least</label><input id="set-profile_lookup_min_score" type="number" min="0" max="100" value="${esc(s.profile_lookup_min_score)}"></div>
        <div><label for="set-profile_lookups_per_day">Automatic lookups per day, per agent</label><input id="set-profile_lookups_per_day" type="number" min="0" value="${esc(s.profile_lookups_per_day)}"></div></div></section>
    <section class="card c6"><h2>Monitoring</h2>
      <div class="form"><div><label for="set-scheduler_enabled">Automatic monitoring</label>${sel("scheduler_enabled", [["1", "On"], ["0", "Off"]])}</div>
        <div><label for="set-interval_hours">Every (hours)</label><input id="set-interval_hours" type="number" min="1" value="${esc(s.interval_hours)}"></div></div>
      <button class="btn pri" style="margin-top:12px" data-a="savesettings">Save settings</button>
      <dl class="meta" style="margin-top:14px"><dt>Database</dt><dd>${st.database === "postgres" ? "Cloud Postgres, one schema per agent" : "Local SQLite, one file per agent"}</dd><dt>Sign-in</dt><dd>${st.login ? "Password required" : "Off (local mode)"}</dd>
        <dt>Background runs</dt><dd>${st.cron ? "External scheduler token set" : "Runs only while the server is awake"}</dd><dt>LinkedIn sending</dt><dd>Manual only</dd></dl></section>
    <section class="card c6"><h2>Performance</h2><p class="mute">Measured on the server just now.</p>
      <dl class="meta"><dt>Database round trip</dt><dd>${diag.db_ping_ms.join(" ms, ")} ms</dd><dt>Leads stored</dt><dd>${AGN.lit} ${diag.leads.lit}, ${AGN.career} ${diag.leads.career}</dd></dl>
      ${diag.requests.length ? `<table><tr><th>Recent requests</th><th class="num">Avg time</th><th class="num">DB queries</th></tr>${diag.requests.slice(0, 8).map((r) => `<tr><td><small>${esc(r.route)}</small></td><td class="num">${r.avg_ms} ms</td><td class="num">${r.avg_queries}</td></tr>`).join("")}</table>` : ""}
      <p class="mute" style="margin-top:8px">On Render's free plan the first visit after 15 idle minutes waits about a minute while the server wakes up; that delay is outside the app.</p></section>
    ${scoring("lit")}${scoring("career")}${src("lit")}${src("career")}
    <section class="card c12"><h2>LinkedIn data access</h2><p class="mute">What LinkedIn officially allows for a personal tool, and how each case is handled here. No scraping, session cookies or browser automation.</p>
      <div style="overflow-x:auto"><table style="min-width:760px"><tr><th>Capability</th><th>Status</th><th>Why</th><th>How it works here</th></tr>${S.cfg.linkedin_access.map((x) => `<tr><td><b>${esc(x.capability)}</b></td><td><span class="chip ${stat[x.status][1]}">${stat[x.status][0]}</span></td><td>${esc(x.detail)}</td><td>${esc(x.workflow)}</td></tr>`).join("")}</table></div>
      <h3>Import your connections</h3><p class="mute">${st.connections} imported. On LinkedIn: Settings, Data privacy, Get a copy of your data, Connections. Then choose <code>Connections.csv</code>. It flags people you already know.</p>
      <input type="file" id="net-file" accept=".csv" style="max-width:340px" aria-label="Connections.csv"></section>
    <section class="card c12" style="padding:0;overflow:hidden"><h2 style="padding:14px 16px 0">Recent monitoring runs</h2>${st.last_runs.length ? `<div style="overflow-x:auto"><table><tr><th>When</th><th>Agent</th><th>Trigger</th><th class="num">Fetched</th><th class="num">New</th><th class="num">Analyzed</th></tr>${st.last_runs.map((r) => `<tr><td>${when(r.started_at)}</td><td>${esc(r.agent)}</td><td>${esc(r.trigger)}</td><td class="num">${r.fetched}</td><td class="num">${r.new_signals}</td><td class="num">${r.analyzed}</td></tr>${r.errors ? `<tr><td colspan="6" style="color:var(--bad)"><small>${esc(r.errors)}</small></td></tr>` : ""}`).join("")}</table></div>` : '<div class="empty">No runs yet.</div>'}</section>
  </div>`;
}

/* ------------------------------------------------------------ actions */
const val = (id) => ($("#" + id) ? $("#" + id).value.trim() : "");
const dpath = () => `/${S.drawer.agent}/opportunities/${S.drawer.id}`;
const curF = () => (S.page === "agent" ? S.af : S.lf);
const rowItem = (tr) => ({ agent: tr.dataset.agent, opp_id: tr.dataset.opp ? +tr.dataset.opp : null, signal_id: tr.dataset.sig ? +tr.dataset.sig : null });
const findMsg = (el) => { const k = el.dataset.agent, id = +el.dataset.id; const pool = el.closest("#drawer") ? S.opp.messages : (S.cache["/messages?agent=all"] || { d: [] }).d.filter((m) => m.agent === k); return pool.find((x) => x.id === id); };
function openLead(agent, id) { S.drawer = { kind: "opp", agent, id: +id }; S.opp = null; S.editContact = null; renderDrawer(); refreshDrawer().catch((e) => toast(e.message, true)); }
function openSig(agent, id) { S.drawer = { kind: "signal", agent, id: +id }; S.sig = null; renderDrawer(); refreshDrawer().catch((e) => toast(e.message, true)); }
const A = {
  page: (el) => { S.page = el.dataset.v; if (el.dataset.agent) S.agent = el.dataset.agent; if (el.dataset.v === "agent") S.agentTab = "leads"; S.sel.clear(); window.scrollTo(0, 0); show(); },
  atab: (el) => { S.agentTab = el.dataset.v; show(); },
  setagent: (el) => { S.agent = el.dataset.v; show(); },
  lfagent: (el) => { S.lf.agent = el.dataset.v; S.lf.page = 1; show(); },
  cat: (el) => { const f = curF(); f.category = el.dataset.v; f.page = 1; S.sel.clear(); show(); },
  leadcat: (el) => { S.page = "leads"; S.lf.category = el.dataset.v; S.lf.page = 1; show(); },
  pg: (el) => { const f = curF(); f.page += +el.dataset.v; S.sel.clear(); show(); window.scrollTo(0, 0); },
  inboxtab: (el) => { S.page = "inbox"; S.inboxTab = el.dataset.v; show(); },
  inboxagent: (el) => { S.inboxAgent = el.dataset.v; show(); },
  open: (el) => openLead(el.dataset.agent, el.dataset.id),
  opensig: (el) => openSig(el.dataset.agent, el.dataset.id),
  openrow: (el) => (el.dataset.opp ? openLead(el.dataset.agent, el.dataset.opp) : openSig(el.dataset.agent, el.dataset.sig)),
  close: () => { S.drawer = null; S.opp = S.sig = null; renderDrawer(); },
  sel: (el) => { const tr = el.closest("tr"); el.checked ? S.sel.set(el.dataset.key, rowItem(tr)) : S.sel.delete(el.dataset.key); show(); },
  selall: (el) => { document.querySelectorAll("tr[data-key]").forEach((tr) => (el.checked ? S.sel.set(tr.dataset.key, rowItem(tr)) : S.sel.delete(tr.dataset.key))); show(); },
  clearsel: () => { S.sel.clear(); show(); },
  bulk: (el) => busy(el, async () => {
    const items = [...S.sel.values()], act = el.dataset.v;
    const r = await api("POST", "/leads/bulk", { action: act, items });
    S.sel.clear();
    await after(act === "find_profiles" ? `Looking up ${r.count} lead(s) in the background` : `${r.updated} lead(s) updated`);
  }),
  logout: () => api("POST", "/logout").then(() => showLogin()),
  run: (el) => busy(el, async () => { await api("POST", `/${el.dataset.agent}/run`); toast("Monitoring run started"); setTimeout(loadStatus, 1500); }),
  runall: (el) => busy(el, async () => { for (const k of AG) await api("POST", `/${k}/run`); toast("Monitoring run started for both agents"); setTimeout(loadStatus, 1500); }),
  capture: (el) => busy(el, async () => {
    const r = await api("POST", `/${S.agent}/signals`, { kind: val("c-kind"), url: val("c-url"), author: val("c-author"), author_title: val("c-atitle"), company: val("c-company"), body: val("c-body"), title: val("c-company") || val("c-author"), analyze: !!el.dataset.analyze });
    if (r.result && r.result.opportunity_id) { openLead(S.agent, r.result.opportunity_id); toast(r.result.relevant ? "Analyzed: score " + r.result.score : "Rejected by AI, kept in All leads: " + (r.result.reason || "")); }
    else toast("Captured");
    await after();
  }),
  sigact: (el) => busy(el, async () => {
    const k = el.dataset.agent, id = el.dataset.sig, v = el.dataset.v;
    if (v === "analyze") {
      const r = await api("POST", `/${k}/signals/${id}/analyze`);
      if (r.opportunity_id) openLead(k, r.opportunity_id);
      await after(r.relevant ? "Analyzed: score " + r.score : "Rejected by AI, kept in All leads");
    } else { await api("POST", `/${k}/signals/${id}/${v}`); await after(v === "dismiss" ? "Dismissed; it stays in All leads" : "Back in the queue"); }
  }),
  decide: (el) => busy(el, async () => {
    await api("POST", `/${el.dataset.agent}/opportunities/${el.dataset.opp}/decision`, { decision: el.dataset.v });
    await after({ pursue: "Marked to pursue; it is on the pipeline board", dismissed: "Dismissed; it stays in All leads", new: "Back to review" }[el.dataset.v]);
  }),
  lookup: (el) => busy(el, async () => {
    const r = await api("POST", `/${el.dataset.agent}/opportunities/${el.dataset.opp}/find_profiles`, el.dataset.contact ? { contact_id: +el.dataset.contact } : {});
    await after(r.lookup.found ? `Found ${r.lookup.found} LinkedIn profile(s)` : "No LinkedIn profile found in the search results; marked as missing");
  }),
  ack: (el) => busy(el, async () => { await api("PATCH", dpath(), { conflict_ack: 1 }); await after(); }),
  research: (el) => busy(el, async () => { await api("POST", dpath() + "/research"); await after("Re-assessed with web research"); }),
  editc: (el) => { S.editContact = S.editContact === +el.dataset.id ? null : +el.dataset.id; renderDrawer(); },
  savec: (el) => busy(el, async () => { await api("PATCH", `/${S.drawer.agent}/contacts/${el.dataset.id}`, { name: val("e-name"), title: val("e-title"), linkedin_url: val("e-url"), location: val("e-loc") }); S.editContact = null; await after("Saved"); }),
  addcontact: (el) => busy(el, async () => { await api("POST", dpath() + "/contacts", { name: val("n-name"), title: val("n-title"), linkedin_url: val("n-url"), location: val("n-loc") }); await after("Person added"); }),
  delcontact: (el) => busy(el, async () => { await api("DELETE", `/${S.drawer.agent}/contacts/${el.dataset.id}`); await after(); }),
  draft: (el) => busy(el, async () => { await api("POST", dpath() + "/draft", { contact_id: +val("d-contact"), type: val("d-type") }); await after("Draft ready for review"); }),
  mact: (el) => busy(el, async () => {
    const k = el.dataset.agent, id = el.dataset.id, act = el.dataset.act, ta = $(`#mt-${k}-${id}`);
    if (["approve", "edit", "save"].includes(act) && ta && !ta.readOnly) await api("POST", `/${k}/messages/${id}`, { action: "edit", text: ta.value });
    if (act !== "edit") await api("POST", `/${k}/messages/${id}`, { action: act, reply: el.dataset.reply });
    await after({ approve: "Approved. Copy it and send it on LinkedIn.", sent: "Marked as sent", edit: "Edit saved", reply: "Reply logged", reject: "Rejected", save: "Saved for later" }[act] || "Done");
  }),
  usealt: (el) => { const m = findMsg(el), ta = $(`#mt-${el.dataset.agent}-${m.id}`); ta.value = m.alternative; ta.dispatchEvent(new Event("input", { bubbles: true })); },
  copy: (el) => navigator.clipboard.writeText($(`#mt-${el.dataset.agent}-${el.dataset.id}`).value).then(() => toast("Copied"), () => toast("Copy failed. Select the text manually.", true)),
  copyfu: (el) => navigator.clipboard.writeText(findMsg(el).follow_up).then(() => toast("Follow-up copied"), () => toast("Copy failed", true)),
  dismissall: (el) => confirm("Dismiss every signal waiting for this agent? They stay visible under Dismissed.") && busy(el, async () => { await api("POST", `/${S.agent}/signals/dismiss_all`); await after(); }),
  savesettings: (el) => busy(el, async () => { const b = {}; ["model", "web_research", "analyze_per_run", "daily_analysis_cap", "scheduler_enabled", "interval_hours", "profile_lookup", "profile_lookup_min_score", "profile_lookups_per_day"].forEach((k) => (b[k] = val("set-" + k))); await api("POST", "/settings", b); await after("Settings saved"); }),
  savescoring: (el) => busy(el, async () => { const k = el.dataset.agent, weights = {}; C(k).criteria.forEach((c) => (weights[c.key] = +val(`w-${k}-${c.key}`))); await api("POST", `/${k}/scoring`, { weights, guidance: val("g-" + k) }); S.cfg = await api("GET", "/config"); await after("Scoring saved"); }),
  resetw: (el) => { const k = el.dataset.agent; C(k).default_criteria.forEach((c) => ($(`#w-${k}-${c.key}`).value = c.max)); $("#wt-" + k).textContent = 100; },
  srctoggle: (el) => busy(el, async () => { await api("PATCH", `/${el.dataset.agent}/sources/${el.dataset.id}`, { enabled: +el.dataset.v }); await after(); }),
  srcdel: (el) => confirm("Delete this source?") && busy(el, async () => { await api("DELETE", `/${el.dataset.agent}/sources/${el.dataset.id}`); await after(); }),
  srctest: (el) => busy(el, async () => { await api("POST", `/${el.dataset.agent}/run`, { source: +el.dataset.id }); await new Promise((r) => setTimeout(r, 4000)); await after(); }),
  srcadd: (el) => busy(el, async () => {
    const k = el.dataset.agent, type = val("s-type-" + k), v = val("s-val-" + k), cfg = { keywords: val("s-kw-" + k).split(",") }, T = S.cfg.source_types[type];
    if (T.field) { if (!v) throw new Error("Enter the feed URL or board slug"); cfg[T.field] = v; }
    await api("POST", `/${k}/sources`, { type, name: val("s-name-" + k) || v || type, config: cfg }); await after();
  }),
};
document.addEventListener("click", (e) => {
  if (e.target.id === "drawer") return A.close();
  const el = e.target.closest("[data-a]"); if (!el || el.disabled) return;
  if (e.target.closest("a[href]:not([data-a])")) return;
  if (el.tagName === "A") e.preventDefault();
  const inner = e.target.closest("button,a,input,select,textarea"); if (inner && inner !== el && el.contains(inner)) return;
  if (el.tagName === "INPUT" && el.type === "checkbox") return; // handled on change
  A[el.dataset.a](el);
});
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "login") return; e.preventDefault();
  try { await api("POST", "/login", { password: $("#pw").value }); location.reload(); } catch (err) { $("#lerr").textContent = err.message; }
});
let qTimer;
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.count) { const c = t.nextElementSibling, max = +t.dataset.max; c.textContent = t.value.length + " / " + max; c.classList.toggle("over", t.value.length > max); }
  if (t.dataset.w) { const k = t.dataset.w, sum = C(k).criteria.reduce((s, c) => s + (+$(`#w-${k}-${c.key}`).value || 0), 0), o = $("#wt-" + k); o.textContent = sum; o.style.color = sum === 100 ? "" : "var(--bad)"; }
  if (t.dataset.f === "q") { const f = curF(); f.q = t.value; f.page = 1; clearTimeout(qTimer); qTimer = setTimeout(show, 250); }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  try {
    if (t.dataset.a === "sel" || t.dataset.a === "selall") return A[t.dataset.a](t);
    if (t.dataset.f && t.dataset.f !== "q") { const f = curF(); f[t.dataset.f] = t.value; f.page = 1; return show(); }
    if (t.id === "net-file" && t.files[0]) { const r = await api("POST", "/network/import", { csv: await t.files[0].text() }); return after(r.imported + " connections imported"); }
    if (!t.dataset.change || !S.drawer) return;
    const body = t.dataset.change === "stage" ? { stage: t.value } : t.dataset.change === "meeting" ? { meeting_at: t.value } : { notes: t.value };
    await api("PATCH", dpath(), body); await after("Saved");
  } catch (err) { toast(err.message, true); }
});
document.addEventListener("dragstart", (e) => { const c = e.target.closest("[data-drag]"); if (c) e.dataTransfer.setData("text/plain", c.dataset.drag); });
document.addEventListener("dragover", (e) => { const c = e.target.closest(".col"); if (c && !c.dataset.intake) { e.preventDefault(); c.classList.add("over"); } });
document.addEventListener("dragleave", (e) => { const c = e.target.closest(".col"); if (c) c.classList.remove("over"); });
document.addEventListener("drop", async (e) => {
  const c = e.target.closest(".col"), id = e.dataTransfer.getData("text/plain"); if (!c || !id || c.dataset.intake) return; e.preventDefault();
  try { await api("PATCH", `/${S.agent}/opportunities/${id}`, { stage: c.dataset.stage }); } catch (err) { toast(err.message, true); } after();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.drawer) A.close(); });

(async () => {
  try {
    const s = await api("GET", "/session");
    if (!s.authenticated) return showLogin();
    [S.cfg, S.status] = await Promise.all([api("GET", "/config"), api("GET", "/status")]);
    renderNav(); await show();
  } catch (e) { if (!$("#login")) $("#main").innerHTML = "<p style='padding:30px'>Could not load: " + esc(e.message) + "</p>"; }
  let wasBusy = false;
  setInterval(async () => { // keep the status line current; refresh the screen only when a background job finishes
    if (document.hidden || $("#login")) return;
    await loadStatus();
    const busyNow = !!(S.status && (S.status.running.length || (S.status.job || {}).running));
    if (wasBusy && !busyNow) { invalidate(); show(true); refreshDrawer(); }
    wasBusy = busyNow;
  }, 15000);
})();
