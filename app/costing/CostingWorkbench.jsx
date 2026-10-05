import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CALCULATORS, runCosting, emptyPriceBook } from '../../lib/costing';
import { MATERIALS } from '../../lib/costing/calculators/decorZen';
import './costing.css';

/**
 * Costing workbench — one screen for all seven sales templates.
 *
 * Every amount on the sheet can be changed: click a quantity, rate, waste or
 * total to override it (with a reason, which stays on the line), or add a line
 * of your own. Prices typed in from a material order are kept and beat the
 * price list; a costing can be saved and opened again to update.
 *
 * Props
 *   priceBook      PriceBook built from the saved order prices — newest order beats the price list
 *   settings       { labourRate, overheadPct } from the Factory Recovery sheet
 *   initial        { calculatorId, inputs, overrides } to open with
 *   user           name recorded against overrides
 *   canEdit        may this person save prices and costings (reading is for everyone)
 *   saveNote       why saving isn't available, when it isn't
 *   prices         saved order prices [{ id, priceKey, rate, unit, supplier, orderId, orderedAt }]
 *   costings       saved costings [{ id, name, jobId, calculatorId, inputs, overrides, extras, summary }]
 *   onSavePrice    (price) => Promise — create, or update when price.id is set
 *   onRemovePrice  (id) => Promise
 *   onSaveCosting  (draft) => Promise<{ id }> — create, or update when draft.id is set
 *   onRemoveCosting (id) => Promise
 */
const money = (n, dp = 2) =>
  n == null || Number.isNaN(n) ? '—' : n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: dp, maximumFractionDigits: dp });
const num = (n, dp = 2) => (n == null ? '—' : Number(n).toLocaleString('en-AU', { maximumFractionDigits: dp }));
const SOURCE = {
  order: { label: 'Order', title: 'Latest material order price' },
  catalog: { label: 'Price list', title: 'Central price list' },
  default: { label: 'Template', title: 'Value from the Excel template' },
  formula: { label: 'Cycle time', title: 'Minutes × labour rate' },
  manual: { label: 'Manual', title: 'Entered or overridden on this costing' },
};
const opts = (spec, inputs) => (typeof spec.options === 'function' ? spec.options(inputs) : spec.options) || [];
// The day on the wall here, not in Greenwich — an order entered in the morning
// shouldn't be dated yesterday.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const MATERIAL_KEYS = MATERIALS.flatMap((m) => [`material:${m.id}`, `edgetape:${m.id}`]);
const toLine = (x) => ({
  id: x.id, section: x.section, label: x.label, description: x.note || undefined,
  qty: 1, unit: 'item', rate: x.amount, setup: 0, wastagePct: 0, rateSource: 'manual',
  enabled: x.enabled !== false, total: x.enabled === false ? 0 : x.amount, extra: true,
});
const blankPrice = (priceKey = '', rate = '', unit = '') => ({ id: null, priceKey, rate: String(rate), unit, supplier: '', orderId: '', orderedAt: today() });

