# docIQ eval report — 20261027-150736-eval

git 6e7686f (dirty) · node v24.19.0 · llm=extractive · seed 1234 · `cd backend && npm run eval`

Values in %, 95% bootstrap CI (10,000 resamples). Answer metrics include the app refusal gates (confidence 0.15, query coverage 0.30). Only test splits are reported; dev splits feed the power analysis.

## Hand-written test split (71 q: 58 answerable, 13 unanswerable)

| Run | hit@5 | MRR@5 (×100) | Answer acc. | Refusal acc. | Overall acc. | Citation acc. | Faithfulness | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|---|---|
| bm25 | 98.3 [94.8–100.0] | 87.9 [81.5–94.0] | 63.8 [51.7–75.9] | 76.9 [53.8–100.0] | 66.2 [54.9–77.5] | 92.2 [84.3–98.0] | 100.0 [100.0–100.0] | 6.5 [5.6–7.3] | 10.7 [9.2–12.1] |
| vector:local | 86.2 [77.6–94.8] | 67.2 [57.0–77.2] | 62.1 [50.0–74.1] | 69.2 [46.2–92.3] | 63.4 [52.1–74.7] | 86.3 [76.5–94.1] | 100.0 [100.0–100.0] | 6.9 [6.2–7.3] | 9.8 [9.0–11.6] |
| hybrid:local | 93.1 [86.2–98.3] | 82.6 [74.3–90.4] | 65.5 [53.4–77.6] | 76.9 [53.8–100.0] | 67.6 [56.3–78.9] | 90.2 [82.3–98.0] | 100.0 [100.0–100.0] | 16.6 [15.7–17.7] | 32.7 [27.7–36.2] |
| hybrid-rrf:local | 94.8 [87.9–100.0] | 77.0 [68.5–85.2] | 62.1 [50.0–74.1] | 76.9 [53.8–100.0] | 64.8 [53.5–76.1] | 88.2 [78.4–96.1] | 100.0 [100.0–100.0] | 6.3 [5.8–6.6] | 8.0 [7.4–8.5] |
| vector:minilm | 93.1 [86.2–98.3] | 67.4 [57.9–76.8] | 62.1 [50.0–74.1] | 69.2 [46.2–92.3] | 63.4 [52.1–74.7] | 91.8 [83.7–98.0] | 100.0 [100.0–100.0] | 24.4 [22.7–26.9] | 70.7 [46.5–78.0] |
| hybrid:minilm | 96.5 [91.4–100.0] | 84.3 [76.8–91.1] | 65.5 [53.4–77.6] | 69.2 [46.2–92.3] | 66.2 [54.9–77.5] | 92.2 [84.3–98.0] | 100.0 [100.0–100.0] | 31.2 [29.7–32.1] | 65.3 [47.2–82.0] |
| hybrid-rrf:minilm | 96.5 [91.4–100.0] | 80.8 [72.8–88.4] | 62.1 [50.0–74.1] | 76.9 [53.8–100.0] | 64.8 [53.5–76.1] | 92.0 [84.0–98.0] | 100.0 [100.0–100.0] | 21.9 [20.6–23.3] | 29.8 [27.7–60.1] |

Error taxonomy (test):

| Run | correct | retrieval_miss | wrong_refusal | wrong_answer_despite_correct_retrieval | generation_error |
|---|---|---|---|---|---|
| bm25 | 47 | 1 | 7 | 13 | 3 |
| vector:local | 45 | 8 | 5 | 9 | 4 |
| hybrid:local | 48 | 4 | 6 | 10 | 3 |
| hybrid-rrf:local | 46 | 3 | 7 | 12 | 3 |
| vector:minilm | 45 | 3 | 7 | 12 | 4 |
| hybrid:minilm | 47 | 2 | 7 | 11 | 4 |
| hybrid-rrf:minilm | 46 | 2 | 7 | 13 | 3 |

## SYNTHETIC test split (template-generated, answerable only)

