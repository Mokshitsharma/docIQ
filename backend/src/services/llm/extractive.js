import { LLMProvider } from './base.js';

const STOPWORDS = new Set(
  ('the a an and or of to for in on at is are was were be been being by with as it its this that ' +
    'these those what which who whom whose how when where why do does did will would shall should ' +
    'can could may might must have has had not no if then than so such about into over under').split(
    ' '
  )
);

/**
 * No-API-key fallback. Produces a grounded answer purely by extracting the
 * best-matching sentences from the retrieved context the caller already put in
 * the prompt — so the end-to-end RAG flow (retrieve → answer → cite → refuse)
 * is demoable and testable without any LLM credentials.
 *
 * The query pipeline passes context as blocks like:
 *   [1] (doc.pdf p.3) some passage text spanning one or more sentences...
 */
export class ExtractiveProvider extends LLMProvider {
  get name() {
    return 'extractive';
  }

  async complete({ prompt, json = false }) {
    if (json) {
      // Risk-extraction path asks for JSON — return an empty-but-valid shape.
      return '{}';
    }

    // Prefer an explicit "Question:" label; otherwise use whatever precedes the
    // context section ("Context:" / "Excerpts:").
    const question = (
      prompt.match(/Question:\s*([\s\S]+?)\s*\n/i)?.[1] ||
      prompt.split(/\n\s*(?:Context|Excerpts?)\s*:/i)[0] ||
      ''
    ).toLowerCase();
    const qTerms = new Set(
      question
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    );
    if (qTerms.size === 0) {
      return "I couldn't find this in the provided documents.";
    }

    // The query pipeline emits context blocks headed by "[n] (file p.X) ".
    // Blocks are normally one line, but tolerate wrapped lines by appending
    // any non-headed continuation to the current block.
    const blocks = [];
    for (const rawLine of prompt.split('\n')) {
      const head = rawLine.match(/^\s*\[(\d+)\]\s*(?:\([^)]*\)\s*)?(.*)$/);
      if (head) {
        blocks.push({ marker: Number(head[1]), text: head[2].trim() });
      } else if (/^\s*<\/?untrusted_documents>/.test(rawLine)) {
        continue; // data-block delimiters, not passage text
      } else if (blocks.length && rawLine.trim() && !/^\s*(Context|Question|Answer)\b/.test(rawLine)) {
        blocks[blocks.length - 1].text += ' ' + rawLine.trim();
      }
    }

    if (blocks.length === 0) {
      return "I couldn't find this in the provided documents.";
    }

    // Score every sentence across all blocks by query-term overlap.
    const candidates = [];
    for (const b of blocks) {
      for (const sentence of splitSentences(b.text)) {
        const body = sentence.toLowerCase();
        let hits = 0;
        for (const t of qTerms) if (body.includes(t)) hits++;
        if (hits > 0) candidates.push({ marker: b.marker, sentence, score: hits / qTerms.size });
      }
    }

    // Refusal: no retrieved sentence shares enough with the question.
    const best = candidates.reduce((mx, c) => Math.max(mx, c.score), 0);
    if (best < 0.34) {
      return "I couldn't find this in the provided documents.";
    }

    candidates.sort((a, b) => b.score - a.score);
    const picked = [];
    const seen = new Set();
    for (const c of candidates) {
      const key = c.sentence.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(c);
      if (picked.length === 3) break;
    }

    const markers = [...new Set(picked.map((p) => p.marker))].sort((a, b) => a - b);
    const answer = picked.map((p) => p.sentence.replace(/\s+/g, ' ').trim()).join(' ');
    return `${answer} ${markers.map((n) => `[${n}]`).join(' ')}`.trim();
  }
}

function splitSentences(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;:])\s+(?=[A-Z0-9("'])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}