export default function CostingWorkbench({
  priceBook = emptyPriceBook, settings, initial, user = '', canEdit = true, saveNote = '',
  prices = [], costings = [], onSavePrice, onRemovePrice, onSaveCosting, onRemoveCosting,
}) {
  const [calcId, setCalcId] = useState(initial?.calculatorId ?? CALCULATORS[0].id);
  const calc = CALCULATORS.find((c) => c.id === calcId);
  const [inputsById, setInputsById] = useState(() => (initial ? { [initial.calculatorId]: initial.inputs } : {}));
  const [overridesById, setOverridesById] = useState(() => (initial ? { [initial.calculatorId]: initial.overrides ?? {} } : {}));
  const [extrasById, setExtrasById] = useState({});
  const inputs = useMemo(() => ({ ...calc.defaults, ...inputsById[calcId] }), [calc, inputsById, calcId]);
  const overrides = overridesById[calcId] ?? {};
  const extras = extrasById[calcId] ?? [];
  const extraLines = useMemo(() => extras.map(toLine), [extras]);
  const [editing, setEditing] = useState(null); // { id, field, value, reason, extra }
  const [saveState, setSaveState] = useState('');

  // The costing on screen, if it has been saved.
  const [current, setCurrent] = useState({ id: '', name: '', jobId: '' });
  const [adding, setAdding] = useState(null); // { section, label, amount }
  const [priceForm, setPriceForm] = useState(null); // blankPrice() shape
  const [priceMsg, setPriceMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const priceRef = useRef(null);

  const run = useMemo(() => {
    try { return runCosting(calc, inputs, { overrides, settings, prices: priceBook, extraLines }); }
    catch (e) { return { error: e.message }; }
  }, [calc, inputs, overrides, settings, priceBook, extraLines]);

  // Keep cascading selects valid: if an option disappears, fall back to the first one.
  useEffect(() => {
    const fix = {};
    for (const spec of calc.inputs) {
      if (spec.type !== 'select' || (spec.visible && !spec.visible(inputs))) continue;
      const o = opts(spec, inputs);
      if (o.length && !o.includes(String(inputs[spec.key] ?? ''))) fix[spec.key] = o[0];
    }
    if (Object.keys(fix).length) setInput(fix);
  }, [calc, inputs]); // eslint-disable-line react-hooks/exhaustive-deps

  function setInput(patch) {
    setInputsById((s) => ({ ...s, [calcId]: { ...s[calcId], ...patch } }));
    setSaveState('');
  }
  function setOverride(id, o) {
    setOverridesById((s) => {
      const next = { ...(s[calcId] ?? {}) };
      if (o) next[id] = o; else delete next[id];
      return { ...s, [calcId]: next };
    });
    setSaveState('');
  }
  function setExtras(fn) {
    setExtrasById((s) => ({ ...s, [calcId]: fn(s[calcId] ?? []) }));
    setSaveState('');
  }
  const updateExtra = (id, patch) => setExtras((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  function startEdit(l, field) {
    const raw = field === 'qty' ? l.qty : field === 'rate' ? l.rate : field === 'wastagePct' ? l.wastagePct * 100 : l.total;
    setEditing({ id: l.id, field, extra: !!l.extra, value: String(+Number(raw).toFixed(field === 'total' ? 2 : 4)), reason: overrides[l.id]?.reason ?? '' });
  }
  function commitEdit() {
    const v = parseFloat(editing.value);
    if (Number.isNaN(v)) return;
    // A line you added is edited directly; there is nothing to override.
    if (editing.extra) { updateExtra(editing.id, { amount: v }); setEditing(null); return; }
    if (!editing.reason.trim()) return;
    const prev = overrides[editing.id] ?? {};
    const value = editing.field === 'wastagePct' ? v / 100 : v;
    setOverride(editing.id, { ...prev, [editing.field]: value, reason: editing.reason.trim(), by: user, at: new Date().toISOString() });
    setEditing(null);
  }
  const edit = (l, field, content, title) =>
    editing?.id === l.id && editing.field === field
      ? <EditCell editing={editing} setEditing={setEditing} commit={commitEdit} />
      : <button className="cw-edit" onClick={() => startEdit(l, field)} title={title}>{content}</button>;

  function addLine() {
    const amount = parseFloat(adding.amount);
    if (!adding.label.trim() || Number.isNaN(amount)) return;
    setExtras((xs) => [...xs, { id: `extra-${Date.now().toString(36)}`, section: adding.section, label: adding.label.trim(), amount }]);
    setAdding(null);
  }

  // ---- saved costings
  function open(id) {
    const c = costings.find((x) => x.id === id);
    if (!c || !CALCULATORS.some((k) => k.id === c.calculatorId)) { setCurrent({ id: '', name: '', jobId: '' }); return; }
    setCalcId(c.calculatorId);
    setInputsById((s) => ({ ...s, [c.calculatorId]: c.inputs ?? {} }));
    setOverridesById((s) => ({ ...s, [c.calculatorId]: c.overrides ?? {} }));
    setExtrasById((s) => ({ ...s, [c.calculatorId]: c.extras ?? [] }));
    setCurrent({ id: c.id, name: c.name, jobId: c.jobId ?? '' });
    setEditing(null);
    setSaveState('');
  }
  async function save() {
    if (!onSaveCosting) return;
    if (!current.name.trim()) { setSaveState('Not saved: give the costing a name'); return; }
    setSaveState('saving');
    try {
      const s = run.summary;
      const saved = await onSaveCosting({
        id: current.id || undefined, name: current.name.trim(), jobId: current.jobId.trim(),
        calculatorId: calcId, inputs, overrides, extras,
        summary: { sell: s.sell, totalCost: s.totalCost, sellPerUnit: s.sellPerUnit, costPerUnit: s.costPerUnit, marginPct: s.marginPct, basis: s.basis },
      });
      if (saved?.id) setCurrent((c) => ({ ...c, id: saved.id }));
      setSaveState('saved');
    } catch (e) { setSaveState(`Not saved: ${e.message}`); }
  }
  async function removeCosting() {
    if (!current.id || !window.confirm(`Delete the saved costing “${current.name}”?`)) return;
    setSaveState('saving');
    try { await onRemoveCosting(current.id); setCurrent({ id: '', name: '', jobId: '' }); setSaveState(''); }
    catch (e) { setSaveState(`Not saved: ${e.message}`); }
  }

  // ---- order prices
  const newestFor = useMemo(() => {
    const m = new Map();
    for (const p of prices) { const c = m.get(p.priceKey); if (!c || p.orderedAt >= c.orderedAt) m.set(p.priceKey, p); }
    return m;
  }, [prices]);
  function openPriceForm(form) { setPriceForm(form); setPriceMsg(''); setTimeout(() => priceRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0); }
  function priceForLine(l) {
    const have = newestFor.get(l.priceKey);
    openPriceForm(have ? { ...blankPrice(have.priceKey, have.rate, have.unit), id: have.id, supplier: have.supplier ?? '', orderId: have.orderId === 'manual' ? '' : have.orderId ?? '', orderedAt: have.orderedAt }
      : blankPrice(l.priceKey, +Number(l.rate).toFixed(4), l.unit));
  }
  async function savePrice() {
    const rate = parseFloat(priceForm.rate);
    if (!priceForm.priceKey.trim() || !(rate > 0)) { setPriceMsg('Pick the item and enter a price above zero.'); return; }
    setBusy(true); setPriceMsg('');
    try {
      await onSavePrice({ ...priceForm, priceKey: priceForm.priceKey.trim(), rate });
      setPriceForm(null);
    } catch (e) { setPriceMsg(e.message); }
    setBusy(false);
  }
  async function removePrice(p) {
    if (!window.confirm(`Remove the order price for ${p.priceKey}?`)) return;
    setBusy(true); setPriceMsg('');
    try { await onRemovePrice(p.id); if (priceForm?.id === p.id) setPriceForm(null); } catch (e) { setPriceMsg(e.message); }
    setBusy(false);
  }

  const families = [...new Set(CALCULATORS.map((c) => c.family))];
  const groups = [...new Set(calc.inputs.map((i) => i.group))];
  const s = run.summary;
  const usedKeys = new Set((run.lines ?? []).map((l) => l.priceKey).filter(Boolean));
  const knownKeys = [...new Set([...usedKeys, ...MATERIAL_KEYS])];
  const sortedPrices = [...prices].sort((a, b) => (usedKeys.has(b.priceKey) - usedKeys.has(a.priceKey)) || (b.orderedAt > a.orderedAt ? 1 : -1));
  const savedList = [...costings].sort((a, b) => ((b.updatedAt ?? '') > (a.updatedAt ?? '') ? 1 : -1));
  const canSavePrices = canEdit && !!onSavePrice;

  return (
    <div className="cw">
      <nav className="cw-rail" aria-label="Costing templates">
        <label className="cw-rail-select">
          <span>Template</span>
          <select value={calcId} onChange={(e) => setCalcId(e.target.value)}>
            {CALCULATORS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {families.map((f) => (
          <div key={f} className="cw-family">
            <h3>{f}</h3>
            {CALCULATORS.filter((c) => c.family === f).map((c) => {
              const n = Object.keys(overridesById[c.id] ?? {}).length;
              return (
                <button key={c.id} className={c.id === calcId ? 'is-active' : ''} onClick={() => setCalcId(c.id)}>
                  {c.name}{n > 0 && <span className="cw-dot" title={`${n} override${n > 1 ? 's' : ''}`}>{n}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <section className="cw-inputs" aria-label="Inputs">
        <header>
          <h2>{calc.name}</h2>
          <p>{calc.description}</p>
          <p className="cw-src">From {calc.sourceFile}</p>
          {calc.presets?.length > 0 && (
            <div className="cw-presets">
              {calc.presets.map((p) => <button key={p.name} onClick={() => setInput(p.values)}>{p.name}</button>)}
            </div>
          )}
        </header>
        {groups.map((g) => (
          <fieldset key={g}>
            <legend>{g}</legend>
            {calc.inputs.filter((i) => i.group === g && (!i.visible || i.visible(inputs))).map((spec) => (
              <Field key={spec.key} spec={spec} value={inputs[spec.key]} inputs={inputs} onChange={(v) => setInput({ [spec.key]: v })} />
            ))}
          </fieldset>
        ))}
        <button className="cw-reset" onClick={() => {
          setInputsById((x) => ({ ...x, [calcId]: {} })); setOverridesById((x) => ({ ...x, [calcId]: {} })); setExtrasById((x) => ({ ...x, [calcId]: [] }));
          setCurrent({ id: '', name: '', jobId: '' }); setEditing(null); setAdding(null); setSaveState('');
        }}>
          Clear inputs, changes and added lines
        </button>
      </section>

      <section className="cw-sheet" aria-label="Costing">
        {onSaveCosting && (
          <div className="cw-saved">
            <label>
              <span>Saved costings</span>
              <select value={current.id} onChange={(e) => (e.target.value ? open(e.target.value) : setCurrent({ id: '', name: '', jobId: '' }))}>
                <option value="">New costing</option>
                {savedList.map((c) => <option key={c.id} value={c.id}>{c.name}{c.jobId ? ` · ${c.jobId}` : ''} — {CALCULATORS.find((k) => k.id === c.calculatorId)?.name ?? c.calculatorId}</option>)}
              </select>
            </label>
            <label><span>Name</span>
              <input type="text" value={current.name} placeholder="e.g. Level 3 ceiling" onChange={(e) => { setCurrent({ ...current, name: e.target.value }); setSaveState(''); }} />
            </label>
            <label><span>Job no.</span>
              <input type="text" value={current.jobId} placeholder="optional" onChange={(e) => setCurrent({ ...current, jobId: e.target.value })} />
            </label>
            <button className="cw-save" onClick={save} disabled={!canEdit || saveState === 'saving' || !!saveNote} title={saveNote || (canEdit ? '' : 'Saving needs Money: Edit')}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : current.id ? 'Update costing' : 'Save costing'}
            </button>
            {current.id && canEdit && <button className="cw-undo" onClick={removeCosting}>Delete</button>}
            {saveNote && <small className="cw-error">{saveNote}</small>}
            {!saveNote && !canEdit && <small>Saving needs Money: Edit.</small>}
            {saveState.startsWith('Not saved') && <small className="cw-error">{saveState}</small>}
          </div>
        )}

        {run.error ? <p className="cw-error">This combination can’t be costed: {run.error}</p> : <>
          <div className="cw-totals">
            <div className="cw-sell">
              <span>Sell per {s.basis.label}</span>
              <strong>{s.sellPerUnit == null ? 'Set a margin' : money(s.sellPerUnit)}</strong>
            </div>
            <dl>
              <div><dt>Cost per {s.basis.label}</dt><dd>{money(s.costPerUnit)}</dd></div>
              <div><dt>Total cost</dt><dd>{money(s.totalCost)}</dd></div>
              <div><dt>Project sell</dt><dd>{money(s.sell)}</dd></div>
              <div><dt>Margin</dt><dd>{s.marginPct == null ? '—' : `${num(s.marginPct * 100, 1)}%`}</dd></div>
              {s.labourHours != null && <div><dt>Labour hours</dt><dd>{num(s.labourHours, 1)}</dd></div>}
              {s.headline?.map((h) => <div key={h.label}><dt>{h.label}</dt><dd>{h.label.includes('hours') ? num(h.value, 1) : money(h.value)}</dd></div>)}
            </dl>
            <Split s={s} />
          </div>

          {run.warnings.length > 0 && (
            <ul className="cw-warnings">{run.warnings.map((w, k) => <li key={k} className={`is-${w.level}`}>{w.message}</li>)}</ul>
          )}

          {['material', 'labour'].map((section) => {
            const rows = run.lines.filter((l) => l.section === section);
            if (!rows.length) return null;
            return (
              <div key={section} className="cw-block">
              <h4 className="cw-block-head">{section === 'material' ? 'Materials' : 'Labour'}<span>{money(section === 'material' ? s.materialCost : s.labourCost)}</span></h4>
              <table className="cw-lines">
                <colgroup><col /><col className="c-qty" /><col className="c-rate" /><col className="c-waste" /><col className="c-src" /><col className="c-total" /><col className="c-act" /></colgroup>
                <thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Waste</th><th>Source</th><th className="n">Total</th><th /></tr></thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} className={[l.enabled ? '' : 'is-off', l.override ? 'is-overridden' : '', l.extra ? 'is-added' : ''].join(' ')}>
                      <td>
                        <label className="cw-item">
                          <input type="checkbox" checked={l.enabled}
                            onChange={(e) => l.extra
                              ? updateExtra(l.id, { enabled: e.target.checked })
                              : setOverride(l.id, { ...overrides[l.id], enabled: e.target.checked, reason: overrides[l.id]?.reason || (e.target.checked ? 'Line switched on' : 'Line switched off'), by: user, at: new Date().toISOString() })} />
                          <span><b>{l.label}</b>{l.description && <small>{l.description}</small>}{l.override && <small className="cw-why">{l.override.reason}{l.override.by && ` — ${l.override.by}`}</small>}</span>
                        </label>
                      </td>
                      <td className="n">
                        {l.extra ? <>1 <span className="cw-unit">item</span></> : <>
                          {edit(l, 'qty', num(l.qty, 3), 'Override quantity')} <span className="cw-unit">{l.unit}</span>
                          {l.override?.fields.includes('qty') && <small className="cw-was">was {num(l.original.qty, 3)}</small>}
                        </>}
                      </td>
                      <td className="n">
                        {l.extra ? money(l.rate) : <>
                          {edit(l, 'rate', money(l.rate, l.rate < 10 ? 3 : 2), 'Override rate')}
                          {l.override?.fields.includes('rate') && <small className="cw-was">was {money(l.original.rate)}</small>}
                          {l.setup > 0 && <small>+ setup {money(l.setup)}</small>}
                        </>}
                      </td>
                      <td className="n">{l.extra ? '—' : edit(l, 'wastagePct', l.wastagePct ? `${num(l.wastagePct * 100, 1)}%` : '—', 'Override wastage')}</td>
                      <td>
                        <span className={`cw-badge is-${l.rateSource}`} title={[SOURCE[l.rateSource].title, l.note].filter(Boolean).join('\n')}>{SOURCE[l.rateSource].label}</span>
                        {l.priceKey && canSavePrices && !l.extra && (
                          <button className="cw-undo" onClick={() => priceForLine(l)} title="Type in the price from a material order, or update the one already saved">
                            {newestFor.has(l.priceKey) ? 'Update price' : 'Order price'}
                          </button>
                        )}
                      </td>
                      <td className="n">{edit(l, 'total', money(l.total), l.extra ? 'Change amount' : 'Override line total')}</td>
                      <td>
                        {l.extra
                          ? <button className="cw-undo" onClick={() => setExtras((xs) => xs.filter((x) => x.id !== l.id))} title="Remove this line">Remove</button>
                          : l.override && <button className="cw-undo" onClick={() => setOverride(l.id, null)} title="Remove override">Reset</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            );
          })}

          <div className="cw-addline">
            {adding ? (
              <div className="cw-editor cw-addform" onKeyDown={(e) => { if (e.key === 'Enter') addLine(); if (e.key === 'Escape') setAdding(null); }}>
                <select aria-label="Section" value={adding.section} onChange={(e) => setAdding({ ...adding, section: e.target.value })}>
                  <option value="material">Materials</option><option value="labour">Labour</option>
                </select>
                <input autoFocus type="text" placeholder="What is it?" aria-label="Description" value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} />
                <input type="number" step="any" placeholder="Amount $" aria-label="Amount" value={adding.amount} onChange={(e) => setAdding({ ...adding, amount: e.target.value })} />
                <span><button type="button" onClick={addLine} disabled={!adding.label.trim() || Number.isNaN(parseFloat(adding.amount))}>Add</button><button type="button" onClick={() => setAdding(null)}>Cancel</button></span>
              </div>
            ) : <button className="cw-reset" onClick={() => setAdding({ section: 'material', label: '', amount: '' })}>+ Add a line</button>}
          </div>

          <table className="cw-lines cw-adj" style={{ marginTop: 22 }}>
            <tbody>
              {s.adjustments.map((a) => <tr key={a.id}><td>{a.label}{a.note && <small> {a.note}</small>}</td><td className="n">{money(a.amount)}</td></tr>)}
              <tr className="cw-grand"><td>Total cost</td><td className="n">{money(s.totalCost)}</td></tr>
              {s.sell != null && <tr className="cw-grand"><td>Sell at {num(s.marginPct * 100, 1)}% margin</td><td className="n">{money(s.sell)}</td></tr>}
            </tbody>
          </table>

          <footer className="cw-foot">
            <span>{run.overrideCount ? `${run.overrideCount} change${run.overrideCount > 1 ? 's' : ''} on this costing` : 'No changes'}</span>
            {extras.length > 0 && <span>{extras.length} line{extras.length > 1 ? 's' : ''} added</span>}
            <span>Labour {money(settings?.labourRate ?? 175, 0)}/hr</span>
            <span>Overheads {num((settings?.overheadPct ?? 0.125) * 100, 1)}%</span>
          </footer>
        </>}

        {onSavePrice && (
          <div className="cw-prices" ref={priceRef}>
            <h4 className="cw-block-head">Order prices<span className="cw-unit">{prices.length} saved</span></h4>
            <p className="cw-hint">
              Prices typed in from material orders. The newest price for an item replaces the price list on every costing, and shows here as <i>Order</i>.
              Change one by editing it; to record a new order, add another price with the new date.
            </p>
            {priceForm && (
              <div className="cw-pform" onKeyDown={(e) => { if (e.key === 'Escape') setPriceForm(null); }}>
                <label className="wide"><span>Item</span>
                  <input list="cw-keys" type="text" value={priceForm.priceKey} placeholder="Start typing a material…" disabled={!!priceForm.id}
                    onChange={(e) => setPriceForm({ ...priceForm, priceKey: e.target.value })} />
                </label>
                <label><span>Price $</span><input type="number" step="any" value={priceForm.rate} onChange={(e) => setPriceForm({ ...priceForm, rate: e.target.value })} /></label>
                <label><span>Per</span><input type="text" value={priceForm.unit} placeholder="m², LM, ea" onChange={(e) => setPriceForm({ ...priceForm, unit: e.target.value })} /></label>
                <label><span>Supplier</span><input type="text" value={priceForm.supplier} onChange={(e) => setPriceForm({ ...priceForm, supplier: e.target.value })} /></label>
                <label><span>Order ref</span><input type="text" value={priceForm.orderId} placeholder="PO / order no." onChange={(e) => setPriceForm({ ...priceForm, orderId: e.target.value })} /></label>
                <label><span>Ordered</span><input type="date" value={priceForm.orderedAt} onChange={(e) => setPriceForm({ ...priceForm, orderedAt: e.target.value })} /></label>
                <span className="cw-pbtns">
                  <button type="button" className="cw-save" onClick={savePrice} disabled={busy}>{busy ? 'Saving…' : priceForm.id ? 'Update price' : 'Save price'}</button>
                  <button type="button" onClick={() => setPriceForm(null)}>Cancel</button>
                </span>
                {priceMsg && <small className="cw-error wide">{priceMsg}</small>}
                <datalist id="cw-keys">{knownKeys.map((k) => <option key={k} value={k} />)}</datalist>
              </div>
            )}
            {!priceForm && priceMsg && <p className="cw-error">{priceMsg}</p>}
            {sortedPrices.length > 0 && (
              <table className="cw-lines cw-ptable">
                <thead><tr><th>Item</th><th className="n">Price</th><th>Supplier</th><th>Order</th><th>Date</th><th /></tr></thead>
                <tbody>
                  {sortedPrices.map((p) => (
                    <tr key={p.id} className={newestFor.get(p.priceKey)?.id === p.id ? '' : 'is-off'}>
                      <td>{p.priceKey}{usedKeys.has(p.priceKey) && <span className="cw-badge is-order" style={{ marginLeft: 6 }}>on this sheet</span>}
                        {newestFor.get(p.priceKey)?.id !== p.id && <small>Superseded by a newer order</small>}</td>
                      <td className="n">{money(p.rate, p.rate < 10 ? 3 : 2)}{p.unit && <span className="cw-unit"> / {p.unit}</span>}</td>
                      <td>{p.supplier || '—'}</td>
                      <td>{p.orderId && p.orderId !== 'manual' ? p.orderId : '—'}</td>
                      <td>{p.orderedAt}</td>
                      <td className="n">{canSavePrices && <>
                        <button className="cw-undo" onClick={() => openPriceForm({ ...blankPrice(p.priceKey, p.rate, p.unit ?? ''), id: p.id, supplier: p.supplier ?? '', orderId: p.orderId === 'manual' ? '' : p.orderId ?? '', orderedAt: p.orderedAt })}>Edit</button>{' '}
                        <button className="cw-undo" onClick={() => removePrice(p)}>Remove</button></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canSavePrices && !priceForm && <button className="cw-reset" onClick={() => openPriceForm(blankPrice())}>+ Add an order price</button>}
            {!canSavePrices && <p className="cw-hint">{saveNote || 'Adding and changing prices needs Money: Edit.'}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ spec, value, inputs, onChange }) {
  const id = `cw-${spec.key}`;
  let control;
  if (spec.type === 'select') {
    const o = opts(spec, inputs);
    control = (
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {o.map((x) => <option key={x} value={x}>{x === '' ? 'None' : x}</option>)}
      </select>
    );
  } else if (spec.type === 'text') {
    control = <input id={id} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  } else {
    const pct = spec.type === 'percent';
    const shown = value == null ? '' : pct ? +(value * 100).toFixed(4) : value;
    control = (
      <span className="cw-num">
        <input id={id} type="number" inputMode="decimal" step={spec.step ?? 'any'} value={shown}
          placeholder={value == null ? 'auto' : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(null);
            const v = parseFloat(raw);
            if (!Number.isNaN(v)) onChange(pct ? v / 100 : v);
          }} />
        <small>{pct ? '%' : spec.unit}</small>
      </span>
    );
  }
  return (
    <div className="cw-field">
      <label htmlFor={id}>{spec.label}</label>
      {control}
      {spec.help && <p className="cw-help">{spec.help}</p>}
    </div>
  );
}

function EditCell({ editing, setEditing, commit }) {
  const valid = !Number.isNaN(parseFloat(editing.value));
  const ok = valid && (editing.extra || editing.reason.trim());
  return (
    <div className="cw-editor" onKeyDown={(e) => { if (e.key === 'Enter' && ok) commit(); if (e.key === 'Escape') setEditing(null); }}>
      <input autoFocus type="number" step="any" aria-label={editing.field === 'wastagePct' ? 'New waste, percent' : 'New value'} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
      {!editing.extra && <input type="text" placeholder="Reason (required)" aria-label="Reason for override" value={editing.reason}
        onChange={(e) => setEditing({ ...editing, reason: e.target.value })} />}
      <span><button type="button" onClick={commit} disabled={!ok}>Apply</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></span>
    </div>
  );
}

function Split({ s }) {
  const adj = s.adjustments.reduce((a, b) => a + b.amount, 0);
  const margin = s.sell != null ? s.sell - s.totalCost : 0;
  const whole = s.materialCost + s.labourCost + adj + margin || 1;
  const parts = [['Materials', s.materialCost, 'm'], ['Labour', s.labourCost, 'l'], ['Overheads & loadings', adj, 'a'], ['Margin', margin, 'g']].filter((p) => p[1] > 0);
  return (
    <div className="cw-split">
      <div className="cw-bar">{parts.map(([k, v, c]) => <span key={k} className={`is-${c}`} style={{ flexGrow: v / whole }} title={`${k} ${money(v)}`} />)}</div>
      <ul>{parts.map(([k, v, c]) => <li key={k}><i className={`is-${c}`} />{k} <b>{num((v / whole) * 100, 0)}%</b></li>)}</ul>
    </div>
  );
}
