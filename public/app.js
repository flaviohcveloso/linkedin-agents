"use strict";
const AG = ["lit", "career"];
const S = { cfg: null, status: null, page: "dashboard", agent: "lit", tab: "list", inboxTab: "review", inboxAgent: "all", f: { q: "", band: "", stage: "", industry: "", track: "", parked: false }, showIrrelevant: false, d: { lit: {}, career: {} }, drawer: null };
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const day = (t) => (t ? String(t).slice(0, 10) : "");
const nice = (s) => String(s || "").replace(/_/g, " ");
const when = (t) => (t ? new Date(t).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const C = (k) => S.cfg.agents[k];

async function api(method, path, body) {
  const r = await fetch("/api" + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/login") { showLogin(); throw new Error("Sign in to continue"); }
  if (!r.ok) throw new Error(j.error || "Request failed");
  return j;
}
function toast(msg, bad) {
  const t = $("#toast"); t.textContent = msg; t.className = bad ? "bad" : ""; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), bad ? 7000 : 2600);
}
async function busy(el, fn) {
  const old = el && el.textContent;
  if (el && el.tagName === "BUTTON") { el.disabled = true; el.textContent = "Working…"; }
  try { await fn(); } catch (e) { toast(e.message, true); }
  finally { if (el && el.isConnected && el.tagName === "BUTTON") { el.disabled = false; el.textContent = old; } }
}
function badge(basis, prov) {
  if (basis === "hypothesis") return '<span class="chip b-hyp">AI hypothesis</span>';
  if (basis === "public_web") return '<span class="chip b-web">Public information</span>';
  if (basis === "user_provided" || prov === "user_provided") return '<span class="chip b-user">User-provided</span>';
  return '<span class="chip b-retrieved">Retrieved data</span>';
}
const scoreDot = (n, k) => `<div class="score ${k || ""} ${n >= 90 ? "s90" : n < 50 ? "s0" : ""}">${n}</div>`;
function pill(a, stage) {
  const st = a.stages, i = st.indexOf(stage), at = (k) => st.indexOf(a.auto[k]);
  const cls = stage === a.won_stage ? "p-win" : a.closed_stages.includes(stage) ? "p-lost" : a.intake_stages.includes(stage) ? "p-new" : i >= at("replied") ? "p-good" : i >= Math.min(at("sent"), at("sent_connection")) ? "p-out" : "p-work";
  return `<span class="pill ${cls}">${esc(stage)}</span>`;
}
const agentSeg = (cur, action, withAll) => `<div class="seg">${(withAll ? [["all", "Both agents", ""]] : []).concat(AG.map((k) => [k, C(k).name, k])).map(([k, l, c]) => `<button class="${cur === k ? "on" : ""}" data-a="${action}" data-v="${k}">${c ? `<span class="dot ${c}"></span>` : ""}${esc(l)}</button>`).join("")}</div>`;

/* ------------------------------------------------------------ loading */
async function load() {
  const [status, overview, ...rest] = await Promise.all([api("GET", "/status"), api("GET", "/overview"),
    ...AG.flatMap((a) => [api("GET", `/${a}/opportunities`), api("GET", `/${a}/signals`), api("GET", `/${a}/messages`)])]);
  S.status = status; S.overview = overview;
  AG.forEach((a, i) => { S.d[a].opps = rest[i * 3]; S.d[a].sigs = rest[i * 3 + 1]; S.d[a].msgs = rest[i * 3 + 2].map((m) => ({ ...m, agent: a })); });
  if (S.page === "analytics") S.d[S.agent].an = await api("GET", `/${S.agent}/analytics`);
  if (S.page === "settings") { S.cfg = await api("GET", "/config"); for (const a of AG) S.d[a].sources = await api("GET", `/${a}/sources`); }
  if (S.page === "agent" && S.tab === "signals" && S.showIrrelevant) S.d[S.agent].irr = await api("GET", `/${S.agent}/signals?status=irrelevant`);
  if (S.drawer) S.opp = await api("GET", `/${S.drawer.agent}/opportunities/${S.drawer.id}`);
  render();
}
const reload = () => load().catch((e) => toast(e.message, true));
const allMsgs = () => AG.flatMap((a) => S.d[a].msgs || []);

/* ------------------------------------------------------------ shell */
function render() {
  const st = S.status, pend = allMsgs().filter((m) => m.status === "drafted" || m.status === "approved").length;
  const item = (page, label, extra = "", on = S.page === page) => `<button class="${on ? "on" : ""}" data-a="page" data-v="${page}" ${extra}>${label}</button>`;
  $("#nav").innerHTML = `<div class="brand"><i></i><span>LinkedIn Agents</span></div>
    ${item("dashboard", '<span class="dot"></span>Dashboard')}
    ${item("inbox", `<span class="dot"></span>Inbox${pend ? `<span class="n">${pend}</span>` : ""}`)}
    <div class="sep">Agents</div>
    ${AG.map((k) => item("agent", `<span class="dot ${k}"></span>${k === "lit" ? "Lit Collective" : "Career"}`, `data-agent="${k}"`, S.page === "agent" && S.agent === k)).join("")}
    <div class="sep">Workspace</div>
    ${item("pipelines", '<span class="dot"></span>Pipelines')}${item("analytics", '<span class="dot"></span>Analytics')}${item("settings", '<span class="dot"></span>Settings')}
    <div class="foot"><span class="live ${st.running.length ? "run" : st.claude ? "on" : ""}"></span><b>${st.running.length ? "Monitoring now" : st.claude ? "Claude connected" : "Claude not configured"}</b><br>
      ${st.next_run && !st.running.length ? "Next run " + when(st.next_run) + "<br>" : ""}LinkedIn sending is manual
      ${st.login ? '<br><a href="#" data-a="logout">Sign out</a>' : ""}</div>`;
  document.querySelector("main").className = S.page === "agent" ? S.agent : "";
  $("#main").innerHTML = { dashboard: vDash, inbox: vInbox, agent: vAgent, pipelines: vPipes, analytics: vAnalytics, settings: vSettings }[S.page]();
  const dr = $("#drawer");
  if (S.drawer && S.opp) {
    const keep = dr.querySelector(".panel")?.scrollTop || 0;
    dr.hidden = false; dr.className = S.drawer.agent; dr.innerHTML = `<div class="panel" data-agent="${S.drawer.agent}">${vDrawer(S.opp, C(S.drawer.agent))}</div>`;
    dr.querySelector(".panel").scrollTop = keep;
  } else dr.hidden = true;
}
const noKey = () => (S.status.claude ? "" : `<div class="banner"><b>Claude is not configured.</b> Signals are still collected, but nothing is scored or drafted until <code>ANTHROPIC_API_KEY</code> is set in the host's environment variables. No results are simulated.</div>`);
function showLogin(msg) {
  $("#drawer").hidden = true;
  $("#app").innerHTML = `<div class="login" style="grid-column:1/-1"><form class="card" id="login"><div class="brand" style="padding:0 0 14px"><i></i><span>LinkedIn Agents</span></div>
    <h1>Sign in</h1><p class="mute" style="margin-top:4px">Private workspace of Flávio Veloso.</p>
    <label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" autofocus>
    <button class="btn pri" style="margin-top:14px;width:100%;justify-content:center">Sign in</button><p id="lerr" style="color:var(--bad);margin:10px 0 0">${esc(msg || "")}</p></form></div>`;
}

