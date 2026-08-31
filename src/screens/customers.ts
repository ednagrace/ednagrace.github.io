import type { Customer } from '../types.js';
import { state, sessionValid } from '../state.js';
import { app, render } from '../render.js';
import { esc, byId } from '../format.js';
import { pad, parseISO, todayISO } from '../dateUtils.js';
import { isOnline, pullCustomers, getCustomerDetalhe, addCustomerEvent } from '../api.js';
import { customerLabel, customerInfoLine, eventLabel, looksLikeWhatsApp, TIPOS_NOVA_NOTA } from '../customers.js';
import { openSheet, closeSheet, toast } from '../ui.js';
import { openContactSheet } from '../components/contatoSheet.js';
import { syncMsgGenderFromCustomer } from './messages.js';

/* ---------------- SCREEN: CLIENTES (cadastro unificado) ----------------
   Entidade única: funde a antiga agenda de Contatos com o antigo cadastro de Clientes — existem
   customers sem telefone (cadastro antigo, sem contato) e customers sem sequência (contato de
   WhatsApp sem cadastro formal). Uma lista só, com busca e filtro (padrão: só quem "parece
   WhatsApp" — looksLikeWhatsApp).

   Dois modos, mesma tela:
   - normal (do menu): toque numa linha → detalhe (histórico + editar + nova nota).
   - pick mode (de Mensagens, escolhendo quem vai receber a mensagem): toque → seleciona e volta
     pra Mensagens. */
export function openCustomers(pickMode?: boolean) {
  state.customersPickMode = !!pickMode;
  state.customersSearch = '';
  state.customersGender = '';
  state.view = 'customers';
  render();
  window.scrollTo(0, 0);
  pullCustomers().then(() => { if (state.view === 'customers') renderCustomersSoft(); });
}

export function renderCustomers() {
  const pick = state.customersPickMode;
  app.innerHTML = `
    <header class="appbar">
      <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
      <div style="flex:1"><h1>Clientes</h1><span class="sub">${pick ? 'Toque para escolher' : filteredCustomers().length + ' cliente(s)'}</span></div>
    </header>
    <div class="screen">
      <div class="search">
        <input id="cu-search" type="search" inputmode="search" placeholder="Buscar por nome, telefone ou sequência" value="${esc(state.customersSearch)}" />
      </div>
      <label class="check-row" style="margin:0 0 10px">
        <input type="checkbox" id="cu-wa-only" ${state.customersWhatsappOnly ? 'checked' : ''} />
        <span>📱 Só quem parece ter WhatsApp</span>
      </label>
      <div class="seg-control gender-filter" id="cu-gender" style="margin-bottom:12px">
        ${([['masculino', '♂️ Homem'], ['feminino', '♀️ Mulher'], ['outro', '⚧️ Outro']] as const)
          .map(([g, l]) => `<button type="button" class="seg-btn${state.customersGender === g ? ' sel' : ''}" data-g="${g}">${l}</button>`).join('')}
      </div>
      <div class="list" id="cu-list">${customerRowsHTML()}</div>
    </div>
    <button class="fab" id="fab-novo-cliente"><span class="plus">＋</span> Novo cliente</button>
  `;
  byId('btn-back').onclick = () => { state.view = pick ? 'msg' : 'list'; render(); };
  byId('fab-novo-cliente').onclick = () => openContactSheet(null);
  const s = byId('cu-search') as HTMLInputElement;
  s.oninput = () => { state.customersSearch = s.value; renderCustomersSoft(); };
  (byId('cu-wa-only') as HTMLInputElement).onchange = (e: Event) => {
    state.customersWhatsappOnly = (e.target as HTMLInputElement).checked;
    renderCustomersSoft();
  };
  document.querySelectorAll('#cu-gender .seg-btn').forEach((b) => {
    (b as HTMLElement).onclick = () => {
      const g = (b as HTMLElement).getAttribute('data-g') as typeof state.customersGender;
      state.customersGender = state.customersGender === g ? '' : g;
      document.querySelectorAll('#cu-gender .seg-btn').forEach((x) => x.classList.remove('sel'));
      if (state.customersGender) b.classList.add('sel');
      renderCustomersSoft();
    };
  });
  wireCustomerRows();
}