| Run | hit@5 | MRR@5 (×100) | Answer acc. | Citation acc. | Faithfulness | p50 ms | p95 ms |
|---|---|---|---|---|---|---|---|
| bm25 | 98.0 [96.3–99.3] | 90.6 [87.9–93.2] | 65.7 [60.3–71.0] | 99.0 [97.5–100.0] | 100.0 [100.0–100.0] | 7.1 [6.9–7.3] | 10.8 [10.0–11.4] |
| vector:local | 58.0 [52.3–63.3] | 38.9 [34.2–43.5] | 46.7 [41.0–52.3] | 88.6 [83.5–93.7] | 100.0 [100.0–100.0] | 7.4 [7.1–7.6] | 10.5 [10.2–11.4] |
| hybrid:local | 80.7 [76.0–85.0] | 72.7 [68.0–77.2] | 56.0 [50.3–61.7] | 96.1 [93.3–98.9] | 100.0 [100.0–100.0] | 12.3 [11.9–12.6] | 17.9 [16.3–19.7] |
| hybrid-rrf:local | 86.0 [82.0–89.7] | 66.1 [61.7–70.5] | 60.0 [54.3–65.7] | 95.3 [92.2–97.9] | 100.0 [100.0–100.0] | 7.8 [7.5–8.0] | 18.9 [15.0–23.3] |
| vector:minilm | 59.7 [54.3–65.0] | 39.1 [34.6–43.8] | 43.0 [37.3–48.7] | 91.1 [86.3–95.2] | 100.0 [100.0–100.0] | 15.8 [15.6–16.1] | 35.5 [25.7–47.6] |
| hybrid:minilm | 81.7 [77.3–86.0] | 75.9 [71.4–80.3] | 57.3 [51.7–63.0] | 92.2 [88.0–95.8] | 100.0 [100.0–100.0] | 20.7 [20.5–21.7] | 49.0 [40.8–59.2] |
| hybrid-rrf:minilm | 87.3 [83.7–91.0] | 66.2 [61.8–70.7] | 61.3 [55.7–67.0] | 94.9 [91.9–98.0] | 100.0 [100.0–100.0] | 16.1 [15.7–16.5] | 39.1 [29.1–42.3] |

Error taxonomy (syn-test):

| Run | correct | retrieval_miss | wrong_refusal | wrong_answer_despite_correct_retrieval | generation_error |
|---|---|---|---|---|---|
| bm25 | 197 | 6 | 92 | 5 | 0 |
| vector:local | 140 | 124 | 34 | 2 | 0 |
| hybrid:local | 168 | 58 | 71 | 3 | 0 |
| hybrid-rrf:local | 180 | 41 | 75 | 4 | 0 |
| vector:minilm | 129 | 121 | 46 | 4 | 0 |
| hybrid:minilm | 172 | 55 | 68 | 5 | 0 |
| hybrid-rrf:minilm | 184 | 37 | 75 | 4 | 0 |

## Paired comparisons (a − b)

| Split | a − b | Metric | n | Δ pts [95% CI] | McNemar b10/b01 | exact p |
|---|---|---|---|---|---|---|
| test | hybrid:local − vector:local | hit@5 | 58 | 6.9 [0.0, 15.5] | 5/1 | 0.21875 |
| test | hybrid:local − vector:local | overall_accuracy | 71 | 4.2 [-2.8, 11.3] | 5/2 | 0.453125 |
| test | hybrid:local − bm25 | hit@5 | 58 | -5.2 [-12.1, 0.0] | 0/3 | 0.25 |
| test | hybrid:local − bm25 | overall_accuracy | 71 | 1.4 [-4.2, 7.0] | 3/2 | 1 |
| test | hybrid-rrf:local − vector:local | hit@5 | 58 | 8.6 [1.7, 15.5] | 5/0 | 0.0625 |
| test | hybrid-rrf:local − vector:local | overall_accuracy | 71 | 1.4 [-4.2, 8.5] | 3/2 | 1 |
| test | hybrid:minilm − vector:minilm | hit@5 | 58 | 3.5 [-3.5, 10.3] | 3/1 | 0.625 |
| test | hybrid:minilm − vector:minilm | overall_accuracy | 71 | 2.8 [-4.2, 11.3] | 5/3 | 0.726563 |
| test | hybrid:minilm − bm25 | hit@5 | 58 | -1.7 [-6.9, 3.5] | 1/2 | 1 |
| test | hybrid:minilm − bm25 | overall_accuracy | 71 | 0.0 [-5.6, 5.6] | 2/2 | 1 |
| test | vector:minilm − vector:local | hit@5 | 58 | 6.9 [-1.7, 17.2] | 6/2 | 0.289062 |
| test | vector:minilm − vector:local | overall_accuracy | 71 | 0.0 [-9.9, 9.9] | 6/6 | 1 |
| syn-test | hybrid:local − vector:local | hit@5 | 300 | 22.7 [17.7, 27.7] | 70/2 | 0 |
| syn-test | hybrid:local − vector:local | answer_accuracy | 300 | 9.3 [3.7, 15.0] | 51/23 | 0.001516 |
| syn-test | hybrid:local − bm25 | hit@5 | 300 | -17.3 [-22.0, -13.0] | 1/53 | 0 |
| syn-test | hybrid:local − bm25 | answer_accuracy | 300 | -9.7 [-15.0, -4.3] | 21/50 | 0.000767 |
| syn-test | hybrid-rrf:local − vector:local | hit@5 | 300 | 28.0 [23.0, 33.0] | 85/1 | 0 |
| syn-test | hybrid-rrf:local − vector:local | answer_accuracy | 300 | 13.3 [7.3, 19.3] | 64/24 | 0.000024 |
| syn-test | hybrid:minilm − vector:minilm | hit@5 | 300 | 22.0 [17.0, 27.0] | 70/4 | 0 |
| syn-test | hybrid:minilm − vector:minilm | answer_accuracy | 300 | 14.3 [8.7, 20.0] | 60/17 | 0.000001 |
| syn-test | hybrid:minilm − bm25 | hit@5 | 300 | -16.3 [-20.7, -12.3] | 1/50 | 0 |
| syn-test | hybrid:minilm − bm25 | answer_accuracy | 300 | -8.3 [-13.3, -3.0] | 20/45 | 0.002626 |
| syn-test | vector:minilm − vector:local | hit@5 | 300 | 1.7 [-5.0, 8.7] | 59/54 | 0.706882 |
| syn-test | vector:minilm − vector:local | answer_accuracy | 300 | -3.7 [-10.0, 2.7] | 41/52 | 0.299732 |

