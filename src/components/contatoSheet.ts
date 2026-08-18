import type { Contact, Cliente } from '../types.js';
import { apiUrl } from '../env.js';
import { state, sessionValid } from '../state.js';
import { authHeaders, isOnline, pullContacts, searchClientes } from '../api.js';
import { openSheet, closeSheet, toast } from '../ui.js';
import { render } from '../render.js';
import { esc, byId } from '../format.js';
import { contactLabel, contactPickerAvailable, saveToDeviceContacts } from '../contacts.js';
import { refreshSession } from '../auth.js';

/* ---------- Contacts: pick from device address book + editor ---------- */
export async function pickFromDeviceContacts() {
  if (!contactPickerAvailable()) { toast('Seu navegador não permite ler a agenda', 'err'); return; }
  try {
    const sel = await (navigator as any).contacts.select(['name', 'tel', 'email'], { multiple: false });
    if (!sel || !sel.length) return;
    const a = sel[0];
    openContactSheet({
      id: undefined,
      name: (a.name && a.name[0]) || '',
      phone: (a.tel && a.tel[0]) || '',
      email: (a.email && a.email[0]) || '',
      gender: '',
    });
  } catch (e) {
    toast('Não foi possível abrir a agenda', 'err');
  }
}

export function openContactSheet(c: Contact | null) {
  const cur: Contact = c || { id: undefined, name: '', phone: '', email: '', gender: '' };
  const isNew = !cur.id;

  // Cliente-link state lives in this closure (not global) — it's only ever touched from
  // within this one sheet session.
  let linked: Cliente | null = cur.cliente || null;
  let showCreate = false;
  let searchResults: Cliente[] = [];
  let autoSuggest: Cliente | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  openSheet(`
    <h2>${isNew ? 'Novo contato' : 'Editar contato'}</h2>
    <div class="field">
      <label>Nome (opcional)</label>
      <input id="ct-name" type="text" value="${esc(cur.name || '')}" placeholder="Ex.: Maria Silva" />
    </div>
    <div class="field">
      <label>Telefone (opcional)</label>
      <input id="ct-phone" type="tel" inputmode="tel" value="${esc(cur.phone || '')}" placeholder="(19) 99999-9999" />
    </div>
    <div class="field">
      <label>E-mail (opcional)</label>
      <input id="ct-email" type="email" inputmode="email" value="${esc(cur.email || '')}" placeholder="maria@email.com" />
    </div>
    <div class="field">
      <label>Gênero (opcional)</label>
      <select id="ct-gender">
        <option value="" ${!cur.gender ? 'selected' : ''}>— Não informar —</option>
        <option value="feminino" ${cur.gender === 'feminino' ? 'selected' : ''}>Feminino</option>
        <option value="masculino" ${cur.gender === 'masculino' ? 'selected' : ''}>Masculino</option>
        <option value="outro" ${cur.gender === 'outro' ? 'selected' : ''}>Outro</option>
      </select>
    </div>
    <div class="field" id="cl-section"></div>
    <label class="check-row">
      <input type="checkbox" id="ct-agenda-save" />
      <span>Salvar também na agenda do celular
        <small>Gera o cartão de contato — o celular pergunta se quer adicionar.</small></span>
    </label>
    <div class="actions">
      ${!isNew ? '<button class="secondary" id="ct-del">🗑️ Excluir</button>' : ''}
      <button class="primary" id="ct-save" style="flex:1">Salvar contato</button>
    </div>
    <div class="status-line" id="ct-status"></div>
  `, () => {
    /* ---------- Vínculo a cliente cadastrado (sequência do sistema da Edna) ---------- */
    function renderClSection() {
      const box = byId('cl-section');
      if (linked) {
        box.innerHTML = `
          <label>Cliente vinculado</label>
          <div class="cl-linked">
            <div><b>${esc(linked.nome || 'Sem nome')}</b> · seq ${esc(linked.sequencia)}</div>
            ${linked.telefone ? `<div class="ct-sub">${esc(linked.telefone)}</div>` : ''}
            ${linked.limite != null ? `<div class="ct-sub">Limite: R$ ${esc(String(linked.limite))}</div>` : ''}
          </div>
          <button type="button" class="ct-btn" id="cl-unlink" style="margin-top:8px">✖️ Desvincular</button>`;
        byId('cl-unlink').onclick = () => { linked = null; renderClSection(); };
        return;
      }
      box.innerHTML = `
        <label>Vincular a um cliente (opcional)</label>
        ${autoSuggest ? `
        <button type="button" class="cl-suggest" id="cl-auto">
          📞 Telefone bate com <b>${esc(autoSuggest.nome || autoSuggest.sequencia)}</b> (seq ${esc(autoSuggest.sequencia)}) — vincular
        </button>` : ''}
        ${!showCreate ? `
        <input id="cl-search" type="text" placeholder="Buscar cliente por nome ou sequência" />
        <div class="cl-results" id="cl-results"></div>
        <button type="button" class="ct-btn" id="cl-toggle-create" style="margin-top:8px">➕ Cliente não cadastrado ainda</button>
        ` : `
        <div class="cl-create">
          <div class="field"><label>Sequência (obrigatório)</label><input id="cl-seq" type="text" placeholder="Ex.: 3208480" /></div>
          <div class="field"><label>Limite do cartão (opcional)</label><input id="cl-limite" type="number" inputmode="decimal" step="0.01" placeholder="Ex.: 500" /></div>
          <button type="button" class="ct-btn" id="cl-cancel-create">Cancelar</button>
        </div>`}`;
      if (byId('cl-auto')) byId('cl-auto').onclick = () => { linked = autoSuggest; renderClSection(); };
      if (byId('cl-toggle-create')) byId('cl-toggle-create').onclick = () => { showCreate = true; renderClSection(); };
      if (byId('cl-cancel-create')) byId('cl-cancel-create').onclick = () => { showCreate = false; renderClSection(); };
      if (byId('cl-search')) {
        (byId('cl-search') as HTMLInputElement).oninput = () => {
          clearTimeout(searchTimer);
          const q = (byId('cl-search') as HTMLInputElement).value;
          searchTimer = setTimeout(async () => {
            searchResults = q.trim() ? await searchClientes(q) : [];
            renderClResults();
          }, 300);
        };
      }
      renderClResults();
    }
    function renderClResults() {
      const el = byId('cl-results');
      if (!el) return;
      el.innerHTML = searchResults.map((cl) => `
        <button type="button" class="cl-result" data-cl="${cl.id}">
          <b>${esc(cl.nome || 'Sem nome')}</b> · seq ${esc(cl.sequencia)}${cl.telefone ? ' · ' + esc(cl.telefone) : ''}
        </button>`).join('');
      Array.from(el.querySelectorAll('[data-cl]')).forEach((btn) => {
        (btn as HTMLElement).onclick = () => {
          const id = (btn as HTMLElement).getAttribute('data-cl');
          linked = searchResults.find((x) => String(x.id) === id) || null;
          searchResults = [];
          renderClSection();
        };
      });
    }
    renderClSection();
    // Sugestão automática: só para contato ainda sem vínculo e com telefone preenchido.
    // Só aceita como sugestão um telefone IGUAL (não uma busca ampla) — decisão de design:
    // vínculo automático = telefone bate exatamente.
    if (!linked && cur.phone) {
      const digits = cur.phone.replace(/\D/g, '');
      searchClientes(cur.phone).then((list) => {
        if (linked || digits.length < 8) return;
        const exact = list.find((cl) => (cl.telefone || '').replace(/\D/g, '') === digits);
        if (exact) { autoSuggest = exact; renderClSection(); }
      });
    }

    byId('ct-save').onclick = async () => {
      const dados: any = {
        id: cur.id || undefined,
        name: byId('ct-name').value.trim(),
        phone: byId('ct-phone').value.trim(),
        email: byId('ct-email').value.trim(),
        gender: byId('ct-gender').value,
      };
      if (!dados.name && !dados.phone && !dados.email) {
        byId('ct-status').textContent = 'Preencha ao menos nome, telefone ou e-mail.';
        byId('ct-status').style.color = '#d10a11';
        return;
      }
      if (showCreate) {
        const seq = (byId('cl-seq') as HTMLInputElement).value.trim();
        if (!seq) {
          byId('ct-status').textContent = 'Informe a sequência do cliente novo (ou toque em Cancelar).';
          byId('ct-status').style.color = '#d10a11';
          return;
        }
        dados.clienteSequencia = seq;
        const lim = (byId('cl-limite') as HTMLInputElement).value;
        if (lim) dados.clienteLimite = Number(lim);
      } else if (linked) {
        dados.clienteId = linked.id;
      } else if (cur.clienteId) {
        dados.clienteId = null; // era vinculado, usuário desvinculou
      }
      // senão: nem toca no campo — preserva o que já estava (undefined some no JSON)

      const alsoSaveToAddressBook = byId('ct-agenda-save').checked;
      if (!isOnline() || !sessionValid()) { toast('Conecte à internet para salvar', 'err'); return; }

      // Address book FIRST, still inside the tap gesture (Android requires this).
      // Uses the form data — no need to wait for the database.
      if (alsoSaveToAddressBook) saveToDeviceContacts(dados);

      try {
        const res = await fetch(apiUrl('/api/contacts'), {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ contact: dados }),
        });
        if (res.status === 401) { refreshSession(); toast('Faça login novamente', 'err'); return; }
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'falha');
        await pullContacts();
        state.contatoId = data.contact.id;
        closeSheet();
        render();
        if (!alsoSaveToAddressBook) toast('Contato salvo ✓', 'ok');
      } catch (e: any) { toast('Erro: ' + e.message, 'err'); }
    };
    if (byId('ct-del')) byId('ct-del').onclick = async () => {
      if (!window.confirm('Excluir o contato “' + contactLabel(cur) + '”?')) return;
      if (!isOnline() || !sessionValid()) { toast('Conecte à internet para excluir', 'err'); return; }
      try {
        const res = await fetch(apiUrl('/api/contacts?id=' + encodeURIComponent(String(cur.id))), {
          method: 'DELETE', headers: authHeaders(),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'falha');
        await pullContacts();
        state.contatoId = null;
        closeSheet();
        render();
        toast('Contato excluído', 'ok');
      } catch (e: any) { toast('Erro: ' + e.message, 'err'); }
    };
  });
}
