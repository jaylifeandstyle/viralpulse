// src/galaxies/galaxy.01/index.ts
import Anthropic from '@anthropic-ai/sdk';
import { GALAXY_01_SYSTEM_PROMPT } from './prompts';
import { UserPreferences, OpportunitySignals, GalaxyOutput } from '@/shared/types';

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

export class Galaxy01 {
  static id = 'galaxy.01';
  static label = 'Galaxy.01 - Growth Maximizer';

  async processOpportunity(signals: OpportunitySignals, userPrefs: UserPreferences): Promise<any> {
    const response = await getClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1400,
      temperature: 0.75,
      system: GALAXY_01_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `
User Preferences:
${JSON.stringify(userPrefs, null, 2)}

Opportunity Signals:
${JSON.stringify(signals, null, 2)}

Analyze this opportunity and return the best strategy for maximum follower growth.
`
      }]
    });

    try {
      const block = response.content[0];
      const raw = block.type === 'text' ? block.text : '{}';
      const text = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      return JSON.parse(text);
    } catch {
      return { error: "Failed to parse response" };
    }
  }
}