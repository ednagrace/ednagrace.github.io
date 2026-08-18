import type { Cliente } from '../types.js';
import { state, sessionValid } from '../state.js';
import { app, render } from '../render.js';
import { esc, byId } from '../format.js';
import { pad, parseISO, todayISO } from '../dateUtils.js';
import { isOnline, pullClientes, getClienteDetalhe, saveCliente, addClienteEvento } from '../api.js';
import { clienteLabel, clienteInfoLine, eventoLabel, TIPO_LABELS } from '../clientes.js';
import { openSheet, closeSheet, toast } from '../ui.js';
import { openContactSheet } from '../components/contatoSheet.js';

/* ---------------- SCREEN: CLIENTES (cadastro da Edna) ----------------
   Complementa a agenda de Contatos: existem clientes sem telefone/contato vinculado (a
   digitalização das fotos trouxe casos assim), que nunca apareceriam navegando só pelos
   Contatos. Aqui dá pra achar qualquer cliente cadastrado, cadastrar um novo direto (sem
   precisar de um contato) e ver/adicionar ao histórico dele. */
export function openClientes() {
  state.clientesSearch = '';
  state.view = 'clientes';
  render();
  window.scrollTo(0, 0);
  pullClientes().then(() => { if (state.view === 'clientes') renderClientesSoft(); });
}

export function renderClientes() {
  app.innerHTML = `
    <header class="appbar">
      <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
      <div style="flex:1"><h1>Clientes</h1><span class="sub">${state.clientes.length} cliente(s)</span></div>
    </header>
    <div class="screen">
      <div class="search">
        <input id="cli-search" type="search" inputmode="search" placeholder="Buscar por nome, sequência ou telefone" value="${esc(state.clientesSearch)}" />
      </div>
      <div class="list" id="cli-list">${clienteRowsHTML()}</div>
    </div>
    <button class="fab" id="fab-novo-cliente"><span class="plus">＋</span> Novo cliente</button>
  `;
  byId('btn-back').onclick = () => { state.view = 'list'; render(); };
  byId('fab-novo-cliente').onclick = () => openClienteForm();
  const s = byId('cli-search') as HTMLInputElement;
  s.oninput = () => { state.clientesSearch = s.value; renderClientesSoft(); };
  wireClienteRows();
}

function filteredClientes(): Cliente[] {
  const q = state.clientesSearch.trim().toLowerCase();
  if (!q) return state.clientes;
  const digits = q.replace(/\D/g, '');
  return state.clientes.filter((c) => {
    const nome = (c.nome || '').toLowerCase();
    const tel = (c.telefone || '').replace(/\D/g, '');
    return nome.includes(q) || c.sequencia.toLowerCase().includes(q) || (digits.length >= 3 && tel.includes(digits));
  });
}

function initialsCl(c: Cliente): string {
  const base = (c.nome || '').trim() || c.sequencia;
  return base.trim()[0]?.toUpperCase() || '?';
}

function clienteRowsHTML(): string {
  const rows = filteredClientes();
  if (!rows.length) {
    return `<div class="empty"><div class="ico">🗂️</div><p>${state.clientesSearch
      ? 'Nenhum cliente encontrado.'
      : 'Nenhum cliente cadastrado ainda.<br>Toque em <b>Novo cliente</b> para começar.'}</p></div>`;
  }
  return rows.map(clienteRowHTML).join('');
}

function clienteRowHTML(c: Cliente): string {
  const sub = [clienteInfoLine(c), c.contato ? '📇 ' + esc(c.contato.name || c.contato.phone || 'sem nome') : '']
    .filter(Boolean).join(' · ');
  return `
    <div class="contact-row" data-cl="${c.id}">
      <div class="avatar-circle">${esc(initialsCl(c))}</div>
      <div class="ct-info">
        <div class="ct-name">${esc(clienteLabel(c))}</div>
        <div class="ct-sub">${sub}</div>
      </div>
      <div class="ct-go">›</div>
    </div>`;
}

