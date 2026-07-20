import type { Field, Report } from '../types.js';
import { GROUPS, ALL_FIELDS, NUMERIC_KEYS } from '../constants.js';
import { state, save, sessionValid } from '../state.js';
import { LS } from '../env.js';
import { app, render } from '../render.js';
import { todayISO, monthKeyOf, parseISO, pad } from '../dateUtils.js';
import { esc, byId, informed, haptic, numOrNull } from '../format.js';
import { metaFor, metaDiaVal } from '../aggregations.js';
import { isOnline, getReport, enqueue, upsertCache, apiSave, deleteReportByDate } from '../api.js';
import { sharePDF } from '../pdf.js';
import { toast } from '../ui.js';

/* ---------------- SCREEN: REPORT FORM ---------------- */
export function openForm(dataISO: string) {
  const existing = getReport(dataISO);
  state.editing = existing || blankReport(dataISO);
  state.editingNew = !existing;
  state.view = 'form';
  render();
  window.scrollTo(0, 0);
}

// Always starts blank (zeroed out), title "New".
export function openNew() {
  state.editing = blankReport(todayISO());
  state.editingNew = true;
  state.view = 'form';
  render();
  window.scrollTo(0, 0);
}

function blankReport(dataISO: string): Report {
  const r: Report = {
    data: dataISO,
    promotora: state.config.promotora,
    loja: state.config.loja,
    metaMes: metaFor(monthKeyOf(dataISO)),
    obs: '',
  };
  // A new report starts with every field NOT INFORMED (N/A), not 0. Typing 0 is a
  // deliberate choice; leaving a field untouched keeps it N/A.
  NUMERIC_KEYS.forEach(k => r[k] = null);
  return r;
}

export function renderForm() {
  const r = state.editing as Report;
  const groupsHTML = GROUPS.map(g => `
    <div class="group">
      <h2><span>${g.emoji}</span> ${g.title}</h2>
      ${g.fields.map(f => counterHTML(f, r[f.key])).join('')}
    </div>`).join('');

  app.innerHTML = `
    <header class="appbar">
      <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
      <div style="flex:1">
        <h1>${state.editingNew ? 'Novo' : 'Editar'} Relatório</h1>
        <span class="sub">${esc(state.config.promotora)} · ${esc(state.config.loja)}</span>
      </div>
      ${!state.editingNew ? '<button class="iconbtn" id="btn-del" aria-label="Excluir">🗑️</button>' : ''}
    </header>

    <div class="screen">
      <div class="form-head">
        <div class="form-date">
          <label for="f-data">Data do relatório</label>
          <input id="f-data" type="date" value="${esc(r.data)}" max="${todayISO()}" />
        </div>
      </div>

      ${groupsHTML}

      <div class="group obs">
        <h2><span>🗒️</span> Observações</h2>
        <textarea id="f-obs" placeholder="Alguma observação do dia (opcional)">${esc(r.obs || '')}</textarea>
      </div>

      <button type="button" class="pdf-btn" id="btn-pdf">📄 Gerar PDF para WhatsApp</button>
    </div>

    <div class="savebar">
      <button class="btn-ghost" id="btn-cancel">Cancelar</button>
      <button class="btn-save" id="btn-save">💾 Salvar relatório</button>
    </div>
  `;

  // eventos gerais
  byId('btn-back').onclick = byId('btn-cancel').onclick = () => { state.view = 'list'; render(); };
  byId('f-data').onchange = (e: Event) => { r.data = (e.target as HTMLInputElement).value; };
  byId('f-obs').oninput = (e: Event) => { r.obs = (e.target as HTMLTextAreaElement).value; };
  byId('btn-save').onclick = onSave;
  byId('btn-pdf').onclick = () => sharePDF(Object.assign({}, r));
  if (byId('btn-del')) byId('btn-del').onclick = onDelete;

  // liga os contadores
  ALL_FIELDS.forEach(f => wireCounter(f, r));
}

async function onDelete() {
  const r = state.editing as Report;
  if (!getReport(r.data)) { state.view = 'list'; render(); return; }
  const btn = byId('btn-del');
  if (btn) btn.disabled = true;
  const ok = await deleteReportByDate(r.data);
  if (ok) {
    state.view = 'list';
    render();
    toast('Relatório excluído', 'ok');
  } else if (btn) {
    btn.disabled = false;
  }
}

/* Quick buttons: always 3 COMPLETE rows. How many columns fit depends on the screen —
   on a phone it's 5 (0-4 / 5-9 / 10-14); larger screens fit more tiles, keeping the
   same minimum width. */
const QUICK_MIN_W = 58;   // minimum tile width on large screens (px)
const QUICK_GAP = 7;      // grid gap (px)
const QUICK_ROWS = 3;
const PHONE_MAX = 600;    // up to this width counts as "phone"
export function quickCols(): number {
  const appW = Math.min(window.innerWidth || 360, 640); // #app has max-width 640
  // Phone: always 5 columns → 0-4 / 5-9 / 10-14 (wider tiles)
  if (appW < PHONE_MAX) return 5;
  // Larger screens: more tiles fit, keeping the same minimum width
  const inner = Math.max(240, appW - 58);               // screen + card paddings
  const cols = Math.floor((inner + QUICK_GAP) / (QUICK_MIN_W + QUICK_GAP));
  return Math.max(5, Math.min(10, cols));
}