function filteredCustomers(): Customer[] {
  const q = state.customersSearch.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  return state.customers.filter((c) => {
    if (state.customersWhatsappOnly && !looksLikeWhatsApp(c.phone)) return false;
    if (state.customersGender && String(c.gender || '') !== state.customersGender) return false;
    if (!q) return true;
    const name = (c.name || '').toLowerCase();
    const email = (c.email || '').toLowerCase();
    const seq = (c.sequencia || '').toLowerCase();
    const phone = (c.phone || '').replace(/\D/g, '');
    return name.includes(q) || email.includes(q) || seq.includes(q) || (digits.length >= 3 && phone.includes(digits));
  }).sort((a, b) => customerLabel(a).localeCompare(customerLabel(b), 'pt', { sensitivity: 'base' }));
}

function initials(c: Customer): string {
  const base = (c.name || '').trim() || (c.phone || '') || (c.email || '') || (c.sequencia || '') || '?';
  return base.trim()[0]?.toUpperCase() || '?';
}

function customerRowsHTML(): string {
  const rows = filteredCustomers();
  if (!rows.length) {
    return `<div class="empty"><div class="ico">🗂️</div><p>${state.customersSearch || state.customersWhatsappOnly
      ? 'Nenhum cliente encontrado.<br>Tente ajustar a busca ou desmarcar o filtro de WhatsApp.'
      : 'Nenhum cliente cadastrado ainda.<br>Toque em <b>Novo cliente</b> para começar.'}</p></div>`;
  }
  return rows.map(customerRowHTML).join('');
}

function customerRowHTML(c: Customer): string {
  const sub = [c.phone || c.email || '', customerInfoLine(c)].filter(Boolean).join(' · ');
  return `
    <div class="contact-row" data-cu="${c.id}">
      <div class="avatar-circle">${esc(initials(c))}</div>
      <div class="ct-info">
        <div class="ct-name">${esc(customerLabel(c))}</div>
        ${sub ? `<div class="ct-sub">${sub}</div>` : ''}
      </div>
      <div class="ct-go">›</div>
    </div>`;
}

function wireCustomerRows() {
  Array.from(document.querySelectorAll('[data-cu]')).forEach((el) => {
    (el as HTMLElement).onclick = () => {
      const id = (el as HTMLElement).getAttribute('data-cu');
      const c = state.customers.find((x) => String(x.id) === String(id));
      if (!c) return;
      if (state.customersPickMode) {
        state.customerId = c.id ?? null;
        syncMsgGenderFromCustomer();   // filtro de template já vem no gênero do cliente escolhido
        state.view = 'msg';
        render();
      } else {
        openCustomerDetalhe(c);
      }
    };
  });
}

// Re-renders just the list (keeps focus on the search field), same pattern as the report list.
function renderCustomersSoft() {
  const list = byId('cu-list');
  if (list) { list.innerHTML = customerRowsHTML(); wireCustomerRows(); }
  const sub = document.querySelector('.appbar .sub');
  if (sub && !state.customersPickMode) sub.textContent = filteredCustomers().length + ' cliente(s)';
}

