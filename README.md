# LinkedIn Agents

One local platform, two separate agents that work through Flávio Veloso's LinkedIn presence:

- **Agent 01 — Lit Collective**: finds companies showing buying signals for design, branding, product design, web and creative support.
- **Agent 02 — Flávio Veloso, Career**: finds roles and companies (including ones with no public vacancy) that fit his growth / BD / marketing / Web3 direction.

Claude scores every signal against the agent's own rubric, explains each score, proposes who to contact and drafts the outreach. You approve every message and send it yourself.

## Run it

**In the cloud (recommended):** follow `DEPLOY.md`. You get a private URL with password sign-in, a Postgres database (one schema per agent) and monitoring that runs while the app is closed.

**Locally:** Python 3.9+, copy `.env.example` to `.env`, add the Anthropic key, run `python app.py` (or `start.bat`), open http://127.0.0.1:8765. Local mode uses SQLite files in `data/` and has no sign-in because it only listens on localhost.

## Pages

Dashboard, Inbox (both agents' new leads and drafted messages), Lit Collective, Career, Pipelines, Analytics, Settings (Claude, monitoring, scoring weights and standing preferences per agent, data sources, LinkedIn access).

## What it does and does not do with LinkedIn

LinkedIn gives individual developers no API for reading other members' profiles or posts, searching people, or sending invitations and messages, and its User Agreement prohibits scraping and automated activity. So this platform never logs in to LinkedIn, never uses your session and never sends anything.

| Need | How it is handled |
|---|---|
| LinkedIn posts, profiles, job posts you see | Paste the text into the agent's **Inbox → Capture** (labelled *User-provided*) |
| Job openings and funding / launch news | Fetched on a schedule from public job-board APIs and RSS feeds (labelled *Retrieved data*) |
| Company background | Optional Claude web search over public pages (labelled *Public information*; off by default, billed per search by Anthropic) |
| Anything Claude infers | Labelled *AI hypothesis*; drafts are told not to state hypotheses as fact |
| Finding the right person | Claude names the role; the "Search on LinkedIn" link opens a normal LinkedIn search for you to run; you add the contact |
| Sending | Approve → Copy → send on LinkedIn → "mark as sent" |
| Replies | You log them (positive / neutral / negative) |
| Your connections | Import `Connections.csv` from LinkedIn's own data export; known contacts are flagged |

If LinkedIn ever grants you partner API access, the send step is a single function to add in `core/engine.py` (`message_action`, the `sent` branch).

## Keeping the two agents apart

- Separate database file, persona, scoring rubric, pipeline stages, message types and analytics per agent.
- If the same company or person shows up in both pipelines, both records are flagged and approval is blocked until you confirm which identity makes the approach.
- Drafts are checked for wording from the other identity (a job-seeking phrase in a Lit message, an agency pitch in a career message).

## Scheduled monitoring

Enabled sources are fetched every 6 hours (configurable) and the newest signals are analyzed up to a per-run and per-day cap, so API spend stays bounded. In the cloud a GitHub Actions schedule wakes the app for each run; locally it runs only while the app is open. Add company job boards (Greenhouse, Lever, Ashby) or any RSS feed under **Sources & setup**.

## Tests

`python tests/run_tests.py` runs the whole flow (both agents, login, cron, scoring) against a mock Claude API and a mock feed. Set `DATABASE_URL` to run the same suite on Postgres.

## Known limits

- The default feed URLs and job-board endpoints could not be called from the build environment. Use **Fetch now** on each source; a failing source shows its error and can be edited or deleted.
- The Claude integration was verified against a mock of the Messages API, not with a live key. If your account uses a different model name, change it under **Sources & setup**.
- Calendar: meetings and interviews export as `.ics` files; there is no live calendar sync.
