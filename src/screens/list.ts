import type { Report } from '../types.js';
import { MONTHS, MONTHS_SHORT } from '../constants.js';
import { state, save } from '../state.js';
import { LS } from '../env.js';
import { app, render } from '../render.js';
import { pad, parseISO, monthKeyOf, weekday } from '../dateUtils.js';
import { esc, num, fmtNA, informed } from '../format.js';
import { isOnline, reportsForView, getReport, flushQueue, deleteReportNow } from '../api.js';
import { metaFor, metaDiaVal, aprovadasNoMes, isBirthday, ageToday, setMeta } from '../aggregations.js';
import { saveSettingsRemote } from '../api.js';
import { sharePDF } from '../pdf.js';
import { toast } from '../ui.js';
import { openMenu } from './menu.js';
import { openPanel } from './panel.js';
import { generateSheet } from './menu.js';
import { openForm, openNew } from './form.js';

/* ---------------- SCREEN: LIST ---------------- */
export function renderList() {
  const monthKey = state.month;
  const [y, m] = monthKey.split('-').map(Number);
  const meta = metaFor(monthKey);
  const feitas = aprovadasNoMes(monthKey);
  const pct = meta > 0 ? Math.min(100, Math.round((feitas / meta) * 100)) : 0;
  const falta = Math.max(0, meta - feitas);

  let rows = reportsForView().filter(r => monthKeyOf(r.data) === monthKey);
  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    rows = rows.filter(r =>
      (r.data || '').includes(q) ||
      (String(r.obs || '')).toLowerCase().includes(q)
    );
  }

  const pendCount = state.queue.length;

  app.innerHTML = `
    <header class="appbar">
      <div style="flex:1">
        <h1>Relatórios Diários</h1>
        <span class="sub">${esc(state.config.promotora)} · ${esc(state.config.loja)}</span>
      </div>
      <span class="net-badge ${isOnline() ? '' : 'off'}">${isOnline() ? 'online' : 'offline'}</span>
      <button class="iconbtn" id="btn-panel" aria-label="Painel do mês">📊</button>
      <button class="iconbtn" id="btn-menu" aria-label="Menu">⚙️</button>
    </header>

    <div class="screen">
      ${isBirthday() ? `<div class="bday-banner">🎉🎂 Feliz aniversário, ${esc((state.config.promotora || '').split(' ')[0] || 'promotora')}!<small>${ageToday() != null ? ageToday() + ' anos hoje — o' : 'O'} app não esqueceu de você 💛</small></div>` : ''}
      <div class="meta-card">
        <div class="row">
          <span class="label">Meta do mês · aprovados</span>
          <button class="edit-meta" id="btn-meta">editar</button>
        </div>
        <div class="row" style="margin-top:4px">
          <div class="big">${feitas}<small> / ${meta || '—'}</small></div>
          <div style="text-align:right">
            <div style="font-size:22px;font-weight:800">${meta ? pct + '%' : ''}</div>
          </div>
        </div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="hint">${meta ? (falta > 0 ? `Faltam <b>${falta}</b> para a meta` : 'Meta batida! 🎉') : 'Toque em “editar” para definir a meta do mês'}</div>
        <div class="hint meta-dia-line">🎯 Meta do dia: <b>${metaDiaVal()}</b> aprovados <button class="edit-meta" id="btn-meta-dia">editar</button></div>
      </div>

      <div class="month-nav">
        <button id="prev-month" aria-label="Mês anterior">‹</button>
        <div class="label">${MONTHS[m-1]} ${y}</div>
        <button id="next-month" aria-label="Próximo mês">›</button>
      </div>

      <button type="button" class="pdf-btn" id="btn-sheet-month">📗 Planilha do Google · ${MONTHS[m-1]} ${y}</button>

      <div class="search">
        <input id="search" type="search" inputmode="search" placeholder="Buscar por data ou observação" value="${esc(state.search)}" />
      </div>

      ${pendCount > 0 ? `<div class="chip no" style="margin-bottom:10px">⏳ ${pendCount} aguardando envio — <b id="try-sync" style="text-decoration:underline">sincronizar</b></div>` : ''}

      <div class="list">
        ${rows.length ? rows.map(cardHTML).join('') : emptyHTML()}
      </div>
    </div>

    <button class="fab" id="fab-new"><span class="plus">＋</span> Novo Relatório</button>
  `;

  // Eventos
  (document.getElementById('fab-new') as HTMLElement).onclick = () => openNew();
  (document.getElementById('prev-month') as HTMLElement).onclick = () => shiftMonth(-1);
  (document.getElementById('next-month') as HTMLElement).onclick = () => shiftMonth(1);
  (document.getElementById('btn-menu') as HTMLElement).onclick = openMenu;
  (document.getElementById('btn-panel') as HTMLElement).onclick = openPanel;
  // The spreadsheet comes from the month in the selector above — the same month whose list is on screen.
  (document.getElementById('btn-sheet-month') as HTMLElement).onclick = () => generateSheet(monthKey);
  (document.getElementById('btn-meta') as HTMLElement).onclick = editMetaPrompt;
  (document.getElementById('btn-meta-dia') as HTMLElement).onclick = editMetaDiaPrompt;
  const s = document.getElementById('search') as HTMLInputElement;
  s.oninput = () => { state.search = s.value; /* re-render leve */ renderListSoft(); };
  const trySync = document.getElementById('try-sync');
  if (trySync) trySync.onclick = () => flushQueue(false);
  wireCards();
}

