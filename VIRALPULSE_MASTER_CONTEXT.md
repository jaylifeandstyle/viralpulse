# VIRALPULSE MASTER CONTEXT

## Core Objective
Build a practical, low-cost AI-powered X (Twitter) growth app for journalists and creators. The main goal is to help users grow their accounts by finding newsworthy stories early and generating ready-to-post, journalist-style content.

Key success metric: Real follower growth through high-quality, timely posts.

## Non-Negotiable Constraints
- Cost must be viable: Target $10–25/month per user maximum (including X API + Claude + hosting).
- Strictly follow X TOS — no scraping, no spam, no manipulation.
- Respect the Galaxy architecture: Central Brain routes to self-contained Galaxies. Each Galaxy is a different strategy/world.
- Prefer real data over fake simulation for final versions.
- Journalist tone: Analytical, "what this actually means", contrarian when appropriate, factual, not clickbait.

## Current Architecture (Respect This)
- src/brain/ → Orchestrator (routes to active Galaxy)
- src/galaxies/galaxy.0X/ → Self-contained strategies (prompts.ts + index.ts)
- Dashboard (Next.js) with Simulate, Force Poll, Pull X Trends
- Shared store for opportunities
- TESTING_MODE flag for aggressive testing

## User Preferences & Vision
- Broad news coverage: Politics, tech, business, sports, entertainment, geopolitics, celebrity, science, etc. Anything newsworthy.
- Full ready-to-post output: Complete tweet + image search query + reasoning.
- User can choose "Pure Growth" mode (do whatever works) or niche mode.
- The system should evolve Galaxies autonomously based on performance.
- Make it easy to test and iterate.

## Current State (as of June 17, 2026)
- Galaxy.03 exists with Trends + Google News RSS.
- Testing mode is active but still produces too many cautious drafts.
- Cost awareness is important — always log estimated spend.

## How the Agent Should Work
- Think strategically about low-cost news sources.
- Propose new Galaxies with different approaches.
- Implement, test safely, and report real costs.
- Iterate based on feedback.
- Always respect the Galaxy architecture and cost limits.

This document is the permanent source of truth. Use it for all decisions.