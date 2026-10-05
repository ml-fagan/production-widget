# Decor Systems costing engine

One engine and one screen for the seven sales templates:
DecorZen Model, Flat Panel, DecorSlat, SlatCreate, DecorSlat Max, Cewood Baffles, DecorMetl.

## Layout
- `src/engine/core.ts` — line model, overrides, Excel-compatible ROUNDUP/ROUNDDOWN/MROUND, `runCosting()`
- `src/calculators/*` — one file per template, ported formula-for-formula (cell refs in comments)
- `src/data/*.json` — reference data extracted from the workbooks (DecorZen Materials 1,175 rows, Profiles 788 rows, lookups; Flat Panel CNC minutes; DecorMetl list)
- `src/pricing/priceBook.ts` — price precedence: manual override > latest material order (≤180 days) > central price list > template default
- `ui/CostingWorkbench.jsx` + `ui/costing.css` — React screen for production-feed
- `server/costingRoute.ts` — decorhandover save route: re-runs the engine server-side, stores inputs + overrides + prices used
- `server/materialOrderPrices.ts` — reads material orders into the price book. **Field names are placeholders (TODO markers) until mapped to the real order schema.**
- `test/parity.test.ts` — 38 checks against values cached in the uploaded workbooks

## Run the tests
    npm i -D esbuild && npx esbuild test/parity.test.ts --bundle --platform=node --outfile=/tmp/p.js && node /tmp/p.js

## Dropping into the apps
- Copy `src/` into decorhandover (e.g. `src/costing`) and alias it as `@/costing`; production-feed imports the same folder (or a shared package) for live preview.
- Mount `<CostingWorkbench priceBook={...} settings={...} user={...} onSave={(d) => fetch('/api/costings', {method:'POST', body: JSON.stringify({ jobId, ...d })})} />`.
- Settings (labour $/hr, overhead %) live in `settings/costing` so a Factory Recovery change updates every template at once.

## Ported as-is, flagged for the model owners (Kieran / Mark / Geoff)
1. Supplier price tabs are duplicated across workbooks and have drifted (Laminex Fireguard, Smartlook, Timbeck, Fireshield).
2. DecorSlat Max line rates are $175/hr; its LABOUR tab ($125) is unused. Cewood hardcodes $125/hr.
3. DecorSlat charges acoustic lining labour even when Acoustic = N; 20% labour uplift exists only in DecorSlat.
4. Slotted/Solid backing CNC time divides by the MDF-MR rate (0.95) always, then by the selected material rate again.
5. DecorSlat backing board m² uses the slat sheet stock size (2420×1210), not backing stock (2400×1200).
6. SlatCreate slat count = ROUNDDOWN(L/A)·W/L + ROUNDDOWN(W/B); defaults include +400% CNC and +300% edging extras.
7. DecorZen: overriding a labour rate removes its waste allowance; manual labour rows never get waste.
8. DecorMetl "AUD / M2" = dearest perforation × 1.45 regardless of selection; 1.45 not documented (FX vs landed).
9. Approximate-match VLOOKUPs only work because lists are alphabetical — the port uses exact matching.
10. AA1 random 65–85% multiplier on displayed cost/m² (DecorSlat, SlatCreate, Flat Panel) — not ported.
11. DecorSlat Max cleat cutting minutes defined but not charged; Cewood channel painting charges a full length per baffle.