/* ------------------------------------------------------------ dashboard */
function vDash() {
  const ms = allMsgs(), n = (f) => ms.filter(f).length, o = S.overview, st = S.status;
  const follow = AG.reduce((t, a) => t + o[a].actions.filter((x) => x.kind === "follow_up").length, 0), waiting = AG.reduce((t, a) => t + o[a].metrics.pending_analysis, 0);
  const todo = (num, label, tab) => `<div class="todo ${num ? "" : "zero"}" data-a="inboxtab" data-v="${tab}"><b>${num}</b><span>${label}</span></div>`;
  const tile = (k) => { const a = C(k), m = o[k].metrics, max = Math.max(1, o[k].funnel[0][1]); return `<section class="card c4 ${k}"><div class="tile-top"><h2><span class="dot ${k}"></span>${esc(a.name)}</h2><button class="btn sm" data-a="page" data-v="agent" data-agent="${k}">Open</button></div>
      <div class="kpis"><div><div class="big">${m.opportunities}</div><span>${k === "lit" ? "leads identified" : "opportunities identified"}</span></div>
        <div class="hot"><div class="big">${m.top_band}</div><span>scoring 90+</span></div><div><div class="big">${m.high_band}</div><span>scoring 75+</span></div></div>
      <div class="funnel">${o[k].funnel.map(([l, v]) => `<span class="mute">${esc(l)}</span><div class="track"><i style="width:${(100 * v) / max}%"></i></div><b>${v}</b>`).join("")}</div></section>`; };
  const top3 = (S.d.career.opps || []).filter((x) => !x.parked && x.score >= 50 && !C("career").closed_stages.includes(x.stage)).slice(0, 3);
  const actions = AG.flatMap((k) => o[k].actions.map((x) => ({ ...x, agent: k }))).sort((x, y) => y.score - x.score).slice(0, 8);
  const feed = AG.flatMap((k) => o[k].activity.map((e) => ({ ...e, agent: k }))).sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 10);
  const evt = (e) => ({ stage: "moved to " + (e.data.to || ""), drafted: "message drafted", approved: "message approved", sent: "message sent", reply: "reply logged: " + (e.data.reply || "") }[e.type] || e.type);
  const rows = [["new_signals_7d", "New signals, last 7 days"], ["drafted", "Messages drafted"], ["approved", "Messages approved"], ["sent", "Messages sent"], ["replies", "Replies received"], ["positive", "Positive conversations"], ["meetings", "Meetings booked / interviews"], ["won", "Clients won / offers"]];
  const srcs = AG.flatMap((k) => o[k].sources.filter((s) => s.enabled)), failing = srcs.filter((s) => (s.last_status || "").startsWith("Failed")).length, last = st.last_runs[0];
  return `<div class="head"><div><h1>Dashboard</h1><small>Two agents, separate pipelines. Every message waits for your approval and is sent by you.</small></div></div>${noKey()}
  <div class="bento">
    <section class="card c4"><div class="tile-top"><h2>Needs you</h2></div>
      ${todo(n((m) => m.status === "drafted"), "drafts to review", "review")}${todo(n((m) => m.status === "approved"), "approved, ready to send", "send")}${todo(follow, "follow-ups due", "waiting")}
      <div class="todo ${waiting ? "" : "zero"}" data-a="page" data-v="agent" data-agent="lit" data-tab="signals"><b>${waiting}</b><span>signals awaiting analysis</span></div></section>
    ${tile("lit")}${tile("career")}
    ${top3.length ? `<section class="card c12 career"><div class="tile-top"><h2><span class="dot career"></span>Top roles for Flávio right now</h2><button class="btn sm" data-a="page" data-v="agent" data-agent="career">All roles</button></div>
      <div class="grid2" style="grid-template-columns:repeat(${top3.length},1fr)">${top3.map((o) => { const r = o.role || {}; return `<div class="row" style="margin:0" data-a="open" data-agent="career" data-id="${o.id}">${scoreDot(o.score)}<div class="body"><div class="co">${esc(r.title || o.headline)}</div><div class="mute">${esc(o.company)}, ${esc(r.category || "")}</div>
        <div style="margin:4px 0">${esc(r.why_fit || "")}</div>${(r.highlights || []).map((h) => `<div class="mute">Highlight: ${esc(h)}</div>`).join("")}</div></div>`; }).join("")}</div></section>` : ""}
    <section class="card c8"><div class="tile-top"><h2>Who to contact next</h2></div>
      ${actions.length ? actions.map((x) => `<div class="row ${x.agent}" data-a="open" data-agent="${x.agent}" data-id="${x.opp}">${scoreDot(x.score)}<div class="body">
        <div class="sp"><div><span class="co">${esc(x.company)}</span> <span class="mute">${esc(x.who || "")}</span></div><span class="chip acc">${esc(x.label)}</span></div><div class="mute">${esc((x.detail || "").slice(0, 190))}</div></div></div>`).join("")
      : `<div class="empty">No qualified opportunities yet. Capture a LinkedIn post or job on an agent page, or wait for the next monitoring run.</div>`}</section>
    <section class="card c4"><div class="tile-top"><h2>Monitoring</h2><button class="btn sm" data-a="runall" ${st.running.length ? "disabled" : ""}>${st.running.length ? "Running…" : "Run now"}</button></div>
      <p><span class="live ${st.running.length ? "run" : st.settings.scheduler_enabled === "1" ? "on" : ""}"></span>${st.running.length ? "Fetching and analyzing" : st.settings.scheduler_enabled === "1" ? `Every ${esc(st.settings.interval_hours)} hours` : "Schedule is off"}</p>
      <dl class="meta" style="grid-template-columns:96px 1fr"><dt>Last run</dt><dd>${last ? `${when(last.started_at)}, ${last.new_signals} new, ${last.analyzed} analyzed` : "none yet"}</dd><dt>Next run</dt><dd>${st.next_run ? when(st.next_run) : "—"}</dd>
        <dt>Sources</dt><dd>${srcs.length} active${failing ? `, <span style="color:var(--bad)">${failing} failing</span>` : ""}</dd><dt>Background</dt><dd>${st.cron ? "external scheduler configured" : "runs while the server is awake"}</dd></dl>
      ${last && last.errors ? `<div class="banner bad" style="margin:10px 0 0;font-size:12px">${esc(last.errors.slice(0, 240))}</div>` : ""}</section>
    <section class="card c6"><div class="tile-top"><h2>Recent activity</h2></div>${feed.length ? feed.map((e) => `<div class="feed" data-a="open" data-agent="${e.agent}" data-id="${e.opportunity_id}"><span class="dot ${e.agent}" style="width:8px;height:8px;border-radius:3px;flex:none"></span><span><b>${esc(e.company)}</b> ${esc(evt(e))}</span><time>${when(e.at)}</time></div>`).join("") : '<div class="empty">Nothing has happened yet.</div>'}</section>
    <section class="card c6" style="padding:0;overflow:hidden"><table><tr><th>Metric</th>${AG.map((k) => `<th class="num"><span class="dot ${k}" style="display:inline-block;width:8px;height:8px;border-radius:3px;margin-right:6px"></span>${k === "lit" ? "Lit Collective" : "Career"}</th>`).join("")}</tr>
      ${rows.map(([k, l]) => `<tr><td>${l}</td>${AG.map((a) => `<td class="num">${o[a].metrics[k]}</td>`).join("")}</tr>`).join("")}</table></section>
  </div>`;
}

