# NutriScan technical modules

The owner-controlled application invokes three independently testable modules through narrow TypeScript entry points:

- `ocr/` recognizes package text and interprets its structure as observations and tentative candidates.
- `knowledge/` normalizes and retrieves attributed food-reference records.
- `inference/` prepares bounded evidence and validates structured reasoning output without changing package facts.

Shared production schemas remain centralized in `src/lib/contracts.ts`. Module dependencies may reach that shared contract file, their own internals, and the small documented runtime dependencies. They must not import each other's implementation. App storage, consent, session state, UI, API routes, provider enablement, and cross-module orchestration stay owner-controlled behind `src/lib/` compatibility facades.

Use each module's `test.mjs` for its offline fixture suite. Run `npm run typecheck` from the repository root before proposing integration. The owner can check import direction with:

```powershell
npx tsx scripts/check-module-boundaries.mts
```

Contributors should work from a clean module branch and can check their changed paths against the merge base with:

```powershell
npx tsx scripts/check-module-ownership.mts <ocr|knowledge|inference> <base-ref>
```

These checks verify import and file-scope rules; passing them alone does not prove behavioral equivalence or independent evaluation quality. Follow the module-specific `AGENTS.md` and README before changing code.
