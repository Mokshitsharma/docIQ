/**
 * Optional PII redaction (REDACT_PII=true). Regex-based, so it catches common
 * formats only: emails, US SSNs, payment-card-like digit runs, phone numbers.
 * It is a safety net for logs, not a compliance control.
 */
const RULES = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[CARD]'],
  [/(?:\+?\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g, '[PHONE]'],
];

export function redactPII(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const [re, label] of RULES) out = out.replace(re, label);
  return out;
}

export default redactPII;
