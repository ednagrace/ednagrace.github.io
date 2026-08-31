import type { Customer, CustomList } from '../types.js';
import { state, sessionValid, save } from '../state.js';
import { app, render } from '../render.js';
import { pad } from '../dateUtils.js';
import { esc, byId } from '../format.js';
import { isOnline, pullCustomers, pullTemplates, authHeaders, saveSettingsRemote } from '../api.js';
import { apiUrl, LS } from '../env.js';
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
  state.msgDestMode = 'pessoa';   // sempre volta pro modo padrão ao reabrir a tela
  state.msgGender = '';           // idem: filtro de gênero começa desligado
  state.view = 'msg';
  render();
  window.scrollTo(0, 0);
}
function selectFirstTemplate() {
  const first = filteredTemplates()[0];
  state.msg = first
    ? { id: first.id ?? null, title: first.title, body: first.body }
    : { id: null, title: '', body: '' };
}

/* ---------------- Filtro do seletor de templates por gênero ----------------
   Templates não têm campo de gênero — a categoria vem do título (ex.: "ENVIAR LINK /
   MULHER 🌷"): 'mulher'/'feminino' → 'f', 'homem'/'masculino' → 'm', qualquer outro → 'n'. */
type GenderKey = 'f' | 'm' | 'n';
const GENDER_BUTTONS: { key: GenderKey; label: string }[] = [
  { key: 'f', label: '♀️ Mulher' },
  { key: 'm', label: '♂️ Homem' },
  { key: 'n', label: '⚧️ Neutro' },
];
function templateGender(t: { title?: string }): GenderKey {
  const s = String(t.title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\bmulher\b|feminin/.test(s)) return 'f';
  if (/\bhomem\b|masculin/.test(s)) return 'm';
  return 'n';
}
function filteredTemplates() {
  if (!state.msgGender) return state.templates;
  return state.templates.filter(t => templateGender(t) === state.msgGender);
}
function applyGenderFilter(g: GenderKey) {
  state.msgGender = state.msgGender === g ? '' : g;
  const list = filteredTemplates();
  // Template já salvo que sai da lista filtrada → cai no primeiro que restou.
  // Template novo (id null, ainda sem salvar) é preservado.
  if (state.msg.id != null && !list.some(t => String(t.id) === String(state.msg.id))) {
    state.msg = list[0]
      ? { id: list[0].id ?? null, title: list[0].title, body: list[0].body }
      : { id: null, title: '', body: '' };
  }
  render();
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
  const mode = state.msgDestMode;
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
  const listaBloco = `
    <div class="field">
      <div class="hint-inline">📋 Ao tocar em "Enviar para lista" você escolhe quais clientes recebem esta mensagem, um por um ou uma categoria inteira.</div>
    </div>`;

  const tpls = filteredTemplates();
  const options = ['<option value="">— Novo template —</option>']
    .concat(tpls.map(t =>
      `<option value="${t.id}" ${String(t.id) === String(cur.id) ? 'selected' : ''}>${esc(t.title)}</option>`))
    .join('');
  const genderFilter = `
    <div class="seg-control gender-filter">
      ${GENDER_BUTTONS.map(b =>
        `<button type="button" class="seg-btn${state.msgGender === b.key ? ' sel' : ''}" data-gf="${b.key}">${b.label}</button>`).join('')}
    </div>`;

  app.innerHTML = `
    <header class="appbar">
      <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
      <div style="flex:1"><h1>Mensagens</h1><span class="sub">Templates de WhatsApp</span></div>
    </header>
    <div class="screen">
      <div class="field">
        <label>Enviar para</label>
        <div class="seg-control">
          <button type="button" class="seg-btn${mode === 'pessoa' ? ' sel' : ''}" id="seg-pessoa">👤 Uma pessoa</button>
          <button type="button" class="seg-btn${mode === 'lista' ? ' sel' : ''}" id="seg-lista">📋 Lista de clientes</button>
        </div>
      </div>
      ${mode === 'pessoa' ? contatoBloco : listaBloco}
      <div class="field">
        <label>Template</label>
        ${genderFilter}
        <select id="tpl-sel">${options}</select>
        ${state.msgGender && !tpls.length ? '<div class="hint-inline">Nenhum template com esse gênero no título.</div>' : ''}
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
        <button class="btn-ghost" id="tpl-save">💾 Salvar</button>
        <button class="btn-save" id="${mode === 'lista' ? 'tpl-lista' : 'tpl-send'}">${mode === 'lista' ? '📋 Enviar para lista' : '📤 Enviar'}</button>
      </div>
    </div>`;

  byId('btn-back').onclick = () => { state.view = 'list'; render(); };
  byId('seg-pessoa').onclick = () => { state.msgDestMode = 'pessoa'; render(); };
  byId('seg-lista').onclick = () => { state.msgDestMode = 'lista'; render(); };
  document.querySelectorAll('.gender-filter [data-gf]').forEach(btn => {
    (btn as HTMLElement).onclick = () => applyGenderFilter((btn as HTMLElement).getAttribute('data-gf') as GenderKey);
  });
  if (mode === 'pessoa') {
    byId('ct-open-picker').onclick = () => openCustomers(true);
    byId('ct-novo').onclick = () => openContactSheet(null);
    if (byId('ct-limpar')) byId('ct-limpar').onclick = () => { state.customerId = null; render(); };
    if (byId('ct-edit')) byId('ct-edit').onclick = () => openContactSheet(currentCustomer());
    if (byId('ct-agenda')) byId('ct-agenda').onclick = pickFromDeviceContacts;
  }
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
  if (mode === 'lista') { byId('tpl-lista').onclick = openListaSheet; }
  else { byId('tpl-send').onclick = sendTemplate; }
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

/* ---------------- Envio em lista ----------------
   Duas fontes de destinatários:
   - Categorias fixas (📌): derivadas do último evento (customer_events.tipo) de cada customer —
     mesmo dado que já aparece na lista de Clientes, sem precisar cadastrar nada novo. Sempre no
     topo, atualizadas automaticamente.
   - Listas customizadas (state.customLists): membros escolhidos à mão pela usuária, persistidas
     via /api/settings (mesmo padrão de state.config.diasTrabalho). Aparecem abaixo das fixas.
   Só entram customers com telefone (sem telefone não dá pra abrir o WhatsApp). */
interface ListaCategoria { key: string; label: string; emoji: string; desc: string; tipos: string[] }
const LISTA_CATEGORIAS: ListaCategoria[] = [
  { key: 'cartao-aprovado', emoji: '✅', label: 'Cartão aprovado', desc: 'Proposta ou cartão aprovado.', tipos: ['cartao-aprovado', 'proposta-aprovada'] },
  { key: 'link-pendente', emoji: '🔗', label: 'Link pendente', desc: 'Aguardando o cliente preencher o link enviado.', tipos: ['link-pendente'] },
  { key: 'proposta-reprovada', emoji: '❌', label: 'Proposta reprovada', desc: 'Proposta recusada.', tipos: ['proposta-reprovada'] },
  { key: 'ficha-cartao', emoji: '📇', label: 'Ficha de cartão', desc: 'Ficha/proposta preenchida, aguardando decisão.', tipos: ['ficha-cartao'] },
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
function customersInList(list: CustomList): Customer[] {
  const ids = new Set(list.customerIds.map(String));
  return state.customers.filter((c) => c.phone && ids.has(String(c.id)));
}
function newListId(): string {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function persistCustomLists() {
  save(LS.customLists, state.customLists);
  saveSettingsRemote();
}

// Substitui o conteúdo do sheet já aberto (em vez de abrir um novo por cima) — os passos
// seguintes (menu → seleção → envio) reaproveitam o mesmo backdrop.
function setSheetContent(html: string, wire?: () => void) {
  const sheet = document.querySelector('.sheet');
  if (!sheet) return;
  sheet.innerHTML = html;
  if (wire) wire();
}

function listaMenuHTML(): string {
  const categorias = LISTA_CATEGORIAS
    .map((cat) => ({ cat, contatos: contatosDaCategoria(cat) }))
    .filter((x) => x.contatos.length > 0);
  const listas = state.customLists;

  const catsHTML = categorias.map(({ cat, contatos }) => `
    <button type="button" class="menu-item" data-cat="${cat.key}">
      <span class="mi-ico">${cat.emoji}</span>
      <span><span class="mi-pin">📌</span>${esc(cat.label)}<small>${esc(cat.desc)} · ${contatos.length} contato(s)</small></span>
    </button>`).join('');

  const listasHTML = listas.map((l) => `
    <div class="menu-item lista-row">
      <button type="button" class="mi-main" data-lista="${l.id}">
        <span class="mi-ico">📋</span>
        <span>${esc(l.name)}<small>${customersInList(l).length} contato(s)</small></span>
      </button>
      <button type="button" class="mi-edit" data-editar="${l.id}" aria-label="Editar lista">✏️</button>
    </div>`).join('');

  return `
    <h2>Enviar em lista</h2>
    <p class="status-line" style="margin:-4px 0 12px">Template atual: <b>${esc(state.msg.title || '(sem título)')}</b>. Escolha para quem enviar:</p>
    ${categorias.length ? catsHTML : '<p class="status-line">Nenhuma categoria automática disponível ainda.</p>'}
    <div class="sheet-subhead">Minhas listas</div>
    ${listasHTML || '<p class="status-line">Você ainda não criou nenhuma lista.</p>'}
    <button type="button" class="menu-item" id="lista-nova">
      <span class="mi-ico">➕</span><span>Criar nova lista</span>
    </button>`;
}

function wireListaMenu() {
  const categorias = LISTA_CATEGORIAS
    .map((cat) => ({ cat, contatos: contatosDaCategoria(cat) }))
    .filter((x) => x.contatos.length > 0);
  document.querySelectorAll('.sheet [data-cat]').forEach((btn) => {
    const key = (btn as HTMLElement).getAttribute('data-cat');
    const found = categorias.find((x) => x.cat.key === key);
    if (found) (btn as HTMLElement).onclick = () => renderListaSelecao(`${found.cat.emoji} ${found.cat.label}`, found.contatos);
  });
  document.querySelectorAll('.sheet [data-lista]').forEach((btn) => {
    const id = (btn as HTMLElement).getAttribute('data-lista');
    const l = state.customLists.find((x) => x.id === id);
    if (l) (btn as HTMLElement).onclick = () => renderListaSelecao('📋 ' + l.name, customersInList(l));
  });
  document.querySelectorAll('.sheet [data-editar]').forEach((btn) => {
    const id = (btn as HTMLElement).getAttribute('data-editar');
    const l = state.customLists.find((x) => x.id === id);
    if (l) (btn as HTMLElement).onclick = () => openEditarListaSheet(l);
  });
  byId('lista-nova').onclick = openNovaListaSheet;
}

function openListaSheet() {
  if (!state.msg.body.trim()) {
    toast('Escreva ou escolha um template antes de montar a lista', 'err');
    return;
  }
  openSheet(listaMenuHTML(), wireListaMenu);
}
function renderListaMenu() {
  setSheetContent(listaMenuHTML(), wireListaMenu);
}

// Helper compartilhado pelas 3 telas de escolher-quem (categoria fixa, lista customizada,
// criar/editar lista): rola só a lista de nomes — o botão de confirmar fica fixo no rodapé,
// sempre visível (não precisa rolar até o fim pra achar).
function renderCheckboxPicker(
  titulo: string,
  candidatos: Customer[],
  preSelecionados: Set<string>,
  labelConfirmar: (n: number) => string,
  onConfirmar: (escolhidos: Customer[]) => void,
) {
  const selecionados = new Set(preSelecionados);
  const rowsHTML = candidatos.map((c) => `
    <label class="check-row" data-ctid="${c.id}">
      <input type="checkbox" ${selecionados.has(String(c.id)) ? 'checked' : ''} />
      <span>${esc(customerLabel(c))}<small>${esc(c.phone || '')}</small></span>
    </label>`).join('');

  setSheetContent(`
    <h2>${esc(titulo)}</h2>
    <div class="lista-toolbar">
      <span class="status-line" style="margin:0" id="lista-count-txt">${selecionados.size} de ${candidatos.length} selecionado(s)</span>
      ${candidatos.length ? `<button type="button" class="link-btn" id="lista-toggle-todos">${selecionados.size === candidatos.length ? 'Desmarcar todos' : 'Marcar todos'}</button>` : ''}
    </div>
    <div id="lista-rows">${rowsHTML || '<p class="status-line">Nenhum cliente com telefone disponível.</p>'}</div>
    <div class="sheet-sticky-footer">
      <button type="button" id="lista-confirmar">${esc(labelConfirmar(selecionados.size))}</button>
    </div>
  `, () => {
    const atualizarToolbar = () => {
      const txt = byId('lista-count-txt');
      if (txt) txt.textContent = selecionados.size + ' de ' + candidatos.length + ' selecionado(s)';
      const toggle = byId('lista-toggle-todos');
      if (toggle) toggle.textContent = selecionados.size === candidatos.length ? 'Desmarcar todos' : 'Marcar todos';
      const btn = byId('lista-confirmar');
      if (btn) btn.textContent = labelConfirmar(selecionados.size);
    };
    document.querySelectorAll('#lista-rows [data-ctid]').forEach((row) => {
      const id = row.getAttribute('data-ctid') as string;
      const box = row.querySelector('input') as HTMLInputElement;
      box.onchange = () => {
        if (box.checked) selecionados.add(id); else selecionados.delete(id);
        atualizarToolbar();
      };
    });
    if (byId('lista-toggle-todos')) byId('lista-toggle-todos').onclick = () => {
      const marcarTudo = selecionados.size !== candidatos.length;
      candidatos.forEach((c) => {
        const id = String(c.id);
        if (marcarTudo) selecionados.add(id); else selecionados.delete(id);
      });
      document.querySelectorAll('#lista-rows [data-ctid] input').forEach((el) => { (el as HTMLInputElement).checked = marcarTudo; });
      atualizarToolbar();
    };
    byId('lista-confirmar').onclick = () => {
      const escolhidos = candidatos.filter((c) => selecionados.has(String(c.id)));
      onConfirmar(escolhidos);
    };
  });
}

function renderListaSelecao(titulo: string, contatos: Customer[]) {
  renderCheckboxPicker(
    titulo,
    contatos,
    new Set(contatos.map((c) => String(c.id))),   // pré-seleciona todo mundo, como hoje
    (n) => `📤 Começar envio (${n})`,
    (escolhidos) => {
      if (!escolhidos.length) { toast('Selecione ao menos um contato', 'err'); return; }
      renderListaEnvio(escolhidos, 0);
    },
  );
}

function openNovaListaSheet() {
  setSheetContent(`
    <h2>Nova lista</h2>
    <div class="field">
      <label>Nome da lista</label>
      <input id="nl-nome" type="text" placeholder="Ex.: Clientes VIP" />
    </div>
    <div class="actions">
      <button class="secondary" id="nl-cancelar">Voltar</button>
      <button class="primary" id="nl-continuar">Continuar</button>
    </div>
  `, () => {
    const inp = byId('nl-nome') as HTMLInputElement;
    inp.focus();
    byId('nl-cancelar').onclick = () => renderListaMenu();
    byId('nl-continuar').onclick = () => {
      const nome = inp.value.trim();
      if (!nome) { toast('Dê um nome para a lista', 'err'); return; }
      const candidatos = state.customers.filter((c) => c.phone);
      renderCheckboxPicker(
        nome,
        candidatos,
        new Set<string>(),   // lista nova começa vazia — a usuária escolhe quem entra
        (n) => `Criar lista (${n})`,
        (escolhidos) => {
          if (!escolhidos.length) { toast('Selecione ao menos um contato', 'err'); return; }
          saveNewList(nome, escolhidos.map((c) => c.id as string | number));
        },
      );
    };
  });
}

function saveNewList(nome: string, ids: (string | number)[]) {
  const lista: CustomList = { id: newListId(), name: nome, customerIds: ids };
  state.customLists.push(lista);
  persistCustomLists();
  toast('Lista criada ✓', 'ok');
  renderListaMenu();
}

function openEditarListaSheet(list: CustomList) {
  const candidatos = state.customers.filter((c) => c.phone);
  renderCheckboxPicker(
    '✏️ ' + list.name,
    candidatos,
    new Set(list.customerIds.map(String)),
    (n) => `Salvar (${n})`,
    (escolhidos) => {
      list.customerIds = escolhidos.map((c) => c.id as string | number);
      persistCustomLists();
      toast('Lista atualizada ✓', 'ok');
      renderListaMenu();
    },
  );
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
