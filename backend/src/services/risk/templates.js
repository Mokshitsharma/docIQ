/**
 * Pre-built clause-extraction templates. Each runs against a document's full
 * text after ingestion and surfaces a summary card.
 *
 * `keywords` drive retrieval of the most relevant chunks to feed the LLM
 * (keeps token cost bounded for large docs).
 */
export const RISK_TEMPLATES = [
  {
    key: 'paymentTerms',
    label: 'Payment terms',
    keywords: ['payment', 'invoice', 'net 30', 'due', 'fees', 'amount payable', 'currency'],
    question:
      'What are the payment terms? Include amounts, currency, due dates / net terms, and late-payment penalties.',
  },
  {
    key: 'termination',
    label: 'Termination clause',
    keywords: ['terminate', 'termination', 'notice period', 'for cause', 'convenience', 'breach'],
    question:
      'Summarise the termination provisions: who can terminate, on what grounds, and what notice period applies.',
  },
  {
    key: 'liabilityCap',
    label: 'Liability cap',
    keywords: ['liability', 'limitation of liability', 'indemn/ indemnify', 'damages', 'aggregate', 'cap'],
    question:
      'Is there a limitation of liability? State the cap amount or formula and any carve-outs (e.g. indemnity, confidentiality, gross negligence).',
  },
  {
    key: 'renewal',
    label: 'Renewal / expiry dates',
    keywords: ['renewal', 'auto-renew', 'renew', 'term', 'effective date', 'expiry', 'expiration'],
    question:
      'What is the contract term? Include the effective date, expiry date, and any auto-renewal mechanics and opt-out notice window.',
  },
  {
    key: 'confidentiality',
    label: 'Confidentiality',
    keywords: ['confidential', 'confidentiality', 'non-disclosure', 'proprietary', 'trade secret'],
    question:
      'Summarise the confidentiality obligations and how long they survive termination.',
  },
];

export default RISK_TEMPLATES;
