import Anthropic from '@anthropic-ai/sdk';
import { GALAXY_02_SYSTEM_PROMPT } from './prompts';
import { UserPreferences, OpportunitySignals } from '@/shared/types';

// Lazy singleton — reads env at first call, not at module load time.
// VP_ANTHROPIC_KEY avoids the empty ANTHROPIC_API_KEY Claude Desktop injects.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.VP_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('No Anthropic API key found. Set VP_ANTHROPIC_KEY in .env.local');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export class Galaxy02 {
  static id = 'galaxy.02';
  static label = 'Galaxy.02 - Smart Selective Early Positioning';

  async processOpportunity(signals: OpportunitySignals, userPrefs: UserPreferences): Promise<any> {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      temperature: 0.65,
      system: GALAXY_02_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `User Preferences:\n${JSON.stringify(userPrefs, null, 2)}\n\nOpportunity Signals:\n${JSON.stringify(signals, null, 2)}\n\nAnalyze this opportunity. Be selective — only recommend action if confidence is high.`,
        },
      ],
    });

    const block = response.content[0];
    const raw = block.type === 'text' ? block.text : '{}';
    return extractJson(raw);
  }
}

function extractJson(raw: string): Record<string, unknown> {
  // 1. Direct parse (fast path — works when prefill did its job)
  try {
    return JSON.parse(raw);
  } catch {}

  // 2. Strip markdown code fences then retry
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {}

  // 3. Extract the first {...} block from anywhere in the string
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  return { error: 'Failed to parse Galaxy.02 response', raw };
}