/* ------------------------------------------------------------ agent page */
function vAgent() {
  const a = C(S.agent), D = S.d[S.agent];
  return `<div class="head"><div><h1>${esc(a.name)}</h1><small>${esc(a.tagline)}</small></div>
      <div class="btns"><div class="seg"><button class="${S.tab === "list" ? "on" : ""}" data-a="tab" data-v="list">${a.key === "lit" ? "Leads" : "Opportunities"} ${D.opps.filter((o) => !o.parked).length}</button><button class="${S.tab === "signals" ? "on" : ""}" data-a="tab" data-v="signals">Signals ${D.sigs.length}</button></div>
      <button class="btn" data-a="run" data-agent="${a.key}" ${S.status.running.includes(a.key) ? "disabled" : ""}>${S.status.running.includes(a.key) ? "Running…" : "Run monitoring"}</button></div></div>
    ${noKey()}${S.tab === "list" ? vList(a, D) : vSignals(a, D)}`;
}
function vList(a, D) {
  const f = S.f, q = f.q.toLowerCase(), inds = [...new Set(D.opps.map((o) => o.industry).filter(Boolean))].sort();
  const list = D.opps.filter((o) => !!o.parked === f.parked && (!f.band || o.score >= +f.band) && (!f.stage || o.stage === f.stage) && (a.key === "career" ? !f.track || (o.role || {}).category === f.track : !f.industry || o.industry === f.industry) && (!q || (o.company + " " + o.headline + " " + (o.contact ? o.contact.name : "")).toLowerCase().includes(q)));
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`;
  return `<div class="filters"><input type="search" placeholder="Search company or person" value="${esc(f.q)}" data-f="q">
      <select data-f="band">${opt("", "Any score", f.band)}${a.bands.slice(0, 3).map(([n, l]) => opt(String(n), `${l} (${n}+)`, f.band)).join("")}</select>
      <select data-f="stage">${opt("", "Any stage", f.stage)}${a.stages.slice(1).map((s) => opt(s, s, f.stage)).join("")}</select>
      ${a.key === "career" ? `<select data-f="track">${opt("", "Any track", f.track)}${a.tracks.map((s) => opt(s, s, f.track)).join("")}</select>` : `<select data-f="industry">${opt("", "Any industry", f.industry)}${inds.map((s) => opt(s, s, f.industry)).join("")}</select>`}
      <div class="seg"><button class="${f.parked ? "" : "on"}" data-a="parkedf" data-v="">Active</button><button class="${f.parked ? "on" : ""}" data-a="parkedf" data-v="1">Low priority</button></div><span class="mute">${list.length} shown</span></div>
  ${a.key === "career" ? `<div class="tablewrap career"><table style="min-width:1080px"><tr><th>Score</th><th>Role and company</th><th>Track</th><th>Remote, accepts Brazil?</th><th>Level</th><th>Salary</th><th>Published</th><th>Why it fits</th><th>Status</th></tr>
    ${list.map((o) => { const r = o.role || {}; return `<tr class="click" data-a="open" data-agent="career" data-id="${o.id}"><td>${scoreDot(o.score)}</td>
      <td><b>${esc(r.title || o.headline)}</b>${o.conflict && !o.conflict_ack ? ' <span class="chip b-bad">identity conflict</span>' : ""}<br><small>${esc(o.company)}, ${esc(o.industry)}</small>${safeUrl(o.link) ? `<br><a href="${esc(o.link)}" target="_blank" rel="noopener"><small>Open posting</small></a>` : ""}</td>
      <td><span class="chip acc">${esc(r.category || "Other")}</span>${r.has_public_opening === false ? '<br><span class="chip b-hyp">no public vacancy</span>' : ""}</td>
      <td><span class="chip ${r.remote === "Remote worldwide" ? "b-ok" : ""}">${esc(r.remote || "Unknown")}</span><br><small>${esc(r.brazil_evidence || "not stated")}</small></td>
      <td><small>${esc(r.level || "not stated")}</small></td><td><small>${esc(r.salary || "not stated")}</small></td><td><small>${esc(r.published || "not stated")}</small></td>
      <td><small>${esc(r.why_fit || (o.next_step || "").slice(0, 110))}</small></td><td>${pill(a, o.stage)}<br><small>${esc(o.classification)}</small></td></tr>`; }).join("") || `<tr><td colspan="9"><div class="empty">${D.opps.length ? "Nothing matches these filters." : "No opportunities yet. Capture a job posting or run monitoring."}</div></td></tr>`}</table></div>`
  : `<div class="tablewrap lit"><table style="min-width:860px"><tr><th>Score</th><th>Company</th><th>Signals and services</th><th>Who to contact</th><th>Status</th><th>Next step</th></tr>
    ${list.map((o) => `<tr class="click" data-a="open" data-agent="lit" data-id="${o.id}"><td>${scoreDot(o.score)}</td>
      <td><b>${esc(o.company)}</b>${o.conflict && !o.conflict_ack ? ' <span class="chip b-bad">identity conflict</span>' : ""}<br><small>${esc(o.industry)}, ${esc(o.company_stage)}</small></td>
      <td>${(o.detected || []).map((x) => `<span class="chip">${esc(nice(x.type))}</span>`).join("")}${(o.services || []).map((x) => `<span class="chip acc">${esc(x)}</span>`).join("")}</td>
      <td>${o.contact ? (o.contact.name ? `${esc(o.contact.name)}<br><small>${esc(o.contact.title)}</small>` : `<small>Find: ${esc(o.contact.title)}</small>`) : "<small>to identify</small>"}</td>
      <td>${pill(a, o.stage)}<br><small>${esc(o.classification)}</small></td><td><small>${esc((o.next_step || "").slice(0, 110))}</small></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">${D.opps.length ? "Nothing matches these filters." : "No leads yet. Capture a signal or run monitoring."}</div></td></tr>`}</table></div>`}`;
}
function vSignals(a, D) {
  const sig = (s) => `<div class="fact"><div class="sp"><div><b>${esc(s.title || nice(s.kind))}</b> ${badge(s.provenance === "retrieved" ? "stated_in_source" : "user_provided", s.provenance)}<span class="chip ${s.status === "error" ? "b-bad" : ""}">${esc(s.status === "irrelevant" ? "not relevant" : s.status)}</span></div><small>${esc(s.source_name)}, ${day(s.created_at)}</small></div>
      <div class="mute">${esc((s.body || "").slice(0, 240))}${(s.body || "").length > 240 ? "…" : ""}</div>${s.error ? `<div style="color:${s.status === "error" ? "var(--bad)" : "var(--mute)"}">${esc(s.error)}</div>` : ""}
      ${s.status === "irrelevant" ? "" : `<div class="btns" style="margin-top:6px"><button class="btn sm pri" data-a="analyze" data-id="${s.id}" ${S.status.claude ? "" : "disabled"}>Analyze</button><button class="btn sm" data-a="dismiss" data-id="${s.id}">Dismiss</button>${safeUrl(s.url) ? `<a class="btn sm" href="${esc(s.url)}" target="_blank" rel="noopener">Open source</a>` : ""}</div>`}</div>`;
  return `<div class="grid2"><div class="card"><h2>Capture from LinkedIn</h2>
      <p class="mute">Paste a post, profile section or job description you saw. LinkedIn does not let tools read it for you, so this is the authorized route.</p>
      <div class="form"><div><label for="c-kind">Type</label><select id="c-kind">${a.capture_kinds.map((k) => `<option value="${k}">${esc(nice(k))}</option>`).join("")}</select></div>
        <div><label for="c-url">Link (optional)</label><input id="c-url" placeholder="https://www.linkedin.com/posts/…"></div>
        <div><label for="c-author">Person (optional)</label><input id="c-author"></div><div><label for="c-atitle">Their title (optional)</label><input id="c-atitle"></div>
        <div class="full"><label for="c-company">Company (optional)</label><input id="c-company"></div>
        <div class="full"><label for="c-body">Text</label><textarea id="c-body" rows="8" placeholder="Paste the text here"></textarea></div></div>
      <div class="btns" style="margin-top:10px"><button class="btn pri" data-a="capture" data-analyze="1" ${S.status.claude ? "" : "disabled"}>Capture and analyze</button><button class="btn" data-a="capture">Capture only</button></div></div>
    <div class="card"><div class="sp"><h2>Waiting for analysis (${D.sigs.length})</h2>${D.sigs.length ? '<button class="btn sm" data-a="dismissall">Dismiss all</button>' : ""}</div>
      ${D.sigs.length ? D.sigs.map(sig).join("") : '<div class="empty">Nothing waiting.</div>'}
      <div style="margin-top:12px"><button class="btn sm" data-a="irr">${S.showIrrelevant ? "Hide" : "Show"} signals judged not relevant</button></div>
      ${S.showIrrelevant ? (D.irr || []).map(sig).join("") || '<div class="empty">None.</div>' : ""}</div></div>`;
}

/* ------------------------------------------------------------ inbox (both agents) */
function msgCard(m, ctx) {
  const a = C(m.agent || ctx.agentKey), k = a.key, mt = a.message_types.find((t) => t.key === m.type) || { label: m.type, max_chars: 600 };
  const who = ctx ? ctx.contacts.find((c) => c.id === m.contact_id) || {} : { name: m.contact_name, title: m.contact_title, linkedin_url: m.linkedin_url };
  const co = ctx ? ctx.company : m.company, st = m.status, locked = st === "sent" || st === "rejected";
  const li = safeUrl(who.linkedin_url) || "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent((who.name || "") + " " + co);
  const conflict = ctx ? ctx.conflict : m.conflict, blocked = conflict && !(ctx ? ctx.conflict_ack : m.conflict_ack);
  const B = (act, label, cls = "", extra = "") => `<button class="btn ${cls}" data-a="mact" data-id="${m.id}" data-act="${act}" ${extra}>${label}</button>`;
  return `<div class="msg ${k}" data-agent="${k}"><div class="msg-h"><div><span class="dot ${k}" style="display:inline-block;width:8px;height:8px;border-radius:3px;margin-right:7px"></span><b>${esc(who.name || "?")}</b> <span class="mute">${esc(who.title || "")}, ${esc(co)}</span></div>
      <div><span class="chip acc">${esc(mt.label)}</span><span class="chip ${st === "sent" ? "b-ok" : st === "rejected" ? "b-bad" : st === "approved" ? "b-info" : ""}">${esc(st)}${st === "sent" ? " " + day(m.sent_at) : ""}</span>${m.reply !== "none" ? `<span class="chip ${m.reply === "positive" ? "b-ok" : m.reply === "negative" ? "b-bad" : ""}">reply: ${esc(m.reply)}</span>` : ""}</div></div>
    <div class="msg-b"><dl class="meta"><dt>Opportunity type</dt><dd>${k === "lit" ? "Commercial lead, sent as Lit Collective" : "Career opportunity, sent as Flávio"}${ctx ? "" : ` <a href="#" data-a="open" data-agent="${k}" data-id="${m.opportunity_id}">(open, score ${m.score})</a>`}</dd>
      <dt>Detected signal</dt><dd>${esc(m.signal_ref)}</dd><dt>Why it makes sense</dt><dd>${esc(m.rationale)}</dd></dl>
    ${(m.lint || []).map((x) => `<div class="banner bad" style="margin:8px 0 0">${esc(x)}</div>`).join("")}${blocked ? `<div class="banner bad" style="margin:8px 0 0">${esc(conflict)}</div>` : ""}
    <label for="mt-${k}-${m.id}">Suggested message${m.edited ? " (edited by you)" : ""}</label>
    <textarea id="mt-${k}-${m.id}" data-max="${mt.max_chars}" data-count="1" ${locked ? "readonly" : ""}>${esc(m.final_text)}</textarea>
    <div class="count ${m.final_text.length > mt.max_chars ? "over" : ""}">${m.final_text.length} / ${mt.max_chars}</div>
    ${locked ? "" : `<label>Alternative</label><div class="alt">${esc(m.alternative)}</div>`}
    <label>Recommended follow-up if there is no reply in about a week</label><div class="alt">${esc(m.follow_up)}</div>
    <div class="btns" style="margin-top:10px">
      ${st === "drafted" || st === "saved" ? B("approve", "Approve", "pri", blocked ? "disabled" : "") + B("edit", "Save edit") + `<button class="btn" data-a="usealt" data-id="${m.id}">Use alternative</button>` + (st === "drafted" ? B("save", "Save for later") : "") + B("reject", "Reject", "danger") : ""}
      ${st === "approved" ? `<button class="btn pri" data-a="copy" data-id="${m.id}">Copy message</button><a class="btn" href="${esc(li)}" target="_blank" rel="noopener">${safeUrl(who.linkedin_url) ? "Open profile on LinkedIn" : "Find on LinkedIn"}</a>` + B("sent", "I sent it") + B("reopen", "Back to draft") : ""}
      ${st === "sent" ? `<span class="mute">Log the reply</span>${["positive", "neutral", "negative"].map((r) => B("reply", r, "sm " + (m.reply === r ? "pri" : ""), `data-reply="${r}"`)).join("")}<button class="btn sm" data-a="copyfu" data-id="${m.id}">Copy follow-up</button>` : ""}
      ${st === "rejected" ? B("reopen", "Reopen") : ""}${st === "drafted" || st === "saved" ? `<button class="btn" data-a="copy" data-id="${m.id}">Copy</button>` : ""}
    </div></div></div>`;
}
const INBOX = { review: ["To review", (m) => m.status === "drafted"], send: ["Ready to send", (m) => m.status === "approved"], waiting: ["Awaiting reply", (m) => m.status === "sent" && m.reply === "none"], replied: ["Replied", (m) => m.reply !== "none"], saved: ["Saved for later", (m) => m.status === "saved"], rejected: ["Rejected", (m) => m.status === "rejected"] };
function vInbox() {
  const keep = (x) => S.inboxAgent === "all" || x.agent === S.inboxAgent, ms = allMsgs().filter(keep).sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
  const fresh = AG.flatMap((k) => S.d[k].opps.filter((o) => !o.parked && o.score >= 50 && !o.messages && !C(k).closed_stages.includes(o.stage)).map((o) => ({ ...o, agent: k }))).filter(keep).sort((x, y) => y.score - x.score);
  const list = S.inboxTab === "new" ? [] : ms.filter(INBOX[S.inboxTab][1]);
  return `<div class="head"><div><h1>Inbox</h1><small>New leads, job opportunities and AI-drafted messages from both agents. Nothing is sent from here: approve, copy, send on LinkedIn, then mark it as sent.</small></div>${agentSeg(S.inboxAgent, "inboxagent", true)}</div>
    <div class="filters"><div class="seg"><button class="${S.inboxTab === "new" ? "on" : ""}" data-a="inboxtab" data-v="new">New, no outreach yet ${fresh.length}</button>${Object.entries(INBOX).map(([k, [l, f]]) => `<button class="${S.inboxTab === k ? "on" : ""}" data-a="inboxtab" data-v="${k}">${l} ${ms.filter(f).length}</button>`).join("")}</div></div>
    ${S.inboxTab === "new" ? `<div class="card">${fresh.map((o) => `<div class="row ${o.agent}" data-a="open" data-agent="${o.agent}" data-id="${o.id}">${scoreDot(o.score)}<div class="body"><div class="sp"><div><span class="co">${esc(o.company)}</span> <span class="chip acc">${esc(o.classification)}</span></div>${pill(C(o.agent), o.stage)}</div>
        <div>${esc(o.headline)}</div><div class="mute">${o.contact && o.contact.name ? esc(o.contact.name) + ", " + esc(o.contact.title) : "Contact to identify"}. ${esc(o.next_step || "")}</div></div></div>`).join("") || '<div class="empty">No new qualified leads or opportunities waiting for outreach.</div>'}</div>`
      : list.map((m) => msgCard(m)).join("") || '<div class="card empty">Nothing in this queue.</div>'}`;
}

/* ------------------------------------------------------------ pipelines */
function vPipes() {
  const a = C(S.agent), D = S.d[S.agent], intake = a.intake_stages;
  return `<div class="head"><div><h1>Pipelines</h1><small>Drag a card to move it, or change the stage inside the card. Stages also advance when you draft, approve, send or log a reply.</small></div>${agentSeg(S.agent, "setagent")}</div>
  <div class="board ${a.key}">${a.stages.map((st, i) => {
    let cards = D.opps.filter((o) => !o.parked && o.stage === st).map((o) => `<div class="kc" draggable="true" data-drag="${o.id}" data-a="open" data-agent="${a.key}" data-id="${o.id}"><span class="s">${o.score}</span><b>${esc(o.company)}</b>${esc((o.headline || "").slice(0, 70))}${o.contact && o.contact.name ? `<div class="mute">${esc(o.contact.name)}</div>` : ""}</div>`);
    if (i < intake.length) cards = D.sigs.filter((s) => (i === 0 ? s.status === "new" : s.status !== "new")).slice(0, 30).map((s) => `<div class="kc sig" data-a="page" data-v="agent" data-agent="${a.key}" data-tab="signals"><b>${esc((s.title || nice(s.kind)).slice(0, 60))}</b><span class="mute">${esc(s.source_name)}${s.status === "error" ? ", analysis failed" : ""}</span></div>`).concat(cards);
    return `<div class="col" data-stage="${esc(st)}" data-intake="${i === 0 ? 1 : ""}"><h4><span>${esc(st)}</span><span>${cards.length || ""}</span></h4>${cards.join("")}</div>`;
  }).join("")}</div>`;
}

/* ------------------------------------------------------------ analytics */
function vAnalytics() {
  const a = C(S.agent), an = S.d[S.agent].an, lit = a.key === "lit", m = S.overview[a.key].metrics, mw = a.meeting_stage.split(" ")[0];
  if (!an) return "";
  const pct = (x, y) => (y ? Math.round((100 * x) / y) + "%" : "—");
  const K = (v, l) => `<div class="card c4"><div class="big">${v}</div><div class="mute" style="margin-top:6px">${l}</div></div>`;
  const oppT = (title, rows, first) => `<section class="card c6" style="padding:0;overflow:hidden"><h2 style="padding:14px 16px 0">${title}</h2>${rows.length ? `<div style="overflow-x:auto"><table><tr><th>${first}</th><th class="num">Found</th><th class="num">Qualified</th><th class="num">Contacted</th><th class="num">Replied</th><th class="num">${esc(mw)}s</th><th class="num">${esc(a.won_stage)}</th></tr>
    ${rows.map((r) => `<tr><td>${esc(nice(r.group))}</td><td class="num">${r.opportunities}</td><td class="num">${r.qualified}</td><td class="num">${r.contacted}</td><td class="num">${r.replied}</td><td class="num">${r.meetings}</td><td class="num">${r.won}</td></tr>`).join("")}</table></div>` : '<div class="empty">No data yet.</div>'}</section>`;
  const msgT = (title, rows, first) => `<section class="card c6" style="padding:0;overflow:hidden"><h2 style="padding:14px 16px 0">${title}</h2>${rows.length ? `<div style="overflow-x:auto"><table><tr><th>${first}</th><th class="num">Sent</th><th class="num">Replied</th><th class="num">Reply rate</th><th class="num">Positive</th><th class="num">Led to ${esc(mw.toLowerCase())}</th></tr>
    ${rows.map((r) => `<tr><td>${esc(nice(r.group))}</td><td class="num">${r.sent}</td><td class="num">${r.replied}</td><td class="num">${pct(r.replied, r.sent)}</td><td class="num">${r.positive}</td><td class="num">${r.meetings}</td></tr>`).join("")}</table></div>` : '<div class="empty">No sent messages logged yet.</div>'}</section>`;
  return `<div class="head"><div><h1>Analytics</h1><small>Counts from what you logged for this agent only. Groups with 3 or more contacted, your edits and messages that got positive replies are passed to Claude for future scoring and drafting.</small></div>${agentSeg(S.agent, "setagent")}</div>
  <div class="bento ${a.key}">${K(pct(m.replies, m.sent), `reply rate (${m.replies} of ${m.sent} sent)`)}${K(m.meetings, lit ? "meetings booked" : "interviews generated")}${K(m.won, lit ? "clients won" : "offers")}
    ${oppT(lit ? "Which buying signals generate responses?" : "Which hiring signals lead to conversations?", an.by_signal, "Signal")}
    ${oppT(lit ? "Which industries generate qualified leads?" : "Which industries offer the best opportunities?", an.by_industry, "Industry")}
    ${lit ? oppT("Which services attract interest?", an.by_service, "Service") : oppT("Which roles generate responses?", an.by_role, "Role family")}
    ${oppT(lit ? "Which company stages convert?" : "Which company stages are most compatible?", an.by_stage, "Company stage")}
    ${msgT(lit ? "Which outreach messages generate meetings?" : "Which outreach approaches generate interviews?", an.by_message_type, "Message type")}
    ${msgT(lit ? "Which angles work?" : "Which professional positioning works best?", an.by_angle, "Angle")}
    ${lit ? `<section class="card c12"><h2>Companies that became clients</h2>${an.clients.length ? an.clients.map((c) => `<span class="chip acc">${esc(c.company)}, ${esc(c.industry)}</span>`).join("") : '<span class="mute">None marked Won yet.</span>'}</section>` : ""}</div>`;
}

/* ------------------------------------------------------------ opportunity drawer */
function vDrawer(o, a) {
  const prov = o.signal ? o.signal.provenance : "user_provided", named = o.contacts.filter((c) => c.name), r = o.role || {};
  o.agentKey = a.key;
  return `<div class="sp"><div class="btns" style="flex-wrap:nowrap">${scoreDot(o.score)}<div><h1>${esc(o.company)}</h1><small>${esc(o.classification)}, ${esc(o.industry)}, ${esc(o.company_stage)}${safeUrl(o.company_url) ? ` <a href="${esc(o.company_url)}" target="_blank" rel="noopener">website</a>` : ""}</small></div></div><button class="btn" data-a="close">Close</button></div>
    ${o.conflict ? `<div class="banner bad" style="margin-top:12px">${esc(o.conflict)} ${o.conflict_ack ? "<b>You confirmed outreach from this agent.</b>" : `<button class="btn sm" data-a="ack">Approach as ${a.key === "lit" ? "Lit Collective" : "a career contact"}</button>`}</div>` : ""}
    <div class="card" style="margin-top:14px"><b>${esc(o.headline)}</b><p>${esc(o.summary)}</p><p><b>Next step.</b> ${esc(o.next_step || "—")}</p>
      <div class="form"><div><label>Pipeline stage</label><select data-change="stage">${a.stages.slice(1).map((s) => `<option ${s === o.stage ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
        <div><label>${a.key === "lit" ? "Meeting" : "Interview"} date</label><div class="btns" style="flex-wrap:nowrap"><input type="datetime-local" data-change="meeting" value="${esc(o.meeting_at || "")}">${o.meeting_at ? `<a class="btn sm" href="/api/${a.key}/opportunities/${o.id}/ics" download="${a.key}-${o.id}.ics">Add to calendar</a>` : ""}</div></div></div>
      <div class="btns" style="margin-top:10px"><button class="btn sm" data-a="research" ${S.status.claude ? "" : "disabled"} title="Uses Anthropic's web search; billed per search on your API account">Research on the public web</button>
        <button class="btn sm" data-a="park" data-v="${o.parked ? 0 : 1}">${o.parked ? "Move back to pipeline" : "Park as low priority"}</button>${o.researched ? '<span class="chip b-web">web-researched</span>' : ""}</div></div>
    ${a.key === "career" && r.title ? `<h3>Role</h3><div class="card"><div class="sp"><b>${esc(r.title)}</b>${o.signal && safeUrl(o.signal.url) ? `<a class="btn sm" href="${esc(o.signal.url)}" target="_blank" rel="noopener">Open posting</a>` : ""}</div>
      <div style="margin:6px 0"><span class="chip acc">${esc(r.category || "Other")}</span><span class="chip ${r.has_public_opening ? "" : "b-hyp"}">${r.has_public_opening ? "Public opening" : "No public vacancy (inferred need)"}</span><span class="chip ${r.remote === "Remote worldwide" ? "b-ok" : ""}">${esc(r.remote || "Unknown")}</span></div>
      <dl class="meta"><dt>Accepts Brazil?</dt><dd>${esc(r.brazil_evidence || "not stated")}</dd><dt>Level</dt><dd>${esc(r.level || "not stated")}</dd><dt>Salary</dt><dd>${esc(r.salary || "not stated")}</dd><dt>Published</dt><dd>${esc(r.published || "not stated")}</dd><dt>Why it fits</dt><dd>${esc(r.why_fit || "not stated")}</dd></dl>
      ${(r.highlights || []).length ? `<label>Highlight in your application</label>${r.highlights.map((h) => `<div class="fact">${esc(h)}</div>`).join("")}` : ""}</div>` : ""}
    ${a.key === "lit" && (o.services || []).length ? `<h3>Potential services</h3><div>${o.services.map((x) => `<span class="chip acc">${esc(x)}</span>`).join("")}</div>` : ""}
    <h3>Score: ${o.score} of 100</h3><div class="card">${(o.breakdown || []).map((b) => `<div class="bar-row"><span>${esc(b.label)}</span><div class="track"><i style="width:${b.max ? (100 * b.points) / b.max : 0}%"></i></div><b>${b.points}/${b.max}</b><div class="reason">${esc(b.reason)}</div></div>`).join("")}</div>
    <h3>${a.key === "lit" ? "Buying" : "Hiring"} signals</h3><div class="card">${(o.detected || []).map((x) => `<div class="fact"><span class="chip acc">${esc(nice(x.type))}</span>${badge(x.basis, prov)}<div>${esc(x.evidence)}</div></div>`).join("") || '<span class="mute">None recorded.</span>'}</div>
    <h3>What this is based on</h3><div class="card">${(o.facts || []).map((x) => `<div class="fact">${badge(x.basis, prov)} ${esc(x.statement)}</div>`).join("") || '<span class="mute">None recorded.</span>'}</div>
    <h3>Who to contact</h3><div class="card">
      ${o.contacts.map((c) => `<div class="fact"><div class="sp"><div><b>${esc(c.name || "To identify")}</b>, ${esc(c.title)} ${badge(c.basis, prov)}${c.connected ? '<span class="chip b-ok">already connected</span>' : ""}</div>
        <div class="btns"><a class="btn sm" target="_blank" rel="noopener" href="${esc(safeUrl(c.linkedin_url) || "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent((c.name || c.title) + " " + o.company))}">${safeUrl(c.linkedin_url) ? "Profile" : "Search on LinkedIn"}</a><button class="btn sm" data-a="delcontact" data-id="${c.id}">Remove</button></div></div><div class="mute">${esc(c.why)}</div></div>`).join("") || '<span class="mute">No contact yet.</span>'}
      <label style="margin-top:12px">Add the person you found on LinkedIn</label>
      <div class="form"><input id="n-name" placeholder="Name" aria-label="Name"><input id="n-title" placeholder="Title" aria-label="Title"><div class="full" style="margin-top:6px"><input id="n-url" placeholder="LinkedIn profile URL (optional)" aria-label="LinkedIn URL"></div></div>
      <button class="btn sm" style="margin-top:8px" data-a="addcontact">Add contact</button></div>
    <h3>Outreach</h3><div class="card"><div class="form"><div><label for="d-contact">To</label><select id="d-contact">${named.map((c) => `<option value="${c.id}">${esc(c.name)}, ${esc(c.title)}</option>`).join("") || "<option value=''>Add a named contact first</option>"}</select></div>
        <div><label for="d-type">Message</label><select id="d-type">${a.message_types.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join("")}</select></div></div>
      <button class="btn pri" style="margin-top:10px" data-a="draft" ${S.status.claude && named.length ? "" : "disabled"}>Draft with Claude</button></div>
    <div style="margin-top:12px">${o.messages.map((m) => msgCard(m, o)).join("")}</div>
    <h3>Notes</h3><textarea data-change="notes" placeholder="Your notes" aria-label="Notes">${esc(o.notes || "")}</textarea>
    <h3>Source signal</h3><div class="mute" style="margin-bottom:6px">${esc(o.signal ? o.signal.source_name : "")} ${badge(prov === "retrieved" ? "stated_in_source" : "user_provided", prov)} ${o.signal && safeUrl(o.signal.url) ? `<a href="${esc(o.signal.url)}" target="_blank" rel="noopener">open original</a>` : ""}</div>
    <div class="pre">${esc(o.signal ? o.signal.body : "")}</div>
    <h3>History</h3><div class="mute">${o.events.map((e) => `${when(e.at)}: ${esc(e.type)}${e.data && e.data.to ? " to " + esc(e.data.to) : ""}${e.data && e.data.reply ? " " + esc(e.data.reply) : ""}`).join("<br>")}</div>`;
}

/* ------------------------------------------------------------ settings */
function vSettings() {
  const st = S.status, s = st.settings, T = S.cfg.source_types;
  const stat = { available: ["Available", "b-ok"], manual: ["Manual import", "b-user"], unavailable: ["Not available", "b-bad"], not_needed: ["Not used", ""] };
  const yes = (v, y, n) => `<span class="chip ${v ? "b-ok" : "b-bad"}">${v ? y : n}</span>`;
  const scoring = (k) => { const a = C(k); return `<section class="card c6 ${k}"><div class="tile-top"><h2><span class="dot ${k}"></span>${esc(a.name)}: scoring</h2><button class="btn sm" data-a="resetw" data-agent="${k}">Reset weights</button></div>
    <p class="mute">Points per criterion. They must add up to 100. Applies to signals analyzed from now on.</p>
    <div class="weights">${a.criteria.map((c) => `<label for="w-${k}-${c.key}" style="margin:0;color:var(--ink)">${esc(c.label)}</label><input id="w-${k}-${c.key}" type="number" min="0" max="100" value="${c.max}" data-w="${k}">`).join("")}<b>Total</b><b id="wt-${k}" style="text-align:right;padding-right:10px">${a.criteria.reduce((t, c) => t + c.max, 0)}</b></div>
    <p class="mute" style="margin-top:10px">Bands: ${a.bands.map(([n, l]) => `${esc(l)} ${n}+`).join(", ")}.</p>
    <label for="g-${k}">Standing preferences for this agent (added to its instructions)</label><textarea id="g-${k}" rows="3" placeholder="${k === "lit" ? "e.g. Skip gambling projects. Favour teams of under 30 people." : "e.g. Minimum salary US$ 3,000/month. Not interested in pure cold-calling roles."}">${esc(a.guidance || "")}</textarea>
    <button class="btn pri" style="margin-top:10px" data-a="savescoring" data-agent="${k}">Save scoring</button></section>`; };
  const src = (k) => `<section class="card c12 ${k}"><div class="tile-top"><h2><span class="dot ${k}"></span>${esc(C(k).name)}: data sources</h2></div>
    <div style="overflow-x:auto"><table style="min-width:720px"><tr><th>Source</th><th>Keywords</th><th>Last run</th><th></th></tr>${S.d[k].sources.map((x) => `<tr><td><b>${esc(x.name)}</b><br><small>${esc(T[x.type].label)} ${esc(x.config.url || x.config.board || "")}</small></td>
      <td><small>${esc((x.config.keywords || []).join(", ") || "all items")}</small></td><td><small>${x.last_run_at ? when(x.last_run_at) + "<br>" + esc(x.last_status) : "never"}</small></td>
      <td><div class="btns" style="flex-wrap:nowrap"><button class="btn sm" data-a="srctoggle" data-agent="${k}" data-id="${x.id}" data-v="${x.enabled ? 0 : 1}">${x.enabled ? "On" : "Off"}</button><button class="btn sm" data-a="srctest" data-agent="${k}" data-id="${x.id}">Fetch</button><button class="btn sm danger" data-a="srcdel" data-agent="${k}" data-id="${x.id}">Delete</button></div></td></tr>`).join("")}</table></div>
    <h3>Add a source</h3><div class="form"><div><label for="s-type-${k}">Type</label><select id="s-type-${k}">${Object.entries(T).map(([t, v]) => `<option value="${t}">${esc(v.label)}</option>`).join("")}</select></div><div><label for="s-name-${k}">Name</label><input id="s-name-${k}" placeholder="e.g. Acme careers"></div>
      <div><label for="s-val-${k}">Feed URL or board slug</label><input id="s-val-${k}" placeholder="https://…/feed  or  acme"></div><div><label for="s-kw-${k}">Keywords, comma-separated (blank for everything)</label><input id="s-kw-${k}"></div></div>
    <button class="btn sm" style="margin-top:10px" data-a="srcadd" data-agent="${k}">Add source</button></section>`;
  return `<div class="head"><div><h1>Settings</h1><small>Claude, monitoring, scoring, data sources and what LinkedIn allows.</small></div></div>
  <div class="bento">
    <section class="card c6"><h2>Claude API</h2><p>${yes(st.claude, "API key set", "No API key")} <span class="mute">The key lives only in the host's environment variable <code>ANTHROPIC_API_KEY</code>. It is never stored in the database or shown here.</span></p>
      <div class="form"><div><label for="set-model">Model</label><input id="set-model" value="${esc(s.model)}"></div>
        <div><label for="set-web_research">Web research during analysis</label><select id="set-web_research"><option value="0" ${s.web_research === "0" ? "selected" : ""}>Off, source text only</option><option value="1" ${s.web_research === "1" ? "selected" : ""}>On, up to 3 searches per signal (billed)</option></select></div>
        <div><label for="set-analyze_per_run">Signals analyzed per run, per agent</label><input id="set-analyze_per_run" type="number" min="0" value="${esc(s.analyze_per_run)}"></div>
        <div><label for="set-daily_analysis_cap">Daily analysis cap, per agent</label><input id="set-daily_analysis_cap" type="number" min="0" value="${esc(s.daily_analysis_cap)}"></div></div></section>
    <section class="card c6"><h2>Monitoring and platform</h2>
      <div class="form"><div><label for="set-scheduler_enabled">Automatic monitoring</label><select id="set-scheduler_enabled"><option value="1" ${s.scheduler_enabled === "1" ? "selected" : ""}>On</option><option value="0" ${s.scheduler_enabled === "0" ? "selected" : ""}>Off</option></select></div>
        <div><label for="set-interval_hours">Every (hours)</label><input id="set-interval_hours" type="number" min="1" value="${esc(s.interval_hours)}"></div></div>
      <button class="btn pri" style="margin-top:12px" data-a="savesettings">Save settings</button>
      <dl class="meta" style="margin-top:14px"><dt>Database</dt><dd>${st.database === "postgres" ? "Cloud Postgres, one schema per agent" : "Local SQLite, one file per agent"}</dd><dt>Sign-in</dt><dd>${st.login ? "Password required" : "Off (local mode)"}</dd>
        <dt>Background runs</dt><dd>${st.cron ? "External scheduler token set: runs continue while the app is closed" : "No external scheduler: runs only while the server is awake"}</dd><dt>LinkedIn sending</dt><dd>Manual only</dd></dl></section>
    ${scoring("lit")}${scoring("career")}${src("lit")}${src("career")}
    <section class="card c12"><h2>LinkedIn data access</h2><p class="mute">What LinkedIn officially allows for a personal tool, and how each case is handled here. No scraping, session cookies or browser automation.</p>
      <div style="overflow-x:auto"><table style="min-width:760px"><tr><th>Capability</th><th>Status</th><th>Why</th><th>How it works here</th></tr>${S.cfg.linkedin_access.map((x) => `<tr><td><b>${esc(x.capability)}</b></td><td><span class="chip ${stat[x.status][1]}">${stat[x.status][0]}</span></td><td>${esc(x.detail)}</td><td>${esc(x.workflow)}</td></tr>`).join("")}</table></div>
      <h3>Import your connections</h3><p class="mute">${st.connections} imported. On LinkedIn: Settings, Data privacy, Get a copy of your data, Connections. Then choose <code>Connections.csv</code>. It is only used to flag people you already know.</p>
      <input type="file" id="net-file" accept=".csv" style="max-width:340px" aria-label="Connections.csv"></section>
    <section class="card c12" style="padding:0;overflow:hidden"><h2 style="padding:14px 16px 0">Recent monitoring runs</h2>${st.last_runs.length ? `<div style="overflow-x:auto"><table><tr><th>When</th><th>Agent</th><th>Trigger</th><th class="num">Fetched</th><th class="num">New</th><th class="num">Analyzed</th></tr>${st.last_runs.map((r) => `<tr><td>${when(r.started_at)}</td><td>${esc(r.agent)}</td><td>${esc(r.trigger)}</td><td class="num">${r.fetched}</td><td class="num">${r.new_signals}</td><td class="num">${r.analyzed}</td></tr>${r.errors ? `<tr><td colspan="6" style="color:var(--bad)"><small>${esc(r.errors)}</small></td></tr>` : ""}`).join("")}</table></div>` : '<div class="empty">No runs yet.</div>'}</section>
  </div>`;
}

/* ------------------------------------------------------------ actions */
const val = (id) => ($("#" + id) ? $("#" + id).value.trim() : "");
const ag = (el) => el.dataset.agent || el.closest("[data-agent]")?.dataset.agent || S.agent;
const findMsg = (el) => { const k = ag(el), id = +el.dataset.id; return (el.closest("#drawer") ? S.opp.messages : S.d[k].msgs).find((x) => x.id === id); };
const dpath = () => `/${S.drawer.agent}/opportunities/${S.drawer.id}`;
const A = {
  page: (el) => { S.page = el.dataset.v; if (el.dataset.agent) S.agent = el.dataset.agent; S.tab = el.dataset.tab || "list"; window.scrollTo(0, 0); reload(); },
  tab: (el) => { S.tab = el.dataset.v; reload(); },
  setagent: (el) => { S.agent = el.dataset.v; reload(); },
  inboxtab: (el) => { S.page = "inbox"; S.inboxTab = el.dataset.v; render(); },
  inboxagent: (el) => { S.inboxAgent = el.dataset.v; render(); },
  parkedf: (el) => { S.f.parked = !!el.dataset.v; render(); },
  irr: () => { S.showIrrelevant = !S.showIrrelevant; reload(); },
  open: (el) => { S.drawer = { agent: el.dataset.agent, id: +el.dataset.id }; reload(); },
  close: () => { S.drawer = null; S.opp = null; render(); },
  logout: () => api("POST", "/logout").then(() => showLogin()),
  run: (el) => busy(el, async () => { await api("POST", `/${ag(el)}/run`); toast("Monitoring run started"); setTimeout(reload, 1500); }),
  runall: (el) => busy(el, async () => { for (const k of AG) await api("POST", `/${k}/run`); toast("Monitoring run started for both agents"); setTimeout(reload, 1500); }),
  capture: (el) => busy(el, async () => {
    const r = await api("POST", `/${S.agent}/signals`, { kind: val("c-kind"), url: val("c-url"), author: val("c-author"), author_title: val("c-atitle"), company: val("c-company"), body: val("c-body"), title: val("c-company") || val("c-author"), analyze: !!el.dataset.analyze });
    if (r.result && r.result.relevant) { S.drawer = { agent: S.agent, id: r.result.opportunity_id }; toast("Analyzed: score " + r.result.score); }
    else toast(r.result ? "Judged not relevant: " + (r.result.reason || "") : "Captured");
    await load();
  }),
  analyze: (el) => busy(el, async () => { const r = await api("POST", `/${S.agent}/signals/${el.dataset.id}/analyze`); toast(r.relevant ? "Analyzed: score " + r.score : "Judged not relevant"); await load(); }),
  dismiss: (el) => busy(el, async () => { await api("POST", `/${S.agent}/signals/${el.dataset.id}/dismiss`); await load(); }),
  dismissall: (el) => confirm("Dismiss every signal waiting for this agent?") && busy(el, async () => { await api("POST", `/${S.agent}/signals/dismiss_all`); await load(); }),
  ack: (el) => busy(el, async () => { await api("PATCH", dpath(), { conflict_ack: 1 }); await load(); }),
  park: (el) => busy(el, async () => { await api("PATCH", dpath(), { parked: +el.dataset.v }); await load(); }),
  research: (el) => busy(el, async () => { await api("POST", dpath() + "/research"); toast("Re-assessed with web research"); await load(); }),
  addcontact: (el) => busy(el, async () => { await api("POST", dpath() + "/contacts", { name: val("n-name"), title: val("n-title"), linkedin_url: val("n-url") }); await load(); }),
  delcontact: (el) => busy(el, async () => { await api("DELETE", `/${S.drawer.agent}/contacts/${el.dataset.id}`); await load(); }),
  draft: (el) => busy(el, async () => { await api("POST", dpath() + "/draft", { contact_id: +val("d-contact"), type: val("d-type") }); toast("Draft ready for review"); await load(); }),
  mact: (el) => busy(el, async () => {
    const k = ag(el), id = el.dataset.id, act = el.dataset.act, ta = $(`#mt-${k}-${id}`);
    if (["approve", "edit", "save"].includes(act) && ta && !ta.readOnly) await api("POST", `/${k}/messages/${id}`, { action: "edit", text: ta.value });
    if (act !== "edit") await api("POST", `/${k}/messages/${id}`, { action: act, reply: el.dataset.reply });
    toast({ approve: "Approved. Copy it and send it on LinkedIn.", sent: "Marked as sent", edit: "Edit saved", reply: "Reply logged", reject: "Rejected", save: "Saved for later" }[act] || "Done"); await load();
  }),
  usealt: (el) => { const m = findMsg(el), ta = $(`#mt-${ag(el)}-${m.id}`); ta.value = m.alternative; ta.dispatchEvent(new Event("input", { bubbles: true })); },
  copy: (el) => navigator.clipboard.writeText($(`#mt-${ag(el)}-${el.dataset.id}`).value).then(() => toast("Copied"), () => toast("Copy failed. Select the text manually.", true)),
  copyfu: (el) => navigator.clipboard.writeText(findMsg(el).follow_up).then(() => toast("Follow-up copied"), () => toast("Copy failed", true)),
  savesettings: (el) => busy(el, async () => { const b = {}; ["model", "web_research", "analyze_per_run", "daily_analysis_cap", "scheduler_enabled", "interval_hours"].forEach((k) => (b[k] = val("set-" + k))); await api("POST", "/settings", b); toast("Settings saved"); await load(); }),
  savescoring: (el) => busy(el, async () => { const k = el.dataset.agent, weights = {}; C(k).criteria.forEach((c) => (weights[c.key] = +val(`w-${k}-${c.key}`))); await api("POST", `/${k}/scoring`, { weights, guidance: val("g-" + k) }); toast("Scoring saved"); await load(); }),
  resetw: (el) => { const k = el.dataset.agent; C(k).default_criteria.forEach((c) => ($(`#w-${k}-${c.key}`).value = c.max)); $("#wt-" + k).textContent = 100; },
  srctoggle: (el) => busy(el, async () => { await api("PATCH", `/${el.dataset.agent}/sources/${el.dataset.id}`, { enabled: +el.dataset.v }); await load(); }),
  srcdel: (el) => confirm("Delete this source?") && busy(el, async () => { await api("DELETE", `/${el.dataset.agent}/sources/${el.dataset.id}`); await load(); }),
  srctest: (el) => busy(el, async () => { await api("POST", `/${el.dataset.agent}/run`, { source: +el.dataset.id }); await new Promise((r) => setTimeout(r, 4000)); await load(); }),
  srcadd: (el) => busy(el, async () => {
    const k = el.dataset.agent, type = val("s-type-" + k), v = val("s-val-" + k), cfg = { keywords: val("s-kw-" + k).split(",") };
    if (T(type).field) { if (!v) throw new Error("Enter the feed URL or board slug"); cfg[T(type).field] = v; }
    await api("POST", `/${k}/sources`, { type, name: val("s-name-" + k) || v || type, config: cfg }); await load();
  }),
};
const T = (t) => S.cfg.source_types[t];
document.addEventListener("click", (e) => {
  if (e.target.id === "drawer") return A.close();
  const el = e.target.closest("[data-a]"); if (!el || el.disabled) return;
  if (e.target.closest("a[href]:not([data-a])")) return;
  if (el.tagName === "A") e.preventDefault();
  const inner = e.target.closest("button,a,input,select,textarea"); if (inner && inner !== el && el.contains(inner)) return;
  A[el.dataset.a](el);
});
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "login") return; e.preventDefault();
  try { await api("POST", "/login", { password: $("#pw").value }); location.reload(); } catch (err) { $("#lerr").textContent = err.message; }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.count) { const c = t.nextElementSibling, max = +t.dataset.max; c.textContent = t.value.length + " / " + max; c.classList.toggle("over", t.value.length > max); }
  if (t.dataset.w) { const k = t.dataset.w, sum = C(k).criteria.reduce((s, c) => s + (+$(`#w-${k}-${c.key}`).value || 0), 0), o = $("#wt-" + k); o.textContent = sum; o.style.color = sum === 100 ? "" : "var(--bad)"; }
  if (t.dataset.f === "q") { S.f.q = t.value; const pos = t.selectionStart; render(); const n = $('[data-f="q"]'); n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  try {
    if (t.dataset.f && t.dataset.f !== "q") { S.f[t.dataset.f] = t.value; return render(); }
    if (t.id === "net-file" && t.files[0]) { const r = await api("POST", "/network/import", { csv: await t.files[0].text() }); toast(r.imported + " connections imported"); return reload(); }
    if (!t.dataset.change || !S.drawer) return;
    const body = t.dataset.change === "stage" ? { stage: t.value } : t.dataset.change === "meeting" ? { meeting_at: t.value } : { notes: t.value };
    await api("PATCH", dpath(), body); toast("Saved"); reload();
  } catch (err) { toast(err.message, true); }
});
document.addEventListener("dragstart", (e) => { const c = e.target.closest("[data-drag]"); if (c) e.dataTransfer.setData("text/plain", c.dataset.drag); });
document.addEventListener("dragover", (e) => { const c = e.target.closest(".col"); if (c && !c.dataset.intake) { e.preventDefault(); c.classList.add("over"); } });
document.addEventListener("dragleave", (e) => { const c = e.target.closest(".col"); if (c) c.classList.remove("over"); });
document.addEventListener("drop", async (e) => {
  const c = e.target.closest(".col"), id = e.dataTransfer.getData("text/plain"); if (!c || !id || c.dataset.intake) return; e.preventDefault();
  try { await api("PATCH", `/${S.agent}/opportunities/${id}`, { stage: c.dataset.stage }); } catch (err) { toast(err.message, true); } reload();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.drawer) A.close(); });

(async () => {
  try {
    const s = await api("GET", "/session");
    if (!s.authenticated) return showLogin();
    S.cfg = await api("GET", "/config"); await load();
  } catch (e) { if (!$("#login")) $("#main").innerHTML = "<p style='padding:30px'>Could not load: " + esc(e.message) + "</p>"; }
  setInterval(async () => { // keep the monitoring indicator current without redrawing forms being typed in
    if ($("#login")) return;
    try { const st = await api("GET", "/status"); const was = S.status.running.length; S.status = st; if (was && !st.running.length) reload(); } catch (e) { /* offline */ }
  }, 10000);
})();