function counterHTML(f: Field, val: any): string {
  const cols = quickCols();
  const maxN = cols * QUICK_ROWS - 1;   // ex.: 5 colunas → 0..14
  const na = !informed(val);            // N/A when the value isn't a number
  const quick: string[] = [];
  for (let n = 0; n <= maxN; n++) {
    quick.push(`<button type="button" data-q="${f.key}" data-n="${n}" class="${val === n ? 'active' : ''}">${n}</button>`);
  }
  return `
    <div class="counter" id="counter-${f.key}">
      <div class="top">
        <div class="name"><span class="emoji">${f.emoji}</span> ${f.label}</div>
        <div class="stepper">
          <button type="button" class="minus" data-step="${f.key}" data-d="-1">−</button>
          <input class="val-input ${na ? 'na' : ''}" id="val-${f.key}" type="text"
            inputmode="numeric" pattern="[0-9]*" placeholder="—" aria-label="${f.label}"
            value="${informed(val) ? val : ''}" />
          <button type="button" class="plus" data-step="${f.key}" data-d="1">＋</button>
        </div>
      </div>
      <div class="quick" style="grid-template-columns: repeat(${cols}, 1fr)">${quick.join('')}</div>
      ${f.dailyMeta ? `<div class="daily-hint ${informed(val) && val >= metaDiaVal() ? 'hit' : ''}" id="dhint-${f.key}">${dailyHintText(val)}</div>` : ''}
    </div>`;
}

function dailyHintText(val: any): string {
  const md = metaDiaVal();
  if (!informed(val)) return `🎯 Meta do dia: — / ${md}`;
  return val >= md ? `🎯 Meta do dia batida! (${val}/${md})` : `🎯 Meta do dia: ${val} / ${md}`;
}

function wireCounter(f: Field, r: Report) {
  const container = byId('counter-' + f.key);
  const input = byId('val-' + f.key);

  // Refreshes the highlights (quick buttons, daily goal) from state — without touching
  // the input's text, so it doesn't fight the cursor while the person is typing.
  function reflect() {
    const v = r[f.key];
    const na = !informed(v);
    input.classList.toggle('na', na);
    container.querySelectorAll('.quick button').forEach((b: Element) => {
      b.classList.toggle('active', !na && Number(b.getAttribute('data-n')) === v);
    });
    if (f.dailyMeta) {
      const dh = byId('dhint-' + f.key);
      if (dh) { dh.textContent = dailyHintText(v); dh.classList.toggle('hit', informed(v) && (v as number) >= metaDiaVal()); }
    }
  }
  // n === null => N/A; a number => that value. Also writes the input (buttons/steppers use this).
  function set(n: number | null) {
    r[f.key] = (n === null) ? null : Math.max(0, n);
    input.value = (r[f.key] === null) ? '' : String(r[f.key]);
    reflect();
  }

  // Free typing: digits only; clearing it all = N/A (null). Doesn't rewrite the input here.
  input.oninput = () => {
    const digits = input.value.replace(/\D/g, '');
    if (digits !== input.value) input.value = digits;   // strip any non-numeric character
    r[f.key] = digits === '' ? null : parseInt(digits, 10);
    reflect();
  };

  container.querySelectorAll('.quick button').forEach((b: Element) => {
    (b as HTMLElement).onclick = () => {
      const n = Number(b.getAttribute('data-n'));
      // Tapping the already-selected number again deselects it (back to N/A).
      set(r[f.key] === n ? null : n);
      haptic();
    };
  });
  container.querySelectorAll('[data-step]').forEach((b: Element) => {
    (b as HTMLElement).onclick = () => {
      const d = Number(b.getAttribute('data-d'));
      const cur = r[f.key] as number | null;
      // ＋ from N/A starts at 0; − at 0 (or at N/A) goes back to N/A.
      if (!informed(cur)) set(d > 0 ? 0 : null);
      else set(cur + d < 0 ? null : cur + d);
      haptic();
    };
  });
}

async function onSave() {
  const r = state.editing as Report;
  if (!r.data) { toast('Escolha a data', 'err'); return; }
  // New report for a day that already has one → confirm before overwriting.
  if (state.editingNew && getReport(r.data)) {
    const dd = parseISO(r.data);
    if (!window.confirm('Já existe um relatório para ' + pad(dd.getDate()) + '/' + pad(dd.getMonth() + 1) + '/' + dd.getFullYear() + '.\nSubstituir?')) return;
  }
  r.promotora = state.config.promotora;
  r.loja = state.config.loja;
  r.metaMes = metaFor(monthKeyOf(r.data));
  NUMERIC_KEYS.forEach(k => r[k] = numOrNull(r[k]));   // preserves N/A (doesn't force 0)

  const btn = byId('btn-save');
  btn.disabled = true; btn.textContent = 'Salvando...';

  // 1) store locally right away (never loses data)
  enqueue(Object.assign({}, r));
  // also updates the cache so it shows up in the list already visually synced
  upsertCache(r);

  // 2) try to send it to the server (Neon)
  let sent = false;
  if (isOnline() && sessionValid()) {
    try {
      await apiSave(r);
      state.queue = state.queue.filter(x => x.data !== r.data);
      save(LS.queue, state.queue);
      sent = true;
    } catch (e) { sent = false; }
  }

  state.view = 'list';
  state.month = monthKeyOf(r.data);
  render();
  toast(sent ? 'Relatório salvo no servidor ✓'
             : 'Salvo no celular — envia quando tiver internet ⏳',
        sent ? 'ok' : '');
}
