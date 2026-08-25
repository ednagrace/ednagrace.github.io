import type { Customer } from '../types.js';
import { state, sessionValid } from '../state.js';
import { app, render } from '../render.js';
import { pad } from '../dateUtils.js';
import { esc, byId } from '../format.js';
import { isOnline, pullCustomers, pullTemplates, authHeaders } from '../api.js';
import { apiUrl } from '../env.js';
import { CARTAO_QUICK_BODY } from '../constants.js';
import { refreshSession } from '../auth.js';
import { toast, openSheet, closeSheet } from '../ui.js';
import { currentCustomer, customerLabel, phoneDigits, contactPickerAvailable } from '../customers.js';
import { openContactSheet, pickFromDeviceContacts } from '../components/contatoSheet.js';
import { openCustomers } from './customers.js';

/* ---------------- SCREEN: MESSAGES (templates) ---------------- */
export function openMsg() {
  pullTemplates().then(() => { if (state.view === 'msg') { selectFirstTemplate(); render(); } });
  pullCustomers().then(() => { if (state.view === 'msg') render(); });
  selectFirstTemplate();
  state.view = 'msg';
  render();
  window.scrollTo(0, 0);
}
function selectFirstTemplate() {
  state.msg = state.templates[0]
    ? { id: state.templates[0].id ?? null, title: state.templates[0].title, body: state.templates[0].body }
    : { id: null, title: '', body: '' };
}
function greetingNow(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}
// Gender agreement for the contact: masculine → "o", feminine → "a", other/unset → "o(a)".
// E.g. "atendê-l{oa}" becomes atendê-lo / atendê-la / atendê-lo(a).
// `c` undefined = uses the customer currently selected on screen (state.customerId); pass one
// explicitly when resolving a template for someone else (ex.: envio em lista).
function contactGenderSuffix(c?: Customer | null): string {
  const cc = c !== undefined ? c : currentCustomer();
  const g = cc && cc.gender ? String(cc.gender).toLowerCase() : '';
  if (g === 'masculino') return 'o';
  if (g === 'feminino') return 'a';
  return 'o(a)';
}
function applyPlaceholders(s: string, contatoOverride?: Customer | null): string {
  const d = new Date();
  const today = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  const c = contatoOverride !== undefined ? contatoOverride : currentCustomer();
  return String(s || '')
    .replace(/{saudacao}/gi, greetingNow())
    .replace(/{contato}/gi, c ? ((c.name || '').trim() || customerLabel(c)) : '')
    .replace(/{oa}/gi, contactGenderSuffix(c))
    .replace(/{hoje}/gi, today)
    .replace(/{promotora}/gi, state.config.promotora || '')
    .replace(/{loja}/gi, state.config.loja || '');
}

