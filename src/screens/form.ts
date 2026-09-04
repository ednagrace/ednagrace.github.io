import type { Field, Report } from '../types.js';
import { GROUPS, ALL_FIELDS, NUMERIC_KEYS, PROPOSTAS_KEYS,
  PJ_PROPOSTAS_FIELDS, PJ_NUMERIC_KEYS, ALL_NUMERIC_KEYS } from '../constants.js';
import { state, save, sessionValid } from '../state.js';
import { LS } from '../env.js';
import { app, render, goHome } from '../render.js';
import { todayISO, monthKeyOf, parseISO, pad } from '../dateUtils.js';
import { esc, byId, informed, haptic, numOrNull } from '../format.js';
import { metaFor, metaDiaVal } from '../aggregations.js';
import { isOnline, getReport, enqueue, upsertCache, apiSave, deleteReportByDate } from '../api.js';
import { aiPhotoMeta, sendPhotoReport, setAiQuota } from '../api.js';
import { downscalePhoto, wirePhotoPicker } from '../photo.js';
import { sharePDF } from '../pdf.js';
import { toast, confirmDiscard } from '../ui.js';

/* ---------------- SCREEN: REPORT FORM ---------------- */
// Snapshot of the report as it was when the form opened, so "Voltar"/"Cancelar" can
// tell whether anything was typed before asking to discard it.
let editSnapshot = '';

// Aba de cartão ativa no formulário (só aparece quando a métrica PJ está ligada nas
// Configurações). Estado só de tela — não persiste no relatório.
let formTab: 'comum' | 'pj' = 'comum';
function pjTabOn(): boolean { return !!state.config.metaPJAtiva; }

export function openForm(dataISO: string) {
  const existing = getReport(dataISO);
  state.editing = existing || blankReport(dataISO);
  state.editingNew = !existing;
  formTab = 'comum';
  editSnapshot = JSON.stringify(state.editing);
  state.view = 'form';
  resetPhoto();
  render();
  window.scrollTo(0, 0);
}

// Always starts blank (zeroed out), title "New".
export function openNew() {
  state.editing = blankReport(todayISO());
  state.editingNew = true;
  formTab = 'comum';
  editSnapshot = JSON.stringify(state.editing);
  state.view = 'form';
  resetPhoto();
  render();
  window.scrollTo(0, 0);
}

// True while the form holds something that isn't on the server yet: a brand-new
// report, or edits to an existing one that haven't been saved.
function formDirty(): boolean {
  return JSON.stringify(state.editing) !== editSnapshot;
}

// "Voltar"/"Cancelar" and the phone's back button all land here.
export function formBack() {
  if (!confirmDiscard(formDirty())) return;
  state.view = 'list';
  render();
}

// May we leave the form right now? (HOME button / deep link) — only after the
// same "discard what you typed?" check the back button does.
export function formCanLeave(): boolean {
  return confirmDiscard(formDirty());
}

// The PDF is built from what's on screen, so it only makes sense once that has
// been saved. Until then the button stays disabled with a hint.
function refreshPdfBtn() {
  const btn = byId('btn-pdf') as HTMLButtonElement | null;
  if (!btn) return;
  const locked = state.editingNew || formDirty();
  btn.disabled = locked;
  const hint = byId('pdf-hint');
  if (hint) hint.hidden = !locked;
}

/* ---------- "Preencher com uma foto" (leitura por IA, dentro do form) ----------
   O próprio formulário é a tela de rascunho: a foto preenche os contadores e a
   promotora confere/corrige ali mesmo antes de salvar. Nada é gravado aqui.
   No ambiente de teste, a feature é só do administrador — e só ele vê e mexe no
   liga/desliga da cota. O back-end também barra (não confia só no front). */
function resetPhoto() {
  state.photo = { busy: false, meta: null, error: '' };
  aiPhotoMeta().then((m) => {
    if (state.view === 'form') { state.photo.meta = m; refreshPhotoBar(); }
  });
}

