/** The production wiring of the AI features: real evidence sources, the `ai` module as the model, the tenant's settings, the daily count. */
import { defaultEvidenceSources } from './ai.sources';
import { aiModuleModel } from './ai.model';
import { getAiSettings } from './ai.settings';
import { countRunsToday } from './ai.store';
import type { InvestigatorDeps } from './ai.investigator';

export const realInvestigatorDeps = (): InvestigatorDeps => ({ sources: defaultEvidenceSources, model: aiModuleModel, settings: getAiSettings, countToday: countRunsToday });