function fmtRetorno(iso: string): string {
  const d = parseISO(iso);
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

/* ---------- Nova nota / evento no histórico do customer ---------- */
function openEventoForm(c: Customer, onSaved: () => void) {
  openSheet(`
    <h2>Nova nota</h2>
    <p class="status-line" style="margin:-4px 0 12px">${esc(customerLabel(c))}</p>
    <div class="field">
      <label>Tipo</label>
      <div class="tipo-list" id="ef-tipo-list">
        ${TIPOS_NOVA_NOTA.map((t, i) => `
          <label class="tipo-row${i === 0 ? ' sel' : ''}">
            <span class="tipo-row-ico">${t.emoji}</span>
            <span class="tipo-row-body"><span class="tipo-row-label">${esc(t.label)}</span><small>${esc(t.desc)}</small></span>
            <input type="radio" name="ef-tipo" value="${t.value}" ${i === 0 ? 'checked' : ''} />
          </label>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Observação</label>
      <textarea id="ef-obs" placeholder="Ex.: cliente pediu para retornar em outubro"></textarea>
    </div>
    <div class="field">
      <label>Data do evento</label>
      <input id="ef-data" type="date" value="${todayISO()}" max="${todayISO()}" />
    </div>
    <div class="field">
      <label>Retornar em (opcional)</label>
      <input id="ef-retorno" type="date" />
    </div>
    <div class="actions"><button class="primary" id="ef-save" style="flex:1">Salvar nota</button></div>
    <div class="status-line" id="ef-status"></div>
  `, () => {
    document.querySelectorAll('#ef-tipo-list .tipo-row').forEach((row) => {
      (row.querySelector('input') as HTMLInputElement).onchange = () => {
        document.querySelectorAll('#ef-tipo-list .tipo-row').forEach((r) => r.classList.remove('sel'));
        row.classList.add('sel');
      };
    });
    byId('ef-save').onclick = async () => {
      const obs = (byId('ef-obs') as HTMLTextAreaElement).value.trim();
      const st = byId('ef-status');
      if (!obs) { st.textContent = 'Escreva alguma observação.'; st.style.color = '#d10a11'; return; }
      if (!isOnline() || !sessionValid()) { toast('Conecte à internet para salvar', 'err'); return; }
      const btn = byId('ef-save') as HTMLButtonElement;
      btn.disabled = true;
      const tipoSel = document.querySelector('#ef-tipo-list input:checked') as HTMLInputElement;
      const r = await addCustomerEvent({
        customerId: c.id!,
        tipo: tipoSel.value,
        observacao: obs,
        dataEvento: (byId('ef-data') as HTMLInputElement).value,
        retornarEm: (byId('ef-retorno') as HTMLInputElement).value,
        loja: state.config.loja,
      });
      if (!r.ok) {
        btn.disabled = false;
        st.textContent = 'Erro: ' + (r.error || 'não foi possível salvar');
        st.style.color = '#d10a11';
        return;
      }
      closeSheet();
      toast('Nota adicionada ✓', 'ok');
      onSaved();
    };
  });
}

function openCustomerDetalhe(c: Customer) {
  openSheet(`
    <h2>${esc(customerLabel(c))}</h2>
    <div class="cl-linked">
      ${c.phone ? `<div class="ct-sub">Telefone: ${esc(c.phone)}</div>` : ''}
      ${c.email ? `<div class="ct-sub">E-mail: ${esc(c.email)}</div>` : ''}
      ${c.sequencia ? `<div class="ct-sub">Sequência: ${esc(c.sequencia)}</div>` : ''}
      ${c.limite != null && c.limite !== '' ? `<div class="ct-sub">Limite: R$ ${esc(String(c.limite))}</div>` : ''}
      ${!c.phone && !c.email && !c.sequencia ? '<div class="ct-sub">Sem dados cadastrados</div>' : ''}
    </div>
    <div class="ct-buttons" style="margin-top:8px">
      <button type="button" class="ct-btn" id="cu-editar">✏️ Editar</button>
      <button type="button" class="ct-btn" id="cu-nova-nota">🗒️ Nova nota</button>
    </div>
    <div class="field" style="margin-top:14px">
      <label>Histórico</label>
      <div id="cu-det-eventos" class="cl-results" style="max-height:none">
        <div class="ct-sub">Carregando...</div>
      </div>
    </div>
  `, () => {
    // Reabre o detalhe com dado fresco depois de editar/adicionar nota — mantém a pessoa
    // no mesmo lugar em vez de jogar de volta pra lista.
    const reabrir = async () => {
      await pullCustomers();
      const atualizado = state.customers.find((x) => String(x.id) === String(c.id)) || c;
      if (state.view === 'customers') renderCustomersSoft();
      openCustomerDetalhe(atualizado);
    };
    byId('cu-editar').onclick = () => openContactSheet(c, () => reabrir());
    byId('cu-nova-nota').onclick = () => openEventoForm(c, () => reabrir());

    carregarEventos(c.id!);
  });
}

function carregarEventos(customerId: string | number) {
  getCustomerDetalhe(customerId).then((det) => {
    const box = byId('cu-det-eventos');
    if (!box) return;
    if (!det || !det.events.length) { box.innerHTML = '<div class="ct-sub">Sem histórico registrado.</div>'; return; }
    box.innerHTML = det.events.map((ev) => `
      <div class="cl-result" style="cursor:default">
        <div>${esc(eventLabel(ev))}</div>
        ${ev.observacao ? `<div class="ct-sub">${esc(ev.observacao)}</div>` : ''}
        ${ev.retornarEm ? `<div class="ct-sub">↩️ Retornar em ${esc(fmtRetorno(ev.retornarEm))}</div>` : ''}
      </div>`).join('');
  });
}