function photoBarHTML(): string {
  const p = state.photo;
  const m = p.meta;

  // Ambiente de teste + não-admin: a feature nem aparece.
  if (m && !m.allowed) {
    return '<div class="ph-hint">📸 Leitura por foto indisponível no ambiente de teste.</div>';
  }

  const u = m && m.usage;
  const quotaOn = !m || m.quotaEnabled;
  const blocked = !!u && quotaOn && !u.podeUsar;

  let cota = '';
  if (m && !quotaOn) {
    cota = '<span class="ph-cota warn">Cota desligada (teste)</span>';
  } else if (u) {
    cota = blocked
      ? '<span class="ph-cota warn">Limite atingido — a cota zera na segunda-feira</span>'
      : `<span class="ph-cota">resta ${Math.max(0, u.limiteDia - u.dia)} hoje · ${Math.max(0, u.limiteSemana - u.semana)} na semana</span>`;
  }

  const toggle = (m && m.canToggleQuota)
    ? `<button type="button" class="ph-toggle" id="ph-toggle">Cota: <b>${m.quotaEnabled ? 'ligada' : 'desligada'}</b> · ${m.quotaEnabled ? 'desligar' : 'ligar'}</button>`
    : '';

  // Dois botões explícitos: câmera e galeria. Deixar o sistema "escolher" (input
  // sem capture) abre direto a galeria em vários aparelhos — aqui a promotora
  // decide. Enquanto lê a foto, vira um único botão desabilitado.
  const acoes = p.busy
    ? `<button type="button" class="pdf-btn ph-btn" disabled>⏳ Lendo a foto…</button>`
    : `<div class="ph-actions">
         <button type="button" class="pdf-btn ph-btn" id="btn-photo-cam" ${blocked ? 'disabled' : ''}>📷 Tirar foto</button>
         <button type="button" class="pdf-btn ph-btn" id="btn-photo-gallery" ${blocked ? 'disabled' : ''}>🖼️ Da galeria</button>
       </div>`;

  return `
    ${acoes}
    <div class="ph-hint">${p.error ? `<span class="warn">${esc(p.error)}</span>` : cota}</div>
    ${toggle}`;
}

// Re-renders just the photo bar (button label / quota / error) without rebuilding
// the whole form, so it doesn't fight the counters while they're being edited.
function refreshPhotoBar() {
  const bar = byId('photo-bar');
  if (!bar) return;
  bar.innerHTML = photoBarHTML();
  wirePhotoBar();
}

function wirePhotoBar() {
  wirePhotoPicker({
    camBtnId: 'btn-photo-cam', galleryBtnId: 'btn-photo-gallery', fileId: 'photo-file',
    onPick: onPhotoPicked,
  });
  const tog = byId('ph-toggle');
  if (tog) tog.onclick = onToggleQuota;
}

async function onToggleQuota() {
  const m = state.photo.meta;
  if (!m || !m.canToggleQuota) return;
  const tog = byId('ph-toggle');
  if (tog) tog.disabled = true;
  try {
    const next = await setAiQuota(!m.quotaEnabled);
    if (next) state.photo.meta = next;
    toast(next && next.quotaEnabled ? 'Cota ligada' : 'Cota desligada', 'ok');
  } catch (e: any) {
    toast(e.message || 'não foi possível alterar a cota', 'err');
  }
  refreshPhotoBar();
}

