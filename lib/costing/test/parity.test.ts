/**
 * Parity tests: default inputs must reproduce the cached results saved in each
 * Excel workbook (values read straight from the uploaded files).
 */
import { runCosting, createPriceBook } from '..';
import { cewood, decorSlat, slatCreate, decorSlatMax, flatPanel, decorMetl, decorZen } from '../calculators';

let fails = 0, passes = 0;
const near = (name: string, got: number | null | undefined, want: number, tol = 1e-6) => {
  const ok = got != null && Math.abs(got - want) <= tol * Math.max(1, Math.abs(want));
  ok ? passes++ : fails++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}: ${got} ${ok ? '' : `(expected ${want})`}`);
};
const S = (r: ReturnType<typeof runCosting>) => r.summary;

console.log('Cewood Baffles — CALCS!C14, C17');
let r = runCosting(cewood, {});
near('cost per baffle', S(r).costPerUnit, 92.30698125);
near('PLM', S(r).headline![0].value, 38.54153705636743);
r = runCosting(cewood, { fixing: 'Direct', painting: 'Yes', size: '1195x290' });
const c = r.lines.reduce((a, l) => a + l.total, 0);
// hand check vs formulas: stock 1/(2*2) yield, cut 1.5/60*125*(1+2), channel 33/5, paint 13.632, drill ceil(1205/550)*2*2/60*125, paint 1195*290*2/1e6*35
near('direct + painted 1195x290 subtotal', c, 37.05065 / 4 + 1.5 / 60 * 125 * 3 + 33 / 5 + 13.632 + 6 * 2 / 60 * 125 + 1195 * 290 * 2 / 1e6 * 35);

console.log('DecorSlat — CALCULATIONS!F2:F9');
r = runCosting(decorSlat, {});
near('material', S(r).materialCost, 25.6091);
near('labour (incl 20%)', S(r).labourCost, 226.53596491228072);
near('total cost', S(r).totalCost, 283.6631980263158);
near('sell', S(r).sell, 540.3108533834586);
near('cost / m²', S(r).costPerUnit, 196.98833196271931);
near('sell / m²', S(r).sellPerUnit, 375.2158704051796);

console.log('SlatCreate — CALCULATIONS!F2:F9');
r = runCosting(slatCreate, {});
near('material', S(r).materialCost, 0);
near('labour', S(r).labourCost, 72.9621052631579);
near('total cost', S(r).totalCost, 82.08236842105264);
near('sell', S(r).sell, 156.34736842105264);
near('cost / m²', S(r).costPerUnit, 57.00164473684211);
near('slat sheet qty (G25)', r.lines.find((l) => l.id === 'slat-sheet')!.qty * 1.1, 0.805255);
near('edging qty (G26)', r.lines.find((l) => l.id === 'slat-edging')!.qty * 1.1, 6.8112);

console.log('DecorSlat Max — MAIN!F3:F10');
r = runCosting(decorSlatMax, {});
near('material', S(r).materialCost, 74.69999999999999);
near('labour', S(r).labourCost, 28.77);
near('total cost', S(r).totalCost, 116.40374999999999);
near('sell', S(r).sell, 232.80749999999998);
near('cost / LM', S(r).costPerUnit, 48.5015625);
near('sell / LM', S(r).sellPerUnit, 97.003125);

console.log('Flat Panel — CALCULATIONS!I20:I22, N20');
r = runCosting(flatPanel, {});
near('cost / m²', S(r).costPerUnit, 31.66875);
near('sell / m²', S(r).sellPerUnit, 90.48214285714286);
near('labour hours', S(r).labourHours, 0.09371428571428572);
r = runCosting(flatPanel, { edgeSize: '2400x600' });
near('2400x600 edge tape rate (helper B4)', r.lines.find((l) => l.id === 'edgeTape')!.rate, 6.3);
near('2400x600 edging rate (helper C4)', r.lines.find((l) => l.id === 'edging')!.rate, 9.2);
r = runCosting(flatPanel, { cncProfile: 'DecorZen › AP125/D/XX', cncThickness: '25mm FR MDF / Plywood' });
near('CNC rate AP125/D 25mm FR (CNC Rates!I4)', r.lines.find((l) => l.id === 'cncPanel')!.rate, 55);

console.log('DecorMetl — Sheet1!W2');
r = runCosting(decorMetl, { perforation: 'RS0750', m2: 0.72 });
near('RAM 223 600x1200 dearest option $/m²', S(r).costPerUnit, 26.88843475628217);

console.log('Overrides');
r = runCosting(decorSlatMax, {}, { overrides: { sheet: { rate: 100, reason: 'test' } } });
near('override sheet rate 85→100 moves material', S(r).materialCost, 74.7 + 0.72 * 15);
r = runCosting(decorSlatMax, {}, { overrides: { cleat: { total: 5, reason: 'test' } } });
near('override cleat total', S(r).materialCost, 74.7 - 1 + 5);

console.log('Price book (order > catalog > default)');
const book = createPriceBook({
  catalog: { 'beam:sheet:MDF - Dual Layer:50': { rate: 90 } },
  orders: [{ priceKey: 'beam:sheet:MDF - Dual Layer:50', rate: 95, orderId: 'MO-1', orderedAt: '2026-09-30' },
           { priceKey: 'beam:sheet:MDF - Dual Layer:50', rate: 92, orderId: 'MO-0', orderedAt: '2026-08-01' }],
  now: new Date('2026-10-06'),
});
r = runCosting(decorSlatMax, {}, { prices: book });
const sheet = r.lines.find((l) => l.id === 'sheet')!;
near('latest order wins', sheet.rate, 95);
console.log(`    source=${sheet.rateSource} note=${sheet.note}`);

console.log('DecorZen — hand-traced (Excel 365 dynamic arrays; LibreOffice cannot recalc)');
r = runCosting(decorZen, {});
for (const l of r.lines.filter((l) => l.total)) console.log(`    ${l.id.padEnd(18)} rate ${l.rate.toFixed(4).padStart(9)} setup ${l.setup.toFixed(2).padStart(8)} w ${l.wastagePct} total ${l.total.toFixed(2)}`);
console.log('   ', JSON.stringify(S(r)));
near('materials (independent Python trace)', S(r).materialCost, 11187.2);
near('labour', S(r).labourCost, 10583.375);
near('total project cost', S(r).totalCost, 27468.47109375);
near('m² cost (ROUNDUP 0.1)', S(r).costPerUnit, 137.4);
near('m² sell @60%', S(r).sellPerUnit, 343.5);
r = runCosting(decorZen, { qtyM2: 10 });
near('MOQ: 10 m² scales substrate rate to 42.39 × 28.8 / 10', r.lines[0].rate, 42.39 * 28.8 / 10);

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
