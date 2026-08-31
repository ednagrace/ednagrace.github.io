import type { Customer } from '../types.js';
import { state, sessionValid } from '../state.js';
import { isOnline, pullCustomers, saveCustomer, deleteCustomer } from '../api.js';
import { openSheet, closeSheet, toast } from '../ui.js';
import { render } from '../render.js';
import { esc, byId } from '../format.js';
import { customerLabel, contactPickerAvailable, saveToDeviceContacts } from '../customers.js';
import { GENERO_OUTRO_NOTA } from '../constants.js';

/* ---------- Customer: pick from device address book + create/edit form ----------
   Sem seção de vínculo (era contato <-> cliente, duas entidades separadas) — agora é um
   formulário só, pros campos de agenda (nome/telefone/email/gênero) e de cadastro
   (sequência/limite) do mesmo registro. */
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

export function openContactSheet(c: Customer | null, onSaved?: (c: Customer) => void) {
  const cur: Customer = c || { id: undefined, name: '', phone: '', email: '', gender: '' };
  const isNew = !cur.id;
  let gender = String(cur.gender || '');   // '' = não informar; muda pelos botões abaixo

  openSheet(`
    <h2>${isNew ? 'Novo cliente' : 'Editar cliente'}</h2>
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
      <div class="seg-control gender-filter" id="ct-gender">
        ${([['masculino', '♂️ Homem'], ['feminino', '♀️ Mulher'], ['outro', '⚧️ Outro']] as const)
          .map(([g, l]) => `<button type="button" class="seg-btn${gender === g ? ' sel' : ''}" data-g="${g}">${l}</button>`).join('')}
      </div>
      <div class="status-line">Sem marcar = não informar. Define a concordância nas mensagens (atalho <code>{oae}</code>: querido / querida / queride).</div>
      <div class="status-line hint-incl">${GENERO_OUTRO_NOTA}</div>
    </div>
    <div class="field">
      <label>Sequência (opcional)</label>
      <input id="ct-seq" type="text" value="${esc(cur.sequencia || '')}" placeholder="Ex.: 3208480" />
    </div>
    <div class="field">
      <label>Limite do cartão (opcional)</label>
      <input id="ct-limite" type="number" inputmode="decimal" step="0.01"
        value="${cur.limite != null && cur.limite !== '' ? esc(String(cur.limite)) : ''}"
        placeholder="Ex.: 500" />
    </div>
    <label class="check-row">
      <input type="checkbox" id="ct-agenda-save" />
      <span>Salvar também na agenda do celular
        <small>Gera o cartão de contato — o celular pergunta se quer adicionar.</small></span>
    </label>
    <div class="actions">
      ${!isNew ? '<button class="secondary" id="ct-del">🗑️ Excluir</button>' : ''}
      <button class="primary" id="ct-save" style="flex:1">Salvar</button>
    </div>
    <div class="status-line" id="ct-status"></div>
  `, () => {
    document.querySelectorAll('#ct-gender .seg-btn').forEach((b) => {
      (b as HTMLElement).onclick = () => {
        const g = (b as HTMLElement).getAttribute('data-g') as string;
        gender = gender === g ? '' : g;   // tocar de novo no ativo volta pra "não informar"
        document.querySelectorAll('#ct-gender .seg-btn').forEach((x) => x.classList.remove('sel'));
        if (gender) b.classList.add('sel');
      };
    });
    byId('ct-save').onclick = async () => {
      const dados: any = {
        id: cur.id || undefined,
        name: byId('ct-name').value.trim(),
        phone: byId('ct-phone').value.trim(),
        email: byId('ct-email').value.trim(),
        gender,
        sequencia: (byId('ct-seq') as HTMLInputElement).value.trim(),
      };
      const lim = (byId('ct-limite') as HTMLInputElement).value;
      if (lim) dados.limite = Number(lim);
      if (!dados.name && !dados.phone && !dados.email && !dados.sequencia) {
        byId('ct-status').textContent = 'Preencha ao menos nome, telefone, e-mail ou sequência.';
        byId('ct-status').style.color = '#d10a11';
        return;
      }

      const alsoSaveToAddressBook = (byId('ct-agenda-save') as HTMLInputElement).checked;
      if (!isOnline() || !sessionValid()) { toast('Conecte à internet para salvar', 'err'); return; }

      // Address book FIRST, still inside the tap gesture (Android requires this).
      // Uses the form data — no need to wait for the database.
      if (alsoSaveToAddressBook) saveToDeviceContacts(dados);

      const btn = byId('ct-save') as HTMLButtonElement;
      btn.disabled = true;
      const r = await saveCustomer(dados);
      if (!r.ok || !r.customer) {
        btn.disabled = false;
        byId('ct-status').textContent = 'Erro: ' + (r.error || 'não foi possível salvar');
        byId('ct-status').style.color = '#d10a11';
        return;
      }
      await pullCustomers();
      state.customerId = r.customer.id ?? null;
      closeSheet();
      render();
      if (!alsoSaveToAddressBook) toast('Cliente salvo ✓', 'ok');
      if (onSaved) onSaved(r.customer);
    };
    if (byId('ct-del')) byId('ct-del').onclick = async () => {
      if (!window.confirm('Excluir “' + customerLabel(cur) + '”?')) return;
      if (!isOnline() || !sessionValid()) { toast('Conecte à internet para excluir', 'err'); return; }
      const r = await deleteCustomer(cur.id!);
      if (!r.ok) { toast('Erro: ' + (r.error || 'não foi possível excluir'), 'err'); return; }
      await pullCustomers();
      state.customerId = null;
      closeSheet();
      render();
      toast('Cliente excluído', 'ok');
    };
  });
}