/* Swipe to delete (iOS-style): past 50% of the width → release and the item
   flies off and gets deleted. Under 50% → springs back to rest. The gesture IS the confirmation. */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function swipeDelete(wrap: HTMLElement, card: HTMLElement, dir: number) {
  const dataISO = card.getAttribute('data-open') as string;
  const w = wrap.offsetWidth;
  const h = wrap.offsetHeight;

  // Can't delete without internet: springs back to rest.
  if (!isOnline()) {
    card.style.transition = 'transform .18s ease';
    card.style.transform = 'translateX(0)';
    wrap.classList.remove('will-delete');
    toast('Conecte à internet para excluir', 'err');
    return;
  }

  // 1) the trash icon grows and "pushes" the item out of the list
  wrap.style.setProperty('--push', (dir * 26) + 'px');
  wrap.classList.add('committing');
  card.style.transition = 'transform .22s cubic-bezier(.4,0,1,1)';
  card.style.transform = 'translateX(' + (dir * (w + 60)) + 'px)';
  await sleep(220);

  // 2) the row collapses (disappears from the list)
  wrap.style.height = h + 'px';
  wrap.style.overflow = 'hidden';
  void wrap.offsetHeight; // force reflow
  wrap.style.transition = 'height .18s ease, opacity .18s ease, margin-bottom .18s ease';
  wrap.style.height = '0px';
  wrap.style.opacity = '0';
  wrap.style.marginBottom = '-10px'; // compensates the list's gap
  await sleep(190);

  // 3) actually deletes it (if it fails, render() puts the item back)
  const ok = await deleteReportNow(dataISO);
  render();
  toast(ok ? 'Relatório excluído' : 'Não foi possível excluir', ok ? 'ok' : 'err');
}

function wireSwipe(wrap: HTMLElement) {
  const card = wrap.querySelector('.report-card') as HTMLElement;
  if (!card) return;
  let startX = 0, startY = 0, dx = 0, dragging = false, decided = false, horiz = false;

  card.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.card-pdf')) return; // don't drag from the PDF button
    startX = e.clientX; startY = e.clientY;
    dx = 0; dragging = true; decided = false; horiz = false;
    card.style.transition = 'none';
  });

  card.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = true;
      horiz = Math.abs(mx) > Math.abs(my);
      if (horiz) { try { card.setPointerCapture(e.pointerId); } catch (err) {} }
    }
    if (!horiz) return;
    const w = wrap.offsetWidth;
    dx = Math.max(-w, Math.min(w, mx));
    card.style.transform = 'translateX(' + dx + 'px)';
    // past 50% → the trash icon grows, warning that releasing will delete
    wrap.classList.toggle('will-delete', Math.abs(dx) > w / 2);
  });

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    const w = wrap.offsetWidth;
    if (horiz && Math.abs(dx) > w / 2) {          // > 50% → exclui
      swipeDelete(wrap, card, dx < 0 ? -1 : 1);
    } else {                                      // ≤ 50% → volta ao repouso
      card.style.transition = 'transform .18s ease';
      card.style.transform = 'translateX(0)';
      wrap.classList.remove('will-delete');
    }
    if (horiz && Math.abs(dx) > 8) {              // prevents the drag from turning into a click
      card.dataset.swiped = '1';
      setTimeout(() => { delete card.dataset.swiped; }, 250);
    }
  };
  card.addEventListener('pointerup', finish);
  card.addEventListener('pointercancel', finish);
}