export function renderMsg() {
  const cur = state.msg;
  const todayFmt = (() => { const d = new Date(); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); })();
  const ct = currentCustomer();
  const phTable = `
    <div class="ph-table">
      <button type="button" class="ph-row" data-ph="{saudacao}"><code>{saudacao}</code><span>${greetingNow()} <i>(muda com a hora)</i></span></button>
      <button type="button" class="ph-row" data-ph="{contato}"><code>{contato}</code><span>${ct ? esc(customerLabel(ct)) : '<i>nome do contato escolhido</i>'}</span></button>
      <button type="button" class="ph-row" data-ph="{oa}"><code>{oa}</code><span>${esc(contactGenderSuffix())} <i>— ex.: atendê-l{oa} → atendê-l${esc(contactGenderSuffix())}</i></span></button>
      <button type="button" class="ph-row" data-ph="{hoje}"><code>{hoje}</code><span>${todayFmt}</span></button>
      <button type="button" class="ph-row" data-ph="{promotora}"><code>{promotora}</code><span>${esc(state.config.promotora)}</span></button>
      <button type="button" class="ph-row" data-ph="{loja}"><code>{loja}</code><span>${esc(state.config.loja)}</span></button>
    </div>`;

  const contatoBloco = `
    <div class="field">
      <label>Contato (opcional)</label>
      <button type="button" class="ct-picker" id="ct-open-picker">
        ${ct
          ? `<span class="ct-picker-name">${esc(customerLabel(ct))}</span><span class="ct-picker-sub">${ct.phone ? esc(ct.phone) : ''}</span>`
          : '<span class="ct-picker-placeholder">Toque para escolher um contato</span>'}
        <span class="ct-go">›</span>
      </button>
      <div class="ct-buttons">
        ${contactPickerAvailable() ? '<button type="button" class="ct-btn" id="ct-agenda">📇 Da agenda</button>' : ''}
        <button type="button" class="ct-btn" id="ct-novo">➕ Novo contato</button>
        ${ct ? '<button type="button" class="ct-btn" id="ct-edit">✏️ Editar</button>' : ''}
        ${ct ? '<button type="button" class="ct-btn" id="ct-limpar">✖️ Limpar</button>' : ''}
      </div>
      ${ct && !ct.phone ? '<div class="hint-inline">⚠️ Este contato não tem telefone — o WhatsApp vai abrir para você escolher o destinatário.</div>' : ''}
    </div>`;
  const options = ['<option value="">— Novo template —</option>']
    .concat(state.templates.map(t =>
      `<option value="${t.id}" ${String(t.id) === String(cur.id) ? 'selected' : ''}>${esc(t.title)}</option>`))
    .join('');

  app.innerHTML = `
    <header class="appbar">
      <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
      <div style="flex:1"><h1>Mensagens</h1><span class="sub">Templates de WhatsApp</span></div>
    </header>
    <div class="screen">
      ${contatoBloco}
      <div class="field">
        <label>Template</label>
        <select id="tpl-sel">${options}</select>
      </div>
      <div class="field">
        <label>Título</label>
        <input id="tpl-title" type="text" value="${esc(cur.title)}" placeholder="Ex.: Boas-vindas" />
      </div>
      <div class="field">
        <label>Mensagem</label>
        <textarea id="tpl-body" rows="8" placeholder="Escreva a mensagem...">${esc(cur.body)}</textarea>
        <div class="hint-inline">Atalhos (preenchidos ao enviar) — toque para inserir:</div>
        ${phTable}
      </div>
      <div class="msg-actions">
        ${cur.id ? '<button class="btn-ghost" id="tpl-del">🗑️</button>' : ''}
        <button class="btn-ghost" id="tpl-lista">📋 Lista</button>
        <button class="btn-ghost" id="tpl-save">💾 Salvar</button>
        <button class="btn-save" id="tpl-send">📤 Enviar</button>
      </div>
    </div>`;

  byId('btn-back').onclick = () => { state.view = 'list'; render(); };
  byId('ct-open-picker').onclick = () => openCustomers(true);
  byId('ct-novo').onclick = () => openContactSheet(null);
  if (byId('ct-limpar')) byId('ct-limpar').onclick = () => { state.customerId = null; render(); };
  if (byId('ct-edit')) byId('ct-edit').onclick = () => openContactSheet(currentCustomer());
  if (byId('ct-agenda')) byId('ct-agenda').onclick = pickFromDeviceContacts;
  byId('tpl-sel').onchange = (e: Event) => {
    const id = (e.target as HTMLSelectElement).value;
    const t = state.templates.find(x => String(x.id) === String(id));
    state.msg = t ? { id: t.id ?? null, title: t.title, body: t.body } : { id: null, title: '', body: '' };
    render();
  };
  byId('tpl-title').oninput = (e: Event) => { state.msg.title = (e.target as HTMLInputElement).value; };
  byId('tpl-body').oninput = (e: Event) => { state.msg.body = (e.target as HTMLTextAreaElement).value; };
  // Clickable shortcuts: insert the placeholder at the cursor position
  Array.from(document.querySelectorAll('.ph-row')).forEach(btn => {
    (btn as HTMLElement).onclick = () => {
      const ta = byId('tpl-body');
      const ph = (btn as HTMLElement).getAttribute('data-ph') as string;
      const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
      const e = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
      ta.value = ta.value.slice(0, s) + ph + ta.value.slice(e);
      state.msg.body = ta.value;
      ta.focus();
      const pos = s + ph.length;
      ta.setSelectionRange(pos, pos);
    };
  });
  byId('tpl-save').onclick = saveTemplate;
  byId('tpl-send').onclick = sendTemplate;
  byId('tpl-lista').onclick = openListaSheet;
  if (byId('tpl-del')) byId('tpl-del').onclick = deleteTemplate;
}

