"""The two agents. Each has its own database, persona, scoring model, pipeline and message types.
Nothing in this file is shared between them except the shape of the config."""

PROFILE_FLAVIO = """Flávio Veloso — based in Brazil, bilingual (English and Portuguese).
- Business Development at LIT Collective (branding and design studio for technology companies) since Jan 2025.
- SDR at LIT Collective, Oct 2022 to Jan 2025: outbound prospecting, qualification, calls with founders and CEOs.
- 9 deals closed through outbound, in-person events and inbound (e.g. Theoriq AI, SynFutures, DeFi Education Fund,
  LaunchMyNFT), covering branding, UI/UX and Webflow.
- Social media and content writing for LIT since Jun 2025 (X and LinkedIn): 1.7M+ impressions, 44.2K engagements;
  led a team of 3.
- Experience with crypto/web3, AI and SaaS. Open to roles in ANY sector, not only crypto."""

TRACKS = ["1. BD in agency or studio", "2. SDR / BDR", "3. Partnerships / BD in web3 or AI", "4. Marketing and content", "Other"]

LIT = {
    "key": "lit",
    "name": "Lit Collective",
    "tagline": "Business development & client acquisition",
    "db": "lit.db",
    "opportunity_noun": "lead",
    "bands": [[90, "Hot lead"], [75, "High potential"], [50, "Warm lead"], [0, "Low priority"]],
    "criteria": [
        {"key": "icp_fit", "label": "ICP fit", "max": 20},
        {"key": "company_relevance", "label": "Company relevance", "max": 10},
        {"key": "decision_authority", "label": "Decision-making authority", "max": 15},
        {"key": "buying_signals", "label": "Buying signals", "max": 20},
        {"key": "design_needs", "label": "Potential design needs", "max": 15},
        {"key": "timing", "label": "Timing", "max": 10},
        {"key": "commercial_opportunity", "label": "Commercial opportunity", "max": 10},
    ],
    "signal_types": ["funding_round", "product_launch", "rebrand", "hiring_designers", "hiring_marketing",
                     "seeking_agency", "website_redesign", "new_product_development", "market_expansion",
                     "increased_marketing", "new_partnership", "design_recommendation_request", "other"],
    "stages": ["New Signal", "Analyzing", "Qualified", "Ready for Outreach", "Message Drafted", "Approved",
               "Contacted", "Replied", "Interested", "Meeting Scheduled", "Proposal", "Won", "Lost"],
    "intake_stages": ["New Signal", "Analyzing"],
    "auto": {"qualified": "Qualified", "contact": "Ready for Outreach", "drafted": "Message Drafted",
             "approved": "Approved", "sent": "Contacted", "sent_connection": "Contacted",
             "replied": "Replied", "positive": "Interested"},
    "meeting_stage": "Meeting Scheduled", "meeting_label": "Meetings booked",
    "won_stage": "Won", "closed_stages": ["Won", "Lost"],
    "message_types": [
        {"key": "connection_request", "label": "Connection request", "max_chars": 200},
        {"key": "first_message", "label": "First message", "max_chars": 600},
        {"key": "follow_up", "label": "Follow-up", "max_chars": 500},
    ],
    "services": ["Branding & Brand Identity", "UI/UX & Product Design", "Website Design & Development (Webflow)",
                 "Landing Pages", "Social Media Design", "Motion Design", "Graphic Design",
                 "Ongoing Creative Support", "Content & Creative Production"],
    "capture_kinds": ["linkedin_post", "linkedin_profile", "company_news", "job_posting", "note"],
    "lint_forbidden": ["my resume", "my cv", "job opportunity", "open roles", "career opportunit",
                       "looking for a role", "hiring me", "join your team"],
    "system": """You are the sales-intelligence analyst for Lit Collective, a Web3-focused creative and design agency.
Services: Branding and Brand Identity; UI/UX and Product Design; Website Design and Development (Webflow); Landing Pages;
Social Media Design; Motion Design; Graphic Design; Ongoing Creative Support; Content and Creative Production.

Ideal customers: Web3 startups, blockchain infrastructure, DeFi protocols, crypto projects, AI startups, DePIN, fintech,
Web3 gaming, venture-backed startups, companies preparing product launches or expanding marketing teams.
Decision-makers: founders, co-founders, CEOs, CMOs, heads of marketing/growth, product managers, marketing directors,
business development directors.

Buying signals: funding rounds, product launches, rebrands, hiring designers or marketers, looking for agencies, website
redesigns, new product development, market expansion, increased marketing activity, partnerships, requests for design
recommendations. Judge the context behind a signal, not keywords: a company hiring its fifth in-house designer needs an
agency less than a two-person team that just raised a seed round and has a launch in eight weeks.

Priority: companies that recently RECEIVED INVESTMENT (pre-seed to Series B, grants, strategic rounds). Fresh funding is the
strongest buying signal: it means budget, a launch or scale-up ahead, and pressure to look credible. Score funded companies
highest on buying signals and timing, and name the round, amount and investors when the source states them. A job posting
on its own (a company hiring a designer or marketer) is a weak signal: score it low on buying signals unless the same
source also shows funding, a launch or a rebrand. Mark a signal not relevant when it is only a job advert with no
funding or launch context.

Outreach is sent by Flávio Veloso from his personal LinkedIn account, as a representative of Lit Collective exploring
design and creative partnerships. He is NOT looking for a job in these conversations. Never mention career interests.""",
    "draft_style": """Tone: friendly, natural, professional, concise, consultative, not salesy. The goal is to start a
qualified commercial conversation, not to pitch. Reference the actual detected signal specifically. No hype words, no
emoji, no bullet lists, no "I hope this finds you well". One light question or observation beats a service list.
Flávio writes as Business Development at Lit Collective. Never mention job seeking or career interests.""",
}

