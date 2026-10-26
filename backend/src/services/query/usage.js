import Usage from '../../models/Usage.js';
import config from '../../config/index.js';

/**
 * Quotas and LLM cost budget per tenant per UTC day.
 * Prices are USD per 1M tokens (list prices; tokens estimated as chars / 4).
 * extractive / local providers cost 0.
 */
export const PRICES = {
  extractive: { in: 0, out: 0 },
  groq: { in: 0.05, out: 0.08 },
  gemini: { in: 0.075, out: 0.3 },
  openai: { in: 0.15, out: 0.6 },
};

export const today = () => new Date().toISOString().slice(0, 10);
const secondsToUtcMidnight = () => {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
};

export function estimateCostUsd(provider, { promptChars = 0, completionChars = 0 } = {}) {
  const p = PRICES[provider] || PRICES.openai; // unknown → priced conservatively
  return ((promptChars / 4) * p.in + (completionChars / 4) * p.out) / 1e6;
}

/** Count one query; throws 429 (with retryAfterSec) when the daily quota is used up. Returns the usage row. */
export async function chargeQuery(workspaceId) {
  const row = await Usage.findOneAndUpdate(
    { workspaceId, day: today() },
    { $inc: { queries: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  if (row.queries > config.quotas.maxQueriesPerDay) {
    throw Object.assign(new Error(`daily query quota reached (${config.quotas.maxQueriesPerDay})`), {
      status: 429,
      code: 'quota_queries',
      retryAfterSec: secondsToUtcMidnight(),
    });
  }
  return row;
}

export const budgetExceeded = (row) => (row?.llmCostUsd || 0) >= config.quotas.llmDailyBudgetUsd;

export async function recordLlmCost(workspaceId, costUsd) {
  if (!costUsd) return;
  await Usage.updateOne({ workspaceId, day: today() }, { $inc: { llmCalls: 1, llmCostUsd: costUsd } }, { upsert: true });
}
