// Lightweight token estimation — avoids a tokenizer dependency.
// ~4 chars/token is a decent heuristic for English prose.
export const estimateTokens = (text) => Math.ceil((text || '').length / 4);

export const tokensToChars = (tokens) => tokens * 4;