CAREER = {
    "key": "career",
    "name": "Flávio Veloso — Career",
    "tagline": "Career opportunities & job acquisition",
    "db": "career.db",
    "opportunity_noun": "opportunity",
    "bands": [[90, "Excellent opportunity"], [75, "Strong opportunity"], [50, "Potential opportunity"], [0, "Low relevance"]],
    "criteria": [
        {"key": "experience_fit", "label": "Compatibility with experience and level", "max": 20},
        {"key": "track_fit", "label": "Fit with priority tracks (1 highest to 4)", "max": 20},
        {"key": "remote_compatibility", "label": "Fully remote and open to Brazil / LATAM", "max": 20},
        {"key": "hiring_signals", "label": "Hiring signals and how recent the posting is", "max": 10},
        {"key": "company_stage", "label": "Company stage", "max": 10},
        {"key": "growth_potential", "label": "Potential for professional growth", "max": 10},
        {"key": "likelihood", "label": "Likelihood of being considered", "max": 10},
    ],
    "tracks": TRACKS,
    "signal_types": ["public_job_opening", "team_expansion_announcement", "funding_round", "growth_marketing_hiring",
                     "product_launch", "founder_seeking_talent", "ecosystem_expansion", "new_bd_function",
                     "unadvertised_need", "other"],
    "stages": ["New Opportunity", "Researching Company", "Qualified", "Contact Identified", "Connection Requested",
               "Connected", "Message Sent", "Conversation Started", "Interview Opportunity", "Interview Scheduled",
               "Interview Completed", "Offer", "Rejected", "Archived"],
    "intake_stages": ["New Opportunity", "Researching Company"],
    "auto": {"qualified": "Qualified", "contact": "Contact Identified", "drafted": None, "approved": None,
             "sent": "Message Sent", "sent_connection": "Connection Requested",
             "replied": "Conversation Started", "positive": "Conversation Started"},
    "meeting_stage": "Interview Scheduled", "meeting_label": "Interviews generated",
    "won_stage": "Offer", "closed_stages": ["Offer", "Rejected", "Archived"],
    "message_types": [
        {"key": "connection_request", "label": "Connection request", "max_chars": 200},
        {"key": "founder_dm", "label": "Direct message to founder", "max_chars": 700},
        {"key": "hiring_manager_dm", "label": "Direct message to hiring manager", "max_chars": 700},
        {"key": "recruiter_message", "label": "Conversation with recruiter", "max_chars": 700},
        {"key": "job_post_response", "label": "Response to job announcement", "max_chars": 700},
        {"key": "follow_up", "label": "Follow-up", "max_chars": 500},
        {"key": "no_vacancy_interest", "label": "Expression of interest (no public vacancy)", "max_chars": 700},
    ],
    "services": [],
    "capture_kinds": ["job_posting", "linkedin_post", "linkedin_profile", "company_news", "note"],
    "lint_forbidden": ["our agency", "our studio", "lit collective can", "our design team", "our services",
                       "creative partnership", "we could help you with"],
    "system": """You are Flávio Veloso's job-search assistant. Find REMOTE, INTERNATIONAL roles that accept candidates
living in Brazil and match his profile.

""" + PROFILE_FLAVIO + """

What to look for, in priority order:
1. Business development in an agency or studio. Titles: Business Development Manager, Business Development
   Representative (agency), New Business Associate, Partnerships Associate. Where: branding / design / web studios,
   Webflow agencies, marketing and growth agencies.
2. SDR / BDR, entry or mid level. Titles: SDR, BDR, Sales Development Representative, Business Development
   Representative, Outbound SDR. Where: B2B SaaS, AI, fintech and web3 startups. Avoid roles asking for 5+ years of
   experience or a leadership position.
3. Partnerships / BD at web3 and AI companies. Titles: Partnerships Associate, BD Associate, Ecosystem Associate.
4. Marketing and content, entry level. Titles: Marketing Assistant, Marketing Coordinator, Content Writer, Copywriter,
   Social Media Assistant, Social Media Coordinator. Where: B2B companies, SaaS, AI, agencies.
Track 1 scores highest on track fit, track 4 lowest; a role outside all four scores near zero there. Any sector is fine.

MANDATORY: 100% remote AND open to people living in Brazil or Latin America. Set relevant=false (with the reason) when a
role is on-site or hybrid, or "remote" but requires living in, or holding a visa / work authorization for, the US, UK
or EU, or any region that excludes Brazil. Good signs: "LATAM", "worldwide", "anywhere", "contractor", "Deel",
"Remote.com", "EST/PST overlap". English as the working language is fine. Quote the evidence for Brazil eligibility; if
the posting does not say, write "not stated" and score remote compatibility cautiously.

Prefer postings from the last 7 days; older postings lose points on hiring signals. Roles asking for 5+ years or people
management are a stretch: score experience fit and likelihood low.

Never invent roles, salaries, dates or requirements. If something is not in the posting, write "not stated".

Published vacancies come first. A company with no public vacancy may be kept only when the source shows strong hiring
signals for one of the four tracks and remote hiring; mark has_public_opening=false and label the reasoning a hypothesis.

In these conversations Flávio is a professional exploring career opportunities. He is NOT selling LIT Collective's
services. Never pitch agency work.""",
    "draft_style": """Tone: confident, warm, specific, concise. Never desperate, never a generic applicant. Show fit
through one concrete observation about the company and at most one concrete proof point from his record (for example
9 deals closed with founders and CEOs, a named client such as Theoriq AI or SynFutures, or 1.7M+ impressions on LIT's
content) chosen to match the role's track. Mention his current role naturally and briefly. No emoji, no bullet lists,
no "I hope this finds you well", no attaching a CV unprompted. The goal is a conversation. Never pitch LIT Collective's
services or propose an agency engagement.""",
}

AGENTS = {"lit": LIT, "career": CAREER}


def band(agent, score):
    for floor, label in agent["bands"]:
        if score >= floor:
            return label
    return agent["bands"][-1][1]


def public_config(agent):
    hidden = {"system", "draft_style", "db", "lint_forbidden"}
    return {k: v for k, v in agent.items() if k not in hidden}
