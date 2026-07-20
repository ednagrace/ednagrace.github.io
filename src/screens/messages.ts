import { state, sessionValid } from '../state.js';
import { app, render } from '../render.js';
import { pad } from '../dateUtils.js';
import { esc, byId } from '../format.js';
import { isOnline, pullContacts, pullTemplates, authHeaders } from '../api.js';
import { apiUrl } from '../env.js';
import { refreshSession } from '../auth.js';
import { toast } from '../ui.js';
import { currentContact, contactLabel, phoneDigits, contactPickerAvailable } from '../contacts.js';
import { openContactSheet, pickFromDeviceContacts } from '../components/contatoSheet.js';

/* ---------------- SCREEN: MESSAGES (templates) ---------------- */
export function openMsg() {
  pullTemplates().then(() => { if (state.view === 'msg') { selectFirstTemplate(); render(); } });
  pullContacts().then(() => { if (state.view === 'msg') render(); });
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
function contactGenderSuffix(): string {
  const c = currentContact();
  const g = c && c.gender ? String(c.gender).toLowerCase() : '';
  if (g === 'masculino') return 'o';
  if (g === 'feminino') return 'a';
  return 'o(a)';
}
function applyPlaceholders(s: string): string {
  const d = new Date();
  const today = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  const c = currentContact();
  return String(s || '')
    .replace(/{saudacao}/gi, greetingNow())
    .replace(/{contato}/gi, c ? ((c.name || '').trim() || contactLabel(c)) : '')
    .replace(/{oa}/gi, contactGenderSuffix())
    .replace(/{hoje}/gi, today)
    .replace(/{promotora}/gi, state.config.promotora || '')
    .replace(/{loja}/gi, state.config.loja || '');
}

export function renderMsg() {
  const cur = state.msg;
  const todayFmt = (() => { const d = new Date(); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); })();
  const ct = currentContact();
  const phTable = `
    <div class="ph-table">
      <button type="button" class="ph-row" data-ph="{saudacao}"><code>{saudacao}</code><span>${greetingNow()} <i>(muda com a hora)</i></span></button>
      <button type="button" class="ph-row" data-ph="{contato}"><code>{contato}</code><span>${ct ? esc(contactLabel(ct)) : '<i>nome do contato escolhido</i>'}</span></button>
      <button type="button" class="ph-row" data-ph="{oa}"><code>{oa}</code><span>${esc(contactGenderSuffix())} <i>— ex.: atendê-l{oa} → atendê-l${esc(contactGenderSuffix())}</i></span></button>
      <button type="button" class="ph-row" data-ph="{hoje}"><code>{hoje}</code><span>${todayFmt}</span></button>
      <button type="button" class="ph-row" data-ph="{promotora}"><code>{promotora}</code><span>${esc(state.config.promotora)}</span></button>
      <button type="button" class="ph-row" data-ph="{loja}"><code>{loja}</code><span>${esc(state.config.loja)}</span></button>
    </div>`;

  const contatoOpts = ['<option value="">— Sem contato (escolher no WhatsApp) —</option>']
    .concat(state.contacts.map(c =>
      `<option value="${c.id}" ${String(c.id) === String(state.contatoId) ? 'selected' : ''}>${esc(contactLabel(c))}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`))
    .join('');

  const contatoBloco = `
    <div class="field">
      <label>Contato (opcional)</label>
      <select id="ct-sel">${contatoOpts}</select>
      <div class="ct-buttons">
        ${contactPickerAvailable() ? '<button type="button" class="ct-btn" id="ct-agenda">📇 Da agenda</button>' : ''}
        <button type="button" class="ct-btn" id="ct-novo">➕ Novo contato</button>
        ${ct ? '<button type="button" class="ct-btn" id="ct-edit">✏️ Editar</button>' : ''}
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
        <button class="btn-ghost" id="tpl-save">💾 Salvar</button>
        <button class="btn-save" id="tpl-send">📤 Enviar</button>
      </div>
    </div>`;

  byId('btn-back').onclick = () => { state.view = 'list'; render(); };
  byId('ct-sel').onchange = (e: Event) => { state.contatoId = (e.target as HTMLSelectElement).value || null; render(); };
  byId('ct-novo').onclick = () => openContactSheet(null);
  if (byId('ct-edit')) byId('ct-edit').onclick = () => openContactSheet(currentContact());
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
  if (byId('tpl-del')) byId('tpl-del').onclick = deleteTemplate;
}

function sendTemplate() {
  const txt = applyPlaceholders(state.msg.body);
  if (!txt.trim()) { toast('Mensagem vazia', 'err'); return; }
  const c = currentContact();
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
