# Core extraction and calculation evaluation

`npm run evaluate` runs the versioned `core-synthetic-v1.1` suite in `scripts/evaluate.ts` and writes `docs/evidence/core-evaluation.json`. The receipt records actual run time, annotated expected values, extracted fields, calculation errors and pass/fail results. A failing annotation sets a nonzero process exit code.

The suite contains 20 explicitly synthetic developer examples. Each annotation tests an important nutrient value, unit, explicit basis and, when material, conflict state. Additional checks measure required absences, calculations correctly withheld, and absolute numerical error against declared expected arithmetic. These counts describe only these annotations, not complete package or OCR accuracy.

The recorded run at 21 October 2026, 03:45 IST passed 20/20 cases: 29/29 annotated fields, 4/4 required absences, 11/11 required withheld calculations, and 19 numerical comparisons. Maximum absolute numerical error was `5.421010862427522e-20`; mean absolute error was `2.853163611803959e-21`. The JSON receipt has the exact UTC timestamp and per-case results. These measurements are development checks on synthetic inputs.

Cases cover zero versus unknown, servings, mass versus volume, sodium grams, salt conversion, dual table columns, conflicting OCR-like readings, missing basis/units, bounded quantities, negative values, percentages, duplicate equivalent bases, inconsistent sugar totals, limited French/Spanish nutrient aliases, decimal commas, explicit energy-unit pairs, split headers and small-value conversion precision. French/Spanish coverage is a small list of nutrient labels, not multilingual OCR acceptance.

This is a development regression set used while implementing the parser. It is not independent, held out, representative of Indian packages, or evidence of genuine image OCR, language-model/provider use, clinical correctness or current regulatory verification. The genuine photograph/browser journey is evaluated separately by the integrator. Source images stay in the ignored private evidence directory.

The synchronous audit uses a transparent keyword/concept rule baseline for source selection and question templates. Learned MiniLM retrieval has its own independent evaluation receipt. Neither source retrieval nor a successful template proves that a general conversational assistant ran.