function wireClienteRows() {
  Array.from(document.querySelectorAll('[data-cl]')).forEach((el) => {
    (el as HTMLElement).onclick = () => {
      const id = (el as HTMLElement).getAttribute('data-cl');
      const c = state.clientes.find((x) => String(x.id) === id);
      if (c) openClienteDetalhe(c);
    };
  });
}

// Re-renders just the list (keeps focus on the search field), same pattern as Contacts/list.
function renderClientesSoft() {
  const list = byId('cli-list');
  if (list) { list.innerHTML = clienteRowsHTML(); wireClienteRows(); }
  const sub = document.querySelector('.appbar .sub');
  if (sub) sub.textContent = state.clientes.length + ' cliente(s)';
}

function fmtRetorno(iso: string): string {
  const d = parseISO(iso);
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

/* ---------- Novo cliente / editar cliente (sem precisar de um contato) ---------- */
function openClienteForm(existing?: Cliente, onSaved?: (c: Cliente) => void) {
  openSheet(`
    <h2>${existing ? 'Editar cliente' : 'Novo cliente'}</h2>
    <div class="field">
      <label>Sequência (obrigatório)</label>
      <input id="cf-seq" type="text" value="${esc(existing ? existing.sequencia : '')}" placeholder="Ex.: 3208480" />
    </div>
    <div class="field">
      <label>Nome (opcional)</label>
      <input id="cf-nome" type="text" value="${esc(existing?.nome || '')}" placeholder="Ex.: Maria Silva" />
    </div>
    <div class="field">
      <label>Telefone (opcional)</label>
      <input id="cf-tel" type="tel" inputmode="tel" value="${esc(existing?.telefone || '')}" placeholder="(19) 99999-9999" />
    </div>
    <div class="field">
      <label>Limite do cartão (opcional)</label>
      <input id="cf-limite" type="number" inputmode="decimal" step="0.01"
        value="${existing && existing.limite != null && existing.limite !== '' ? esc(String(existing.limite)) : ''}"
        placeholder="Ex.: 500" />
    </div>
    <div class="actions"><button class="primary" id="cf-save" style="flex:1">Salvar cliente</button></div>
    <div class="status-line" id="cf-status"></div>
  `, () => {
    byId('cf-save').onclick = async () => {
      const seq = (byId('cf-seq') as HTMLInputElement).value.trim();
      const st = byId('cf-status');
      if (!seq) { st.textContent = 'Informe a sequência.'; st.style.color = '#d10a11'; return; }
      if (!isOnline() || !sessionValid()) { toast('Conecte à internet para salvar', 'err'); return; }
      const btn = byId('cf-save') as HTMLButtonElement;
      btn.disabled = true;
      const r = await saveCliente({
        id: existing ? existing.id : undefined,
        sequencia: seq,
        nome: (byId('cf-nome') as HTMLInputElement).value.trim(),
        telefone: (byId('cf-tel') as HTMLInputElement).value.trim(),
        limite: (byId('cf-limite') as HTMLInputElement).value,
      });
      if (!r.ok || !r.cliente) {
        btn.disabled = false;
        st.textContent = 'Erro: ' + (r.error || 'não foi possível salvar');
        st.style.color = '#d10a11';
        return;
      }
      await pullClientes();
      closeSheet();
      toast('Cliente salvo ✓', 'ok');
      if (state.view === 'clientes') renderClientesSoft();
      if (onSaved) onSaved(r.cliente);
    };
  });
}

/* ---------- Nova nota / evento no histórico do cliente ---------- */
function openEventoForm(c: Cliente, onSaved: () => void) {
  openSheet(`
    <h2>Nova nota</h2>
    <p class="status-line" style="margin:-4px 0 12px">${esc(clienteLabel(c))}</p>
    <div class="field">
      <label>Tipo</label>
      <select id="ef-tipo">
        ${TIPO_LABELS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}
      </select>
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
    byId('ef-save').onclick = async () => {
      const obs = (byId('ef-obs') as HTMLTextAreaElement).value.trim();
      const st = byId('ef-status');
      if (!obs) { st.textContent = 'Escreva alguma observação.'; st.style.color = '#d10a11'; return; }
      if (!isOnline() || !sessionValid()) { toast('Conecte à internet para salvar', 'err'); return; }
      const btn = byId('ef-save') as HTMLButtonElement;
      btn.disabled = true;
      const r = await addClienteEvento({
        clienteId: c.id,
        tipo: (byId('ef-tipo') as HTMLSelectElement).value,
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

function openClienteDetalhe(c: Cliente) {
  openSheet(`
    <h2>${esc(clienteLabel(c))}</h2>
    <div class="cl-linked">
      <div class="ct-sub">Sequência: ${esc(c.sequencia)}</div>
      ${c.telefone ? `<div class="ct-sub">Telefone: ${esc(c.telefone)}</div>` : '<div class="ct-sub">Sem telefone cadastrado</div>'}
      ${c.limite != null && c.limite !== '' ? `<div class="ct-sub">Limite: R$ ${esc(String(c.limite))}</div>` : ''}
    </div>
    <div class="ct-buttons" style="margin-top:8px">
      <button type="button" class="ct-btn" id="cli-editar">✏️ Editar</button>
      <button type="button" class="ct-btn" id="cli-nova-nota">🗒️ Nova nota</button>
    </div>
    <div id="cli-det-contato"></div>
    <div class="field" style="margin-top:14px">
      <label>Histórico</label>
      <div id="cli-det-eventos" class="cl-results" style="max-height:none">
        <div class="ct-sub">Carregando...</div>
      </div>
    </div>
  `, () => {
    const contatoBox = byId('cli-det-contato');
    if (c.contato) {
      contatoBox.innerHTML = `
        <button type="button" class="ct-btn" id="cli-open-contato" style="margin-top:8px">
          📇 Ver contato: ${esc(c.contato.name || c.contato.phone || 'sem nome')}
        </button>`;
      byId('cli-open-contato').onclick = () => {
        const contatoId = c.contato!.id;
        closeSheet();
        const full = state.contacts.find((x) => String(x.id) === String(contatoId));
        openContactSheet(full || { id: contatoId, name: c.contato!.name || '', phone: c.contato!.phone || '' });
      };
    } else {
      contatoBox.innerHTML = '<div class="hint-inline" style="margin-top:8px">Nenhum contato da agenda vinculado a este cliente.</div>';
    }

    // Reabre o detalhe com dado fresco depois de editar/adicionar nota — mantém a pessoa
    // no mesmo lugar em vez de jogar de volta pra lista.
    const reabrir = async () => {
      await pullClientes();
      const atualizado = state.clientes.find((x) => String(x.id) === String(c.id)) || c;
      if (state.view === 'clientes') renderClientesSoft();
      openClienteDetalhe(atualizado);
    };
    byId('cli-editar').onclick = () => openClienteForm(c, () => reabrir());
    byId('cli-nova-nota').onclick = () => openEventoForm(c, () => reabrir());

    carregarEventos(c.id);
  });
}

function carregarEventos(clienteId: string | number) {
  getClienteDetalhe(clienteId).then((det) => {
    const box = byId('cli-det-eventos');
    if (!box) return;
    if (!det || !det.eventos.length) { box.innerHTML = '<div class="ct-sub">Sem histórico registrado.</div>'; return; }
    box.innerHTML = det.eventos.map((ev) => `
      <div class="cl-result" style="cursor:default">
        <div>${esc(eventoLabel(ev))}</div>
        ${ev.observacao ? `<div class="ct-sub">${esc(ev.observacao)}</div>` : ''}
        ${ev.retornarEm ? `<div class="ct-sub">↩️ Retornar em ${esc(fmtRetorno(ev.retornarEm))}</div>` : ''}
      </div>`).join('');
  });
}
