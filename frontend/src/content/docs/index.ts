import type { DocPage, DocPageId } from '../../lib/docs/types';
import { about } from './about';
import { howAPredictionIsMade } from './howAPredictionIsMade';
import { models } from './models';
import { forecasting } from './forecasting';
import { metrics } from './metrics';
import { dataQuality } from './dataQuality';

export const DOC_PAGES: Record<DocPageId, DocPage> = {
  about,
  'how-a-prediction-is-made': howAPredictionIsMade,
  models,
  forecasting,
  metrics,
  'data-quality': dataQuality,
};
