// Link weights, in priority order: Databricks-learned (databricks/link-weights.json, bundled at
// build time if D has pushed it), then the hand-set default.
import type { LinkWeights } from '../../../shared/contracts';
import fallback from '../../../shared/fixtures/synthetic/link-weights.default.json';

const learned = import.meta.glob<LinkWeights>('../../../databricks/link-weights.json', { eager: true, import: 'default' });

export function bundledWeights(): LinkWeights {
  const w = Object.values(learned)[0];
  if (w && typeof w.bias === 'number' && typeof w.relevance === 'number') return { ...(fallback as LinkWeights), ...w };
  return fallback as LinkWeights;
}
