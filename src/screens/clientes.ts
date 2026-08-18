import type { Cliente } from '../types.js';
import { state } from '../state.js';
import { app, render } from '../render.js';
import { esc, byId } from '../format.js';
import { pad, parseISO } from '../dateUtils.js';
import { pullClientes, getClienteDetalhe } from '../api.js';
import { clienteLabel, clienteInfoLine, eventoLabel } from '../clientes.js';
import { openSheet, closeSheet } from '../ui.js';
import { openContactSheet } from '../components/contatoSheet.js';

/* ---------------- SCREEN: CLIENTES (cadastro da Edna) ----------------
   Complementa a agenda de Contatos: existem clientes sem telefone/contato vinculado (a
   digitalização das fotos trouxe casos assim), que nunca apareceriam navegando só pelos
   Contatos. Aqui dá pra achar qualquer cliente cadastrado e ver o histórico dele. */
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
  `;
  byId('btn-back').onclick = () => { state.view = 'list'; render(); };
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
      : 'Nenhum cliente cadastrado ainda.'}</p></div>`;
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

function openClienteDetalhe(c: Cliente) {
  openSheet(`
    <h2>${esc(clienteLabel(c))}</h2>
    <div class="cl-linked">
      <div class="ct-sub">Sequência: ${esc(c.sequencia)}</div>
      ${c.telefone ? `<div class="ct-sub">Telefone: ${esc(c.telefone)}</div>` : '<div class="ct-sub">Sem telefone cadastrado</div>'}
      ${c.limite != null && c.limite !== '' ? `<div class="ct-sub">Limite: R$ ${esc(String(c.limite))}</div>` : ''}
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

    getClienteDetalhe(c.id).then((det) => {
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
  });
}
