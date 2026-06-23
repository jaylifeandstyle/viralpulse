// src/brain/index.ts
import { UserPreferences, OpportunitySignals, GalaxyOutput } from '@/shared/types';
import { Galaxy01 } from '@/galaxies/galaxy.01';
import { Galaxy02 } from '@/galaxies/galaxy.02';
import { Galaxy03 } from '@/galaxies/galaxy.03';
import { Galaxy04 } from '@/galaxies/galaxy.04';
import { Galaxy05 } from '@/galaxies/galaxy.05';

export type GalaxyId = 'galaxy.01' | 'galaxy.02' | 'galaxy.03' | 'galaxy.04' | 'galaxy.05';

export class Brain {
  private activeGalaxyId: GalaxyId = 'galaxy.02'; // Default — selective journalist strategy

  async processOpportunity(signals: OpportunitySignals, userPrefs: UserPreferences): Promise<GalaxyOutput> {
    console.log(`🧠 Brain processing using ${this.activeGalaxyId}`);

    let result: any;

    switch (this.activeGalaxyId) {
      case 'galaxy.01': {
        result = await new Galaxy01().processOpportunity(signals, userPrefs);
        break;
      }
      case 'galaxy.03': {
        result = await new Galaxy03().processOpportunity(signals, userPrefs);
        break;
      }
      case 'galaxy.04': {
        result = await new Galaxy04().processOpportunity(signals, userPrefs);
        break;
      }
      case 'galaxy.05': {
        result = await new Galaxy05().processOpportunity(signals, userPrefs);
        break;
      }
      case 'galaxy.02':
      default: {
        result = await new Galaxy02().processOpportunity(signals, userPrefs);
        break;
      }
    }

    return {
      galaxyId: this.activeGalaxyId,
      ...result,
      suggestedAction: result.viralityScore > 70 ? 'post_now' : 'schedule',
    };
  }

  setActiveGalaxy(galaxyId: GalaxyId) {
    this.activeGalaxyId = galaxyId;
    console.log(`🔄 Switched active galaxy to ${galaxyId}`);
  }

  getActiveGalaxy(): GalaxyId {
    return this.activeGalaxyId;
  }
}

export const brain = new Brain();
