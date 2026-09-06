import { getLLMProvider } from '../llm/index.js';
import { RISK_TEMPLATES } from './templates.js';

/**
 * Run every risk template against a document's chunks.
 *
 * @param {{text:string, pageNumber:number}[]} chunks  all chunks of one document
 * @param {string} llmProviderName
 * @returns {Promise<{ generatedAt: string, items: object[] }>}
 */
export async function extractRisks(chunks, llmProviderName) {
  const llm = getLLMProvider(llmProviderName);
  const items = [];

  for (const tpl of RISK_TEMPLATES) {
    const relevant = pickRelevantChunks(chunks, tpl.keywords, 4);
    if (relevant.length === 0) {
      items.push({ key: tpl.key, label: tpl.label, present: false, summary: 'Not found in document.', pages: [] });
      continue;
    }

    const context = relevant
      .map((c, i) => `[${i + 1}] (p.${c.pageNumber}) ${c.text}`)
      .join('\n\n');

    const system =
      'You are a contract analyst. Answer ONLY from the provided excerpts. ' +
      'If the excerpts do not contain the information, say so plainly. Be concise (2-4 sentences).';
    const prompt = `Question: ${tpl.question}\n\nExcerpts:\n${context}`;

    let summary;
    try {
      summary = (await llm.complete({ system, prompt, temperature: 0, maxTokens: 400 })).trim();
    } catch (err) {
      summary = `Extraction failed: ${err.message}`;
    }

    const notFound =
      /not (found|contain|present|specif|mention)|no (mention|reference|information)|could ?n'?t find|could not find|does not (appear|contain|mention)|is not (addressed|mentioned|specified)/i.test(
        summary
      );
    items.push({
      key: tpl.key,
      label: tpl.label,
      present: !notFound,
      summary,
      pages: [...new Set(relevant.map((c) => c.pageNumber))].sort((a, b) => a - b),
    });
  }

  return { generatedAt: new Date().toISOString(), items };
}

function pickRelevantChunks(chunks, keywords, limit) {
  const kw = keywords.map((k) => k.toLowerCase());
  const scored = chunks
    .map((c) => {
      const body = c.text.toLowerCase();
      let score = 0;
      for (const k of kw) if (body.includes(k)) score += 1;
      return { c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.c);
}

export default extractRisks;
