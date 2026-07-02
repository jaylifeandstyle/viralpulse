/**
 * src/lib/growth/draft-candidate.ts
 *
 * Given a target's tweet, ask Claude Haiku to draft a reply or quote-tweet
 * in the owner's voice. Cheap per-call so the scanner can run every 2h
 * without meaningful cost pressure. Returns null when the tweet isn't
 * worth engaging with — the scanner records that as a "skipped" outcome.
 */

import Anthropic from '@anthropic-ai/sdk';

export type DraftCandidateInput = {
  ownerHandle: string;
  targetHandle: string;
  targetBio?: string;
  sourceTweetText: string;
  voiceSamples: string[];
};

export type DraftCandidateOutput =
  | { kind: 'draft'; draft: string; reasoning: string; action: 'reply' | 'quote_tweet' }
  | { kind: 'skip'; reasoning: string };

const SYSTEM_PROMPT = `
You draft short, sharp X (Twitter) replies and quote-tweets on behalf of the
OWNER account. Their goal is FOLLOWER GROWTH. The way growth happens: the
owner posts a reply on the target's tweet that adds real value — an angle,
a nuance, a counter, an insight the audience hasn't already seen — so
readers click through to the owner and follow.

RULES for the draft you write:
- Must be in the OWNER's voice — study the voice samples closely: word
  choice, tone, sentence rhythm, punctuation habits, use of caps/emojis.
- Add VALUE: a fresh angle, a hidden implication, a sharp counter, or a
  specific fact/observation. Never generic agreement ("great point!"),
  never fawning.
- 100–240 characters is the sweet spot. Under 280 is a hard limit.
- Do NOT start the reply with the target's @handle — X handles that.
- No hashtags unless natural to the owner's voice.
- No slop phrases: "this is huge", "wild", "insane", "let's go", "🚨".
- Reply is the default. Quote-tweet only when the owner's take reframes
  the whole tweet (adds a lens the target didn't provide) — otherwise
  reply is more likely to convert because it lives in the target's thread.
- SAFETY: refuse to engage on politically incendiary topics, tragedies,
  personal attacks, illegal advice, or grift.

If the tweet is thin or unsafe (nothing to say, or would hurt the owner's
reputation to reply), output the skip form.

OUTPUT STRICT JSON only. No prose, no code fences.

Good tweet:
{"action":"reply","draft":"<the reply text>","reasoning":"<one line: what angle you took and why it converts>"}

Or quote:
{"action":"quote_tweet","draft":"<the quote-tweet text>","reasoning":"<one line>"}

Or skip:
{"action":"reply","draft":null,"reasoning":"<one line: why skipped>"}
`.trim();

function getAnthropic(): Anthropic {
  const apiKey = process.env.VP_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No Anthropic API key set (VP_ANTHROPIC_KEY / ANTHROPIC_API_KEY).');
  return new Anthropic({ apiKey });
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Claude response missing JSON');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function draftCandidate(
  input: DraftCandidateInput,
): Promise<DraftCandidateOutput> {
  const client = getAnthropic();

  const voice =
    input.voiceSamples.length > 0
      ? input.voiceSamples.map((t, i) => `${i + 1}. ${t.slice(0, 240)}`).join('\n')
      : '(no voice samples available — infer from context, be conservative)';

  const userPrompt = [
    `OWNER: @${input.ownerHandle}`,
    `TARGET: @${input.targetHandle}${input.targetBio ? ` — ${input.targetBio}` : ''}`,
    ``,
    `OWNER VOICE SAMPLES:`,
    voice,
    ``,
    `TARGET'S TWEET:`,
    input.sourceTweetText,
    ``,
    `Draft in @${input.ownerHandle}'s voice. Output STRICT JSON.`,
  ].join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    temperature: 0.6,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('')
    .trim();

  const parsed = extractJson(text) as {
    action?: string;
    draft?: string | null;
    reasoning?: string;
  };
  const reasoning = (parsed.reasoning ?? '').trim().slice(0, 200);

  const draft = (parsed.draft ?? '').trim();
  if (!draft) {
    return { kind: 'skip', reasoning: reasoning || '(no reason returned)' };
  }
  if (draft.length > 280) {
    // Preserve Claude's rationale and surface the overrun so we can decide
    // whether to loosen the prompt or add a trim-retry loop later.
    return {
      kind: 'skip',
      reasoning: `draft exceeded 280 chars (${draft.length}) — "${draft.slice(0, 60)}…"`,
    };
  }

  const action: 'reply' | 'quote_tweet' =
    parsed.action === 'quote_tweet' ? 'quote_tweet' : 'reply';
  return { kind: 'draft', draft, action, reasoning };
}