## Power analysis

hybrid:local vs vector:local, hit@5 (paired, exact McNemar), alpha=0.05 two-sided, power=0.80. Target difference 5 points. Discordance rate on dev splits: 0.243.
Required n = **761** paired answerable questions. Achieved: hand-written test **58** (NOT reached), synthetic test **300** (NOT reached).
Detectable difference at achieved n (80% power): hand-written 17.8 pts, synthetic 7.9 pts.

## Cost per query

Actual: $0 (extractive provider, no LLM call). Estimated cost per 1,000 queries if the same prompts went to an LLM (list prices in src/services/query/usage.js, tokens ≈ chars/4, completion length = extractive answer length):

| Split/run | groq | gemini | openai |
|---|---|---|---|
| test/vector:local | $0.165 [0.143–0.184] | $0.273 [0.237–0.305] | $0.545 [0.473–0.610] |
| test/hybrid:local | $0.163 [0.140–0.183] | $0.269 [0.232–0.302] | $0.537 [0.463–0.604] |

## Regression gate (eval/thresholds.json)

| Metric | Floor | Value | Pass |
|---|---|---|---|
| test/vector:local/hit@5 | 0.8621 | 0.8621 | yes |
| test/hybrid:local/hit@5 | 0.931 | 0.931 | yes |
| test/bm25/hit@5 | 0.9828 | 0.9828 | yes |
| test/vector:local/refusal_accuracy | 0.6923 | 0.6923 | yes |
| test/hybrid:local/refusal_accuracy | 0.7692 | 0.7692 | yes |
| syn-test/vector:local/hit@5 | 0.58 | 0.58 | yes |
| syn-test/hybrid:local/hit@5 | 0.8067 | 0.8067 | yes |

## Definitions

- hit@k / MRR@5: answerable questions; a chunk is relevant if it is from the gold document and contains a verbatim evidence span.
- Citation accuracy: answered answerable questions where at least one cited chunk is relevant. Citation precision: relevant cited / cited.
- Faithfulness: share of answer sentences with ≥80% of content tokens present in the cited chunks (lexical proxy, no LLM judge; near 1 by construction for the extractive provider).
- Error taxonomy: retrieval_miss (no relevant chunk in top 5), wrong_refusal (relevant chunk retrieved but refused), wrong_answer_despite_correct_retrieval (relevant chunk retrieved, answered, gold string absent), generation_error (answered an unanswerable question).
- Latency: in-process retrieve + answer time per question in the eval harness (no network, no MongoDB); API latency is in the load-test results.

## Not produced

- LLM-generated answer accuracy (gemini/groq/openai): not run — no API key configured; answers come from the extractive (no-LLM) provider