async function onPhotoPicked(f: File) {
  const p = state.photo;
  if (p.busy) return;
  if (!isOnline()) { toast('Conecte à internet para ler a foto', 'err'); return; }

  p.busy = true; p.error = '';
  refreshPhotoBar();

  try {
    const base64 = await downscalePhoto(f);
    if (!base64) throw new Error('não consegui abrir essa imagem');
    const { draft, meta } = await sendPhotoReport(base64, 'image/jpeg');
    if (meta) p.meta = meta;

    const r = state.editing as Report;
    // Preenche só os campos que a foto leu como número; o resto fica como está
    // (não apaga o que a promotora já tenha digitado).
    NUMERIC_KEYS.forEach((k) => {
      if (typeof draft[k] === 'number' && Number.isFinite(draft[k])) r[k] = draft[k];
    });
    if (!String(r.obs || '').trim() && typeof draft.obs === 'string') r.obs = draft.obs;
    // Data: só num relatório novo e se a foto trouxe uma data plausível.
    if (state.editingNew && typeof draft.data === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(draft.data) && draft.data <= todayISO()) {
      r.data = draft.data;
    }

    p.busy = false;
    formTab = 'comum';   // a foto lê o relatório comum — volta pra essa aba pra conferência
    render();   // rebuilds the counters with the values read
    window.scrollTo(0, 0);
    toast('Confira os números lidos da foto ✍️', 'ok');
  } catch (err: any) {
    p.busy = false;
    if (err && err.meta) p.meta = err.meta;
    p.error = (err && err.message) || 'não consegui ler a foto';
    refreshPhotoBar();
  }
}

// Total de propostas da aba visível: comum soma Aprovadas/Reprovadas/Em Análise;
// PJ soma só Aprovadas/Em Análise (é o que o PJ tem).
function propostasTotal(r: Report, tab: 'comum' | 'pj' = 'comum'): number {
  const keys = tab === 'pj' ? PJ_NUMERIC_KEYS : PROPOSTAS_KEYS;
  return keys.reduce((s, k) => s + (informed(r[k]) ? (r[k] as number) : 0), 0);
}

function updatePropostasBadge(r: Report) {
  const el = byId('propostas-num');
  if (el) el.textContent = String(propostasTotal(r, pjTabOn() ? formTab : 'comum'));
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
  // deliberate choice; leaving a field untouched keeps it N/A. Inclui as chaves PJ.
  ALL_NUMERIC_KEYS.forEach(k => r[k] = null);
  return r;
}

