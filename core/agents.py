"""The two agents. Each has its own database, persona, scoring model, pipeline and message types.
Nothing in this file is shared between them except the shape of the config."""

PROFILE_FLAVIO = """Flávio Veloso — Business Development and Sales at Lit Collective (a Web3-focused creative and design agency).
Experience: Web3 and crypto markets; identifying and qualifying B2B opportunities; outbound prospecting and lead
generation; relationship building with founders and decision-makers; sales pipeline management; proposal development
and commercial strategy; international clients; exposure to branding, creative services, marketing and growth;
developing commercial strategy for a Web3 design agency."""

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
        {"key": "experience_fit", "label": "Compatibility with experience", "max": 20},
        {"key": "career_goals", "label": "Relevance to career goals", "max": 15},
        {"key": "company_stage", "label": "Company stage", "max": 10},
        {"key": "web3_relevance", "label": "Web3 relevance", "max": 10},
        {"key": "remote_compatibility", "label": "Remote compatibility", "max": 15},
        {"key": "hiring_signals", "label": "Hiring signals", "max": 10},
        {"key": "growth_potential", "label": "Potential for professional growth", "max": 10},
        {"key": "likelihood", "label": "Likelihood of being considered", "max": 10},
    ],
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
    "system": """You are the career strategist for Flávio Veloso.

""" + PROFILE_FLAVIO + """

He wants to grow beyond traditional SDR responsibilities. Target directions (not an exhaustive title list — find adjacent
roles where his experience is relevant):
1. Growth: associate, manager, growth marketing, growth operations, strategist.
2. Business development: BD manager/associate, partnerships, strategic partnerships, BDR, account executive.
3. Marketing: associate, strategist, Web3 marketing, go-to-market, marketing operations, content and growth strategy.
4. Web3 ecosystem: ecosystem growth/partnerships, community growth, startup partnerships, venture ecosystem roles.
5. Creative and agency growth: agency growth, client partnerships, account management, creative business development.
Best fit combines commercial strategy, growth, marketing and Web3.

Target companies: Web3 startups, blockchain and crypto infrastructure, DeFi, AI startups, DePIN, fintech, venture-backed
tech, Web3 VCs, creative and marketing agencies, international startups. He is based in Brazil and needs remote roles
from companies that hire internationally, especially US and Europe based. A role restricted to US/EU residents or
requiring on-site presence scores low on remote compatibility however good the rest is.

Also recognise unadvertised opportunities: e.g. a startup that just raised, is expanding its ecosystem and hiring
marketers may need growth, partnerships or BD capacity even with no posted vacancy. Mark that reasoning as a hypothesis.

Be honest on likelihood: his background is BD/sales at an agency; senior or deeply technical roles are a stretch.
In these conversations Flávio is a professional exploring career opportunities. He is NOT selling Lit Collective's
services. Never pitch agency work.""",
    "draft_style": """Tone: confident, warm, specific, concise. Never desperate, never a generic applicant. Position
Flávio as someone who understands Web3, commercial strategy, growth and relationship building, and show it through one
concrete observation about the company rather than adjectives about himself. Mention his current role naturally and
briefly. No emoji, no bullet lists, no "I hope this finds you well", no attaching a CV unprompted. The goal is a
conversation. Never pitch Lit Collective's services or propose an agency engagement.""",
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