// Quick action from the menu: sends the "Nosso Cartão" link straight to WhatsApp.
// Independent wording from the templates-screen version — this flow has no contact
// name to fill in, only the currently selected contact's phone (if any).
export function sendCartaoLink() {
  const txt = applyPlaceholders(CARTAO_QUICK_BODY);
  const c = currentCustomer();
  const tel = c ? phoneDigits(c.phone) : '';
  window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(txt), '_blank');
}

function sendTemplate() {
  const txt = applyPlaceholders(state.msg.body);
  if (!txt.trim()) { toast('Mensagem vazia', 'err'); return; }
  const c = currentCustomer();
  const tel = c ? phoneDigits(c.phone) : '';
  // With a phone number → opens the chat directly. Without one → WhatsApp asks who to send to.
  window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(txt), '_blank');
}

async function saveTemplate() {
  const t = state.msg;
  if (!t.title.trim()) { toast('Dê um título ao template', 'err'); return; }
  if (!isOnline() || !sessionValid()) { toast('Conecte à internet para salvar', 'err'); return; }
  try {
    const res = await fetch(apiUrl('/api/templates'), {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ template: { id: t.id || undefined, title: t.title, body: t.body } }),
    });
    if (res.status === 401) { refreshSession(); toast('Faça login novamente', 'err'); return; }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'falha');
    await pullTemplates();
    state.msg = { id: data.template.id, title: data.template.title, body: data.template.body };
    render();
    toast('Template salvo ✓', 'ok');
  } catch (e: any) { toast('Erro: ' + e.message, 'err'); }
}

async function deleteTemplate() {
  const t = state.msg;
  if (!t.id) { state.msg = { id: null, title: '', body: '' }; render(); return; }
  if (!window.confirm('Excluir o template “' + t.title + '”?')) return;
  if (!isOnline() || !sessionValid()) { toast('Conecte à internet para excluir', 'err'); return; }
  try {
    const res = await fetch(apiUrl('/api/templates?id=' + encodeURIComponent(String(t.id))), {
      method: 'DELETE', headers: authHeaders(),
    });
    if (res.status === 401) { refreshSession(); toast('Faça login novamente', 'err'); return; }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'falha');
    await pullTemplates();
    selectFirstTemplate();
    render();
    toast('Template excluído', 'ok');
  } catch (e: any) { toast('Erro: ' + e.message, 'err'); }
}

/* ---------------- Envio em lista (por categoria de cliente) ----------------
   Categorias derivadas do último evento (customer_events.tipo) de cada customer — mesmo dado
   que já aparece na lista de Clientes, sem precisar cadastrar nada novo. Só entram customers
   com telefone (sem telefone não dá pra abrir o WhatsApp). */
interface ListaCategoria { key: string; label: string; emoji: string; tipos: string[] }
const LISTA_CATEGORIAS: ListaCategoria[] = [
  { key: 'cartao-aprovado', emoji: '✅', label: 'Cartão aprovado', tipos: ['cartao-aprovado', 'proposta-aprovada'] },
  { key: 'link-pendente', emoji: '🔗', label: 'Link pendente', tipos: ['link-pendente'] },
  { key: 'proposta-reprovada', emoji: '❌', label: 'Proposta reprovada', tipos: ['proposta-reprovada'] },
];
function contatosDaCategoria(cat: ListaCategoria): Customer[] {
  return state.customers.filter((c) => {
    if (!c.phone) return false;
    const ev = c.ultimoEvento;
    if (!ev) return false;
    const tags = String(ev.tipo || '').split(';').map((s) => s.trim());
    return cat.tipos.some((t) => tags.includes(t));
  });
}

// Substitui o conteúdo do sheet já aberto (em vez de abrir um novo por cima) — os passos
// seguintes (seleção → envio) reaproveitam o mesmo backdrop.
function setSheetContent(html: string, wire?: () => void) {
  const sheet = document.querySelector('.sheet');
  if (!sheet) return;
  sheet.innerHTML = html;
  if (wire) wire();
}

