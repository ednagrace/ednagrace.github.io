import type { Contact } from '../types.js';
import { state } from '../state.js';
import { app, render } from '../render.js';
import { esc, byId } from '../format.js';
import { pullContacts } from '../api.js';
import { contactLabel } from '../contacts.js';
import { clienteInfoLine } from '../clientes.js';
import { openContactSheet } from '../components/contatoSheet.js';

/* ---------------- SCREEN: CONTACTS (agenda) ----------------
   Two modes, same screen:
   - normal (from the menu): tap a row → edit it.
   - pick mode (from Messages, replacing the old <select>): tap a row → select it and
     jump back to Messages. The pencil icon still opens the editor either way. */
export function openContacts(pickMode?: boolean) {
  state.contactsPickMode = !!pickMode;
  state.contactsSearch = '';
  pullContacts().then(() => { if (state.view === 'contacts') renderContactsSoft(); });
  state.view = 'contacts';
  render();
  window.scrollTo(0, 0);
}

export function renderContacts() {
  const pick = state.contactsPickMode;
  app.innerHTML = `
    <header class="appbar">
      <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
      <div style="flex:1"><h1>Contatos</h1><span class="sub">${pick ? 'Toque para escolher' : state.contacts.length + ' contato(s)'}</span></div>
    </header>
    <div class="screen">
      <div class="search">
        <input id="ctc-search" type="search" inputmode="search" placeholder="Buscar por nome ou telefone" value="${esc(state.contactsSearch)}" />
      </div>
      <div class="list" id="ctc-list">${contactRowsHTML()}</div>
    </div>
    <button class="fab" id="fab-novo-contato"><span class="plus">＋</span> Novo contato</button>
  `;
  byId('btn-back').onclick = () => { state.view = pick ? 'msg' : 'list'; render(); };
  byId('fab-novo-contato').onclick = () => openContactSheet(null);
  const s = byId('ctc-search') as HTMLInputElement;
  s.oninput = () => { state.contactsSearch = s.value; renderContactsSoft(); };
  wireContactRows();
}

function filteredContacts(): Contact[] {
  const q = state.contactsSearch.trim().toLowerCase();
  if (!q) return state.contacts;
  const digits = q.replace(/\D/g, '');
  return state.contacts.filter((c) => {
    const name = (c.name || '').toLowerCase();
    const phoneDigits = (c.phone || '').replace(/\D/g, '');
    const email = (c.email || '').toLowerCase();
    return name.includes(q) || email.includes(q) || (digits.length >= 3 && phoneDigits.includes(digits));
  });
}

function initials(c: Contact): string {
  const base = (c.name || '').trim() || (c.phone || '') || (c.email || '') || '?';
  return base.trim()[0]?.toUpperCase() || '?';
}

function contactRowsHTML(): string {
  const rows = filteredContacts();
  if (!rows.length) {
    return `<div class="empty"><div class="ico">📇</div><p>${state.contactsSearch
      ? 'Nenhum contato encontrado.'
      : 'Nenhum contato ainda.<br>Toque em <b>Novo contato</b> para começar.'}</p></div>`;
  }
  return rows.map(contactRowHTML).join('');
}

function contactRowHTML(c: Contact): string {
  const sub = [c.phone || c.email || '', c.cliente ? '🔗 ' + esc(clienteInfoLine(c.cliente)) : '']
    .filter(Boolean).join(' · ');
  return `
    <div class="contact-row" data-ct="${c.id}">
      <div class="avatar-circle">${esc(initials(c))}</div>
      <div class="ct-info">
        <div class="ct-name">${esc(contactLabel(c))}</div>
        ${sub ? `<div class="ct-sub">${sub}</div>` : ''}
      </div>
      <button type="button" class="ct-row-edit" data-edit="${c.id}" aria-label="Editar">✏️</button>
      <div class="ct-go">›</div>
    </div>`;
}

function wireContactRows() {
  Array.from(document.querySelectorAll('.contact-row')).forEach((el) => {
    (el as HTMLElement).onclick = (e: Event) => {
      if ((e.target as HTMLElement).closest('[data-edit]')) return;
      const id = (el as HTMLElement).getAttribute('data-ct');
      const c = state.contacts.find((x) => String(x.id) === String(id));
      if (!c) return;
      if (state.contactsPickMode) {
        state.contatoId = c.id ?? null;
        state.view = 'msg';
        render();
      } else {
        openContactSheet(c);
      }
    };
  });
  Array.from(document.querySelectorAll('[data-edit]')).forEach((btn) => {
    (btn as HTMLElement).onclick = (e: Event) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).getAttribute('data-edit');
      const c = state.contacts.find((x) => String(x.id) === String(id));
      if (c) openContactSheet(c);
    };
  });
}

// Re-renders just the list (keeps focus on the search field), same pattern as the report list.
function renderContactsSoft() {
  const list = byId('ctc-list');
  if (list) { list.innerHTML = contactRowsHTML(); wireContactRows(); }
  const sub = document.querySelector('.appbar .sub');
  if (sub && !state.contactsPickMode) sub.textContent = state.contacts.length + ' contato(s)';
}
