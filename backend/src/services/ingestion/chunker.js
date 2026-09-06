import { estimateTokens } from '../../utils/tokens.js';

/**
 * Split pages into overlapping chunks, preserving page provenance.
 *
 * Strategy: greedily pack sentence-ish segments into a chunk until it reaches
 * `chunkSize` tokens, then start the next chunk with a `chunkOverlap`-token
 * tail of the previous one. Chunks never span pages — the page number is part
 * of every citation.
 *
 * @param {{pageNumber:number, text:string}[]} pages
 * @param {{chunkSize:number, chunkOverlap:number}} opts   (token units)
 * @returns {{ordinal:number, text:string, pageNumber:number, tokenCount:number}[]}
 */
export function chunkPages(pages, { chunkSize = 800, chunkOverlap = 100 } = {}) {
  const overlap = Math.min(chunkOverlap, Math.floor(chunkSize / 2));
  const chunks = [];
  let ordinal = 0;

  for (const page of pages) {
    const segments = splitIntoSegments(page.text);
    let current = [];
    let currentTokens = 0;

    const flush = () => {
      if (!current.length) return;
      const text = current.join(' ').trim();
      if (text) {
        chunks.push({
          ordinal: ordinal++,
          text,
          pageNumber: page.pageNumber,
          tokenCount: estimateTokens(text),
        });
      }
    };

    for (const seg of segments) {
      const segTokens = estimateTokens(seg);

      // A single oversized segment: hard-split it.
      if (segTokens > chunkSize) {
        flush();
        current = [];
        currentTokens = 0;
        for (const piece of hardSplit(seg, chunkSize)) {
          chunks.push({
            ordinal: ordinal++,
            text: piece,
            pageNumber: page.pageNumber,
            tokenCount: estimateTokens(piece),
          });
        }
        continue;
      }

      if (currentTokens + segTokens > chunkSize && current.length) {
        flush();
        // carry an overlap tail into the next chunk
        const tail = [];
        let tailTokens = 0;
        for (let i = current.length - 1; i >= 0 && tailTokens < overlap; i--) {
          tail.unshift(current[i]);
          tailTokens += estimateTokens(current[i]);
        }
        current = tail;
        currentTokens = tailTokens;
      }

      current.push(seg);
      currentTokens += segTokens;
    }
    flush();
  }

  return chunks;
}

function splitIntoSegments(text) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])|\n{2,}/)
    // collapse intra-segment whitespace (incl. single newlines) so chunk text
    // is clean single-line prose — better for embeddings and prompt formatting
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function hardSplit(text, chunkSize) {
  const words = text.split(/\s+/);
  const perChunk = Math.max(1, chunkSize * 4); // chunkSize tokens ≈ 4x words-ish chars
  const out = [];
  let buf = [];
  let len = 0;
  for (const w of words) {
    buf.push(w);
    len += w.length + 1;
    if (len >= perChunk) {
      out.push(buf.join(' '));
      buf = [];
      len = 0;
    }
  }
  if (buf.length) out.push(buf.join(' '));
  return out;
}
