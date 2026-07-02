/**
 * src/lib/growth/propose-targets.ts
 *
 * Takes an OwnerSignal, hands it to Claude Sonnet with G3-specific
 * instructions, and gets back 30–50 ranked target accounts with a
 * one-line reason each.
 *
 * Model choice — Sonnet, not Haiku. This is a one-time analysis where
 * quality of ranking matters much more than latency. Sonnet reasons
 * better about "which of these audiences would follow @owner if they
 * saw a good reply from them."
 *
 * The system prompt encodes what actually drives follower conversion on
 * X for the reply-guy strategy: medium-follower accounts (5k–200k) with
 * active engagement, in the owner's conversational lane, whose audiences
 * are the right shape.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { OwnerSignal } from './fetch-owner-signal';

export type ProposedTarget = {
  handle: string;      // no '@', lowercase
  reason: string;      // one-line justification
};

const SYSTEM_PROMPT = `
You are a growth strategist for X (Twitter). Your job is to propose accounts
whose audiences are most likely to convert into followers for the OWNER
account, based on the owner's own activity signal.

The owner uses a reply-guy growth strategy: they will post sharp replies
and quote-tweets on the proposed targets' tweets. Good targets are:

- ACTIVE: post regularly (not dormant)
- RIGHT-SIZED: roughly 5k–200k followers. Smaller = no reach. Larger = your
  reply drowns in noise, no follower conversion.
- IN LANE: their conversational territory overlaps with the owner's
  interests and past posts.
- REPLY-FRIENDLY: their audience actually reads and engages with replies
  (not just broadcast accounts like brand handles or celebrities).
- SAFE: no politically incendiary, controversy-farming, or grift accounts.

You will see:
- The owner's recent tweet samples (their voice, their topics)
- Handles they mention/reply to most
- Handles they follow
- Their bookmarks (tightest interest signal)
- Handles of accounts they like

Output STRICT JSON only, no prose, no code fences:
{"targets":[{"handle":"someone","reason":"one line, ≤ 100 chars"},...]}

Rules for output:
- 30 to 50 targets, ranked best first.
- Never propose the owner's own handle.
- Prefer handles that show up in the signal, but you may add strong
  lookalikes based on lane overlap.
- Handles are lowercase, no '@' prefix.
- If a signal slice is weak or empty, adapt — don't invent noise.
`.trim();

function getAnthropic(): Anthropic {
  const apiKey = process.env.VP_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No Anthropic API key set (VP_ANTHROPIC_KEY / ANTHROPIC_API_KEY).');
  return new Anthropic({ apiKey });
}

function buildUserPrompt(signal: OwnerSignal): string {
  return [
    `OWNER: @${signal.handle}`,
    ``,
    `RECENT TWEET SAMPLES (owner's voice + topics):`,
    signal.recentTweetSamples.length
      ? signal.recentTweetSamples.map((t, i) => `${i + 1}. ${t.slice(0, 240)}`).join('\n')
      : '(none)',
    ``,
    `MOST-MENTIONED HANDLES (with counts):`,
    signal.frequentMentions.length
      ? signal.frequentMentions.slice(0, 30).map((m) => `@${m.handle} (${m.count}x)`).join(', ')
      : '(none)',
    ``,
    `FOLLOWS (sample):`,
    signal.following.length
      ? signal.following.slice(0, 100).map((h) => '@' + h).join(', ')
      : '(none)',
    ``,
    `BOOKMARK AUTHORS:`,
    signal.bookmarkedAuthors.length
      ? Array.from(new Set(signal.bookmarkedAuthors)).map((h) => '@' + h).join(', ')
      : '(none)',
    ``,
    `BOOKMARK TEXTS (highest-interest content):`,
    signal.bookmarkedTexts.length
      ? signal.bookmarkedTexts.slice(0, 20).map((t, i) => `${i + 1}. ${t.slice(0, 200)}`).join('\n')
      : '(none)',
    ``,
    `RECENT LIKE AUTHORS:`,
    signal.likedAuthors.length
      ? Array.from(new Set(signal.likedAuthors)).map((h) => '@' + h).join(', ')
      : '(none)',
    ``,
    `Return STRICT JSON now.`,
  ].join('\n');
}

// Claude sometimes wraps JSON in code fences or leading prose despite the
// instruction. Peel it out.
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Claude response did not contain JSON');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function coerceHandle(raw: string): string | null {
  const stripped = raw.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(stripped)) return null;
  return stripped;
}

export async function proposeTargets(signal: OwnerSignal): Promise<ProposedTarget[]> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    temperature: 0.5,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(signal) }],
  });

  const text = response.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('')
    .trim();

  const parsed = extractJson(text) as { targets?: Array<{ handle?: string; reason?: string }> };
  const rows = Array.isArray(parsed.targets) ? parsed.targets : [];

  const out: ProposedTarget[] = [];
  const seen = new Set<string>();
  seen.add(signal.handle.toLowerCase());
  for (const row of rows) {
    const handle = coerceHandle(row.handle ?? '');
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    out.push({
      handle,
      reason: (row.reason ?? '').trim().slice(0, 140),
    });
  }
  return out.slice(0, 50);
}