export function renderForm() {
  const r = state.editing as Report;
  const pjOn = pjTabOn();
  if (!pjOn) formTab = 'comum';

  const comumHTML = GROUPS.map(g => `
    <div class="group">
      <h2><span>${g.emoji}</span> ${g.title}</h2>
      ${g.fields.map(f => counterHTML(f, r[f.key])).join('')}
    </div>`).join('');

  // Aba PJ: só os contadores que o cartão PJ tem (Aprovadas / Em Análise).
  const pjHTML = `
    <div class="group">
      <h2><span>🏢</span> Cartão PJ</h2>
      <div class="daily-hint" style="margin:0 0 10px">Cartão PJ registra apenas propostas aprovadas e em análise.</div>
      ${PJ_PROPOSTAS_FIELDS.map(f => counterHTML(f, r[f.key])).join('')}
    </div>`;

  const groupsHTML = !pjOn ? comumHTML : `
    <div class="form-tabs" id="form-tabs" role="tablist">
      <button type="button" class="form-tab ${formTab === 'comum' ? 'active' : ''}" data-tab="comum">💳 Comum</button>
      <button type="button" class="form-tab ${formTab === 'pj' ? 'active' : ''}" data-tab="pj">🏢 Cartão PJ</button>
    </div>
    <div data-panel="comum" ${formTab === 'comum' ? '' : 'hidden'}>${comumHTML}</div>
    <div data-panel="pj" ${formTab === 'pj' ? '' : 'hidden'}>${pjHTML}</div>`;

  app.innerHTML = `
    <header class="appbar">
      <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
      <div style="flex:1">
        <h1>${state.editingNew ? 'Novo' : 'Editar'} Relatório</h1>
        <span class="sub">${esc(state.config.promotora)} · ${esc(state.config.loja)}</span>
      </div>
      <button class="iconbtn" id="btn-home" aria-label="Início">🏠</button>
      ${!state.editingNew ? '<button class="iconbtn" id="btn-del" aria-label="Excluir">🗑️</button>' : ''}
    </header>

    <div class="screen">
      <div class="form-head">
        <div class="form-date">
          <label for="f-data">Data do relatório</label>
          <input id="f-data" type="date" value="${esc(r.data)}" max="${todayISO()}" />
        </div>
        <div class="propostas-badge" id="propostas-badge">📋 <b id="propostas-num">${propostasTotal(r, pjOn ? formTab : 'comum')}</b> propostas</div>
      </div>

      <div id="photo-bar" class="photo-bar">${photoBarHTML()}</div>
      <input type="file" id="photo-file" accept="image/*" hidden />

      ${groupsHTML}

      <div class="group obs">
        <h2><span>🗒️</span> Observações</h2>
        <textarea id="f-obs" placeholder="Alguma observação do dia (opcional)">${esc(r.obs || '')}</textarea>
      </div>

      <button type="button" class="pdf-btn" id="btn-pdf">📄 Gerar PDF para WhatsApp</button>
      <div class="pdf-hint" id="pdf-hint" hidden>Salve o relatório primeiro</div>
    </div>

    <div class="savebar">
      <button class="btn-ghost" id="btn-cancel">Cancelar</button>
      <button class="btn-save" id="btn-save">💾 Salvar relatório</button>
    </div>
  `;

  // eventos gerais
  wirePhotoBar();
  byId('btn-back').onclick = byId('btn-cancel').onclick = formBack;
  byId('btn-home').onclick = goHome;
  byId('f-data').onchange = (e: Event) => { r.data = (e.target as HTMLInputElement).value; refreshPdfBtn(); };
  byId('f-obs').oninput = (e: Event) => { r.obs = (e.target as HTMLTextAreaElement).value; refreshPdfBtn(); };
  byId('btn-save').onclick = onSave;
  byId('btn-pdf').onclick = () => sharePDF(Object.assign({}, r));
  if (byId('btn-del')) byId('btn-del').onclick = onDelete;

  // abas Comum / Cartão PJ (só quando a métrica PJ está ligada) — troca de painel sem re-render
  if (pjOn) {
    document.querySelectorAll('#form-tabs .form-tab').forEach((b) => {
      (b as HTMLElement).onclick = () => {
        formTab = (b as HTMLElement).getAttribute('data-tab') as 'comum' | 'pj';
        document.querySelectorAll('#form-tabs .form-tab').forEach((x) => x.classList.toggle('active', x === b));
        document.querySelectorAll('[data-panel]').forEach((p) => {
          (p as HTMLElement).hidden = (p as HTMLElement).getAttribute('data-panel') !== formTab;
        });
        updatePropostasBadge(r);
        haptic();
      };
    });
  }

  // liga os contadores (os de PJ só existem no DOM quando a aba está ligada)
  const fields = pjOn ? [...ALL_FIELDS, ...PJ_PROPOSTAS_FIELDS] : ALL_FIELDS;
  fields.forEach(f => wireCounter(f, r));
  refreshPdfBtn();
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
    if (PROPOSTAS_KEYS.includes(f.key) || PJ_NUMERIC_KEYS.includes(f.key)) updatePropostasBadge(r);
    refreshPdfBtn();
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
  ALL_NUMERIC_KEYS.forEach(k => r[k] = numOrNull(r[k]));   // preserves N/A (doesn't force 0); inclui PJ

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

  // Stay on the form after saving — the promotora may still want to generate the
  // PDF (now unlocked) before leaving via "Voltar". It's a saved report now, so
  // drop "novo" and refresh the snapshot so nothing reads as unsaved.
  state.editingNew = false;
  state.month = monthKeyOf(r.data);
  editSnapshot = JSON.stringify(state.editing);
  render();
  toast(sent ? 'Relatório salvo no servidor ✓'
             : 'Salvo no celular — envia quando tiver internet ⏳',
        sent ? 'ok' : '');
}
