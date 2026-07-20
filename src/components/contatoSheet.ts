import type { Contact } from '../types.js';
import { apiUrl } from '../env.js';
import { state, sessionValid } from '../state.js';
import { authHeaders, isOnline, pullContacts } from '../api.js';
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
    byId('ct-save').onclick = async () => {
      const dados: Contact = {
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