function wireCards() {
  Array.from(document.querySelectorAll('[data-pdf]')).forEach(btn => {
    (btn as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      const rep = getReport((btn as HTMLElement).getAttribute('data-pdf') as string);
      sharePDF(rep ? Object.assign({}, rep) : null);
    };
  });

  Array.from(document.querySelectorAll('[data-open]')).forEach(el => {
    (el as HTMLElement).onclick = () => {
      if ((el as HTMLElement).dataset.swiped === '1') return; // acabou de arrastar
      openForm((el as HTMLElement).getAttribute('data-open') as string);
    };
  });

  Array.from(document.querySelectorAll('.card-wrap')).forEach(el => wireSwipe(el as HTMLElement));
}

// Re-renders just the list (keeps focus on the search field)
function renderListSoft() {
  const monthKey = state.month;
  let rows = reportsForView().filter(r => monthKeyOf(r.data) === monthKey);
  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    rows = rows.filter(r => (r.data||'').includes(q) || (String(r.obs||'')).toLowerCase().includes(q));
  }
  const listEl = document.querySelector('.list');
  if (listEl) {
    listEl.innerHTML = rows.length ? rows.map(cardHTML).join('') : emptyHTML();
    wireCards();
  }
}

function cardHTML(r: Report): string {
  const d = parseISO(r.data);
  const chips: string[] = [];
  const bateuDia = informed(r.aprovadas) && (r.aprovadas as number) >= metaDiaVal();
  chips.push(`<span class="chip ${bateuDia ? 'ok' : 'neutral'}">✅ ${fmtNA(r.aprovadas)}${bateuDia ? ' 🎯' : ''}</span>`);
  chips.push(`<span class="chip no">❌ ${fmtNA(r.reprovadas)}</span>`);
  if (num(r.link))  chips.push(`<span class="chip">🔗 ${num(r.link)}</span>`);
  if (num(r.cartaoEntregas)) chips.push(`<span class="chip">📦 ${num(r.cartaoEntregas)}</span>`);
  const servicos = num(r.sms)+num(r.bonus)+num(r.faturaDigital)+num(r.odontoPlus);
  if (servicos) chips.push(`<span class="chip">⭐ ${servicos}</span>`);
  return `
    <div class="card-wrap">
      <div class="swipe-bg" data-del="${r.data}" title="Excluir">
        <span>🗑️</span><span>🗑️</span>
      </div>
    <div class="report-card" data-open="${r.data}">
      <div class="date-badge">
        <div class="d">${pad(d.getDate())}</div>
        <div class="m">${MONTHS_SHORT[d.getMonth()]}</div>
      </div>
      <div class="info">
        <div class="title">${weekday(d)}
          <span class="sync-dot ${r._synced ? 'done' : 'wait'}" title="${r._synced ? 'enviado' : 'aguardando'}"></span>
        </div>
        <div class="chips">${chips.join('')}</div>
      </div>
      <button class="card-pdf" data-pdf="${r.data}" title="Gerar PDF" aria-label="Gerar PDF">📄</button>
      <div class="go">›</div>
    </div>
    </div>`;
}

function emptyHTML(): string {
  return `<div class="empty"><div class="ico">📝</div><p>Nenhum relatório neste mês.<br>Toque em <b>Novo Relatório</b> para começar.</p></div>`;
}

export function shiftMonth(delta: number) {
  let [y, m] = state.month.split('-').map(Number);
  m += delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  state.month = y + '-' + pad(m);
  render();
}

function editMetaPrompt() {
  const cur = metaFor(state.month) || '';
  const [y, m] = state.month.split('-').map(Number);
  const v = window.prompt(`Meta de cartões aprovados para ${MONTHS[m-1]} ${y}:`, String(cur));
  if (v === null) return;
  setMeta(state.month, v);
  saveSettingsRemote();
  render();
}

function editMetaDiaPrompt() {
  const v = window.prompt('Meta de cartões aprovados por DIA:', String(metaDiaVal()));
  if (v === null) return;
  state.config.metaDia = Math.max(0, Number(v) || 0);
  save(LS.config, state.config);
  saveSettingsRemote();
  render();
}
