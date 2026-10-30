# One everyday NutriScan checkout

Use `codex/stable` in this existing ThinkBook folder:

```powershell
Set-Location -LiteralPath 'C:\Users\KIIT0001\Documents\Seventh Semester Project NutriScan\NutriScan-study-ops'
npm run dev
```

Open http://127.0.0.1:3400. Stop with Ctrl+C. Do not switch branches to launch the application. The `study-ops` folder name is historical; this is now the complete current application. Node.js 22.13+ is required. Next.js automatically reads this checkout's ignored `.env.local`; keys remain server-side. The owner's local configuration selects free Flash-Lite and disables paid requests/fallback. No parent environment path, `NODE_OPTIONS` workaround or special port is required.

Install with `npm ci` only on a fresh clone or after dependency changes. The installation prepares local OCR assets. Do not overwrite the existing `.env.local`. A fresh clone receives `.env.example`, which disables remote inference until explicitly configured. The model selector reflects the locally configured routes, not guaranteed entitlement to every nominal model.

For an optimized demo, stop the dev server, run `npm run build`, then `npm start`. Use the same URL. A dev run may replace the `.next` build; rebuild before the next production start. Avoid editing code during a demonstration: hot refresh can reload the page. Investigations, completed conversations and corrections now save automatically in this browser. Wait for “Saved on this device” before closing; the latest investigation restores on reopening. Photos remain session-only and must be reattached for further visual inspection. Recent scans provides individual deletion and confirmed clear-history.

## Which repository pointers matter?

* `codex/stable`: the current application and normal checkout/default GitHub branch.
* `codex/generalized-package-intelligence-wip`: historical integration name, fast-forwarded to this acceptance checkpoint for compatibility. Do not use it as a second workstream.
* `main`: retained historical branch; no automatic merge or history rewrite was performed.
* `nutriscan-rc-20261027`: immutable original release baseline. Retain it.
* Research/private receipts remain bound to their historical commits. A stable application pointer does not retroactively change those measurements.

## Worktrees and private assets

There are two registered worktrees. Keep the active `NutriScan-study-ops` checkout. Keep the original `NutriScan` checkout as a protected corpus/owner-overlay archive: it contains five owner changes and private source material. Its `.data/models`, `.data/sources` and `.data/knowledge` are targets of links from the active checkout. Removing or moving that original directory would break those links. Do not use `git worktree remove` on either directory as part of cleanup.

The original `NutriScan.7z`, reports, references, experiment receipts, images and configuration are preservation assets, not build caches. The research archive has separate rights/privacy restrictions. Do not upload them with source changes.

## Optional cleanup

No worktree, cache, private data or branch was deleted during presentation acceptance. The private audit folder contains `CLEANUP_COMMANDS.ps1` with explicit paths and ancestry checks. Run its commands only after stopping the relevant server and reviewing the target. The commands remove generated `.next` trees or old branch pointers; they do not remove `.data`, source, credentials or owner overlays.

All listed old feature branches except `codex/m2-subject-scope-20261027` are already ancestors of the stable line. That subject-scope branch has 42 unique commits and is retained for review; do not force-delete it. The original integration branch is checked out in the protected worktree and is also retained locally. Deleting merged branch pointers is optional and does not save meaningful disk space. Deleting build caches is the relevant space-saving operation; the next launch/build recreates them.
