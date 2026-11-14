// PDF text extraction. Owner: B (Step 3). Placeholder so imports resolve.
import type { SourceDoc } from '../../../shared/contracts';

export async function fromPdf(url: string): Promise<SourceDoc> {
  return { url, title: url.split('/').pop() ?? url, kind: 'pdf', passages: [], links: [] };
}