function openListaSheet() {
  const disponiveis = LISTA_CATEGORIAS
    .map((cat) => ({ cat, contatos: contatosDaCategoria(cat) }))
    .filter((x) => x.contatos.length > 0);

  if (!disponiveis.length) {
    openSheet(`
      <h2>Enviar em lista</h2>
      <p class="status-line">Nenhuma categoria disponível ainda. Precisa de contatos vinculados
      (tela de Contatos) a um cliente com "Cartão aprovado", "Link pendente" ou "Proposta
      reprovada" no histórico mais recente (tela de Clientes).</p>
    `);
    return;
  }

  openSheet(`
    <h2>Enviar em lista</h2>
    <p class="status-line" style="margin:-4px 0 12px">Template atual: <b>${esc(state.msg.title || '(sem título)')}</b>. Escolha a categoria de clientes:</p>
    ${disponiveis.map(({ cat, contatos }) => `
      <button type="button" class="menu-item" data-cat="${cat.key}">
        <span class="mi-ico">${cat.emoji}</span>
        <span>${esc(cat.label)}<small>${contatos.length} contato(s)</small></span>
      </button>`).join('')}
  `, () => {
    document.querySelectorAll('.sheet [data-cat]').forEach((btn) => {
      const key = (btn as HTMLElement).getAttribute('data-cat');
      const found = disponiveis.find((x) => x.cat.key === key);
      if (found) (btn as HTMLElement).onclick = () => renderListaSelecao(found.cat, found.contatos);
    });
  });
}

function renderListaSelecao(cat: ListaCategoria, contatos: Customer[]) {
  if (!state.msg.body.trim()) {
    toast('Escreva ou escolha um template antes de montar a lista', 'err');
    return;
  }
  const selecionados = new Set(contatos.map((c) => String(c.id)));
  const rowsHTML = contatos.map((c) => `
    <label class="check-row" data-ctid="${c.id}">
      <input type="checkbox" checked />
      <span>${esc(customerLabel(c))}<small>${esc(c.phone || '')}</small></span>
    </label>`).join('');

  setSheetContent(`
    <h2>${cat.emoji} ${esc(cat.label)}</h2>
    <p class="status-line" style="margin:-4px 0 12px">Todos vêm selecionados — desmarque quem não quiser incluir.</p>
    <div id="lista-rows">${rowsHTML}</div>
    <div class="actions">
      <button class="primary" id="lista-comecar" style="flex:1">📤 Começar envio (<span id="lista-count">${selecionados.size}</span>)</button>
    </div>
  `, () => {
    document.querySelectorAll('#lista-rows [data-ctid]').forEach((row) => {
      const id = row.getAttribute('data-ctid') as string;
      const box = row.querySelector('input') as HTMLInputElement;
      box.onchange = () => {
        if (box.checked) selecionados.add(id); else selecionados.delete(id);
        const countEl = byId('lista-count');
        if (countEl) countEl.textContent = String(selecionados.size);
      };
    });
    byId('lista-comecar').onclick = () => {
      const escolhidos = contatos.filter((c) => selecionados.has(String(c.id)));
      if (!escolhidos.length) { toast('Selecione ao menos um contato', 'err'); return; }
      renderListaEnvio(escolhidos, 0);
    };
  });
}

function renderListaEnvio(contatos: Customer[], idx: number) {
  if (idx >= contatos.length) {
    setSheetContent(`
      <h2>Envio concluído</h2>
      <p class="status-line">${contatos.length} mensagem(ns) processada(s).</p>
      <div class="actions"><button class="primary" id="lista-fechar" style="flex:1">Fechar</button></div>
    `, () => { byId('lista-fechar').onclick = () => closeSheet(); });
    return;
  }
  const c = contatos[idx];
  const txt = applyPlaceholders(state.msg.body, c);
  setSheetContent(`
    <h2>Enviando (${idx + 1}/${contatos.length})</h2>
    <p class="status-line" style="margin:-4px 0 6px"><b>${esc(customerLabel(c))}</b> · ${esc(c.phone || '')}</p>
    <div class="cl-linked" style="white-space:pre-wrap">${esc(txt)}</div>
    <div class="actions">
      <button class="secondary" id="lista-pular">Pular</button>
      <button class="primary" id="lista-abrir" style="flex:1">📤 Abrir no WhatsApp</button>
    </div>
  `, () => {
    byId('lista-pular').onclick = () => renderListaEnvio(contatos, idx + 1);
    byId('lista-abrir').onclick = () => {
      const tel = phoneDigits(c.phone);
      window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(txt), '_blank');
      renderListaEnvio(contatos, idx + 1);
    };
  });
}
