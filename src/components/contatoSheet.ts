import type { Customer, CustomerDraft, PhotoMeta } from '../types.js';
import { state, sessionValid } from '../state.js';
import { isOnline, pullCustomers, saveCustomer, deleteCustomer, aiPhotoMeta, sendCustomerPhoto, addCustomerEvent } from '../api.js';
import { openSheet, closeSheet, toast, confirmDiscard } from '../ui.js';
import { render } from '../render.js';
import { esc, byId } from '../format.js';
import { todayISO } from '../dateUtils.js';
import { customerLabel, contactPickerAvailable, saveToDeviceContacts, TIPOS_NOVA_NOTA, tipoDesc, tipoSelectHTML } from '../customers.js';
import { downscalePhoto, wirePhotoPicker } from '../photo.js';

/* ---------- Customer: pick from device address book + create/edit form ----------
   Sem seção de vínculo (era contato <-> cliente, duas entidades separadas) — agora é um
   formulário só, pros campos de agenda (nome/telefone/email/gênero) e de cadastro
   (sequência/limite) do mesmo registro.

   Também traz a leitura por foto (mesma IA/cota da foto do relatório): a promotora
   tira foto de uma ficha/cadastro e os campos preenchem sozinhos; se a foto tiver
   uma observação, a seção "Nota" abre já preenchida e vira o primeiro evento do
   histórico ao salvar. */
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

  // Assinatura do formulário para detectar edição pendente antes de descartar (voltar
  // = tocar fora do sheet). Capturada logo depois que o sheet abre; comparada no dismiss.
  let initialSig = '';
  const formSig = () => {
    const v = (id: string) => (byId(id) as HTMLInputElement | null)?.value ?? '';
    return JSON.stringify([
      v('ct-name'), v('ct-phone'), v('ct-email'), v('ct-seq'), v('ct-limite'),
      gender, v('ct-nota-obs'),
    ]);
  };

  // Estado local da leitura por foto (não usa state.photo — aquele é do formulário do relatório).
  let photoMeta: PhotoMeta | null = null;
  let photoBusy = false;
  let photoErr = '';

  function photoBarHTML(): string {
    // Ambiente de teste + não-admin: a feature nem aparece.
    if (photoMeta && !photoMeta.allowed) {
      return '<div class="ph-hint">📸 Leitura por foto indisponível no ambiente de teste.</div>';
    }
    const u = photoMeta && photoMeta.usage;
    const quotaOn = !photoMeta || photoMeta.quotaEnabled;
    const blocked = !!u && quotaOn && !u.podeUsar;

    let cota = '';
    if (photoMeta && !quotaOn) {
      cota = '<span class="ph-cota warn">Cota desligada (teste)</span>';
    } else if (u) {
      cota = blocked
        ? '<span class="ph-cota warn">Limite de fotos atingido — a cota zera na segunda-feira</span>'
        : `<span class="ph-cota">resta ${Math.max(0, u.limiteDia - u.dia)} hoje · ${Math.max(0, u.limiteSemana - u.semana)} na semana</span>`;
    }

    const acoes = photoBusy
      ? `<button type="button" class="pdf-btn ph-btn" disabled>⏳ Lendo a foto…</button>`
      : `<div class="ph-actions">
           <button type="button" class="pdf-btn ph-btn" id="ct-photo-cam" ${blocked ? 'disabled' : ''}>📷 Tirar foto</button>
           <button type="button" class="pdf-btn ph-btn" id="ct-photo-gallery" ${blocked ? 'disabled' : ''}>🖼️ Da galeria</button>
         </div>`;

    return `${acoes}<div class="ph-hint">${photoErr ? `<span class="warn">${esc(photoErr)}</span>` : cota}</div>`;
  }

  function refreshPhotoBar() {
    const bar = byId('ct-photo-bar');
    if (!bar) return;
    bar.innerHTML = photoBarHTML();
    wirePhotoPicker({
      camBtnId: 'ct-photo-cam', galleryBtnId: 'ct-photo-gallery', fileId: 'ct-photo-file',
      onPick: onPhotoPicked,
    });
  }

  // Preenche só os campos que ainda estão vazios — não apaga o que a promotora já digitou.
  function applyDraft(d: CustomerDraft) {
    const setIfEmpty = (id: string, val?: string | number | null) => {
      const el = byId(id) as HTMLInputElement;
      if (el && !el.value.trim() && val != null && String(val) !== '') el.value = String(val);
    };
    setIfEmpty('ct-name', d.name);
    setIfEmpty('ct-phone', d.phone);
    setIfEmpty('ct-email', d.email);
    setIfEmpty('ct-seq', d.sequencia);
    setIfEmpty('ct-limite', d.limite);

    if (d.gender && !gender && ['masculino', 'feminino', 'outro'].includes(d.gender)) {
      gender = d.gender;
      document.querySelectorAll('#ct-gender .seg-btn').forEach((x) => x.classList.remove('sel'));
      const btn = document.querySelector(`#ct-gender .seg-btn[data-g="${gender}"]`);
      if (btn) btn.classList.add('sel');
    }

    if (d.nota && d.nota.trim()) {
      const box = byId('ct-nota-box') as HTMLDetailsElement | null;
      if (box) box.open = true;
      const obs = byId('ct-nota-obs') as HTMLTextAreaElement | null;
      if (obs && !obs.value.trim()) obs.value = d.nota.trim();
      const sel = byId('ct-nota-tipo') as HTMLSelectElement | null;
      if (sel && d.notaTipo && [...sel.options].some((o) => o.value === d.notaTipo)) {
        sel.value = d.notaTipo;
        byId('ct-nota-desc').textContent = tipoDesc(sel.value);
      }
    }
  }

  async function onPhotoPicked(f: File) {
    if (photoBusy) return;
    if (!isOnline() || !sessionValid()) { toast('Conecte à internet para ler a foto', 'err'); return; }
    photoBusy = true; photoErr = '';
    refreshPhotoBar();
    try {
      const base64 = await downscalePhoto(f);
      if (!base64) throw new Error('não consegui abrir essa imagem');
      const { draft, meta } = await sendCustomerPhoto(base64, 'image/jpeg');
      if (meta) photoMeta = meta;
      photoBusy = false;
      refreshPhotoBar();
      applyDraft(draft);
      toast('Confira os dados lidos da foto ✍️', 'ok');
    } catch (err: any) {
      photoBusy = false;
      if (err && err.meta) photoMeta = err.meta;
      photoErr = (err && err.message) || 'não consegui ler a foto';
      refreshPhotoBar();
    }
  }

  openSheet(`
    <h2>${isNew ? 'Novo cliente' : 'Editar cliente'}</h2>
    <div id="ct-photo-bar" class="photo-bar">${photoBarHTML()}</div>
    <input type="file" id="ct-photo-file" accept="image/*" hidden />
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
    <details class="nota-box" id="ct-nota-box">
      <summary>🗒️ Adicionar nota (opcional)</summary>
      <div class="field" style="margin-top:12px">
        <label>Tipo</label>
        ${tipoSelectHTML('ct-nota-tipo')}
        <div class="status-line" id="ct-nota-desc">${esc(tipoDesc(TIPOS_NOVA_NOTA[0].value))}</div>
      </div>
      <div class="field">
        <label>Observação</label>
        <textarea id="ct-nota-obs" placeholder="Ex.: cliente pediu para retornar em outubro"></textarea>
      </div>
    </details>
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

    const notaTipo = byId('ct-nota-tipo') as HTMLSelectElement;
    if (notaTipo) notaTipo.onchange = () => { byId('ct-nota-desc').textContent = tipoDesc(notaTipo.value); };

    refreshPhotoBar();
    aiPhotoMeta().then((m) => { if (byId('ct-photo-bar')) { photoMeta = m; refreshPhotoBar(); } });

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

      // Read the note fields before saving (closeSheet later wipes the DOM).
      const notaObs = (byId('ct-nota-obs') as HTMLTextAreaElement | null)?.value.trim() || '';
      const notaTipoVal = (byId('ct-nota-tipo') as HTMLSelectElement | null)?.value || 'nota-geral';

      const btn = byId('ct-save') as HTMLButtonElement;
      btn.disabled = true;
      const r = await saveCustomer(dados);
      if (!r.ok || !r.customer) {
        btn.disabled = false;
        byId('ct-status').textContent = 'Erro: ' + (r.error || 'não foi possível salvar');
        byId('ct-status').style.color = '#d10a11';
        return;
      }

      // Nota opcional → primeiro evento do histórico (precisa do id do cliente já salvo).
      let notaOk = true;
      if (notaObs && r.customer.id != null) {
        const ev = await addCustomerEvent({
          customerId: r.customer.id, tipo: notaTipoVal, observacao: notaObs,
          dataEvento: todayISO(), loja: state.config.loja,
        });
        notaOk = ev.ok;
      }

      await pullCustomers();
      state.customerId = r.customer.id ?? null;
      closeSheet();
      render();
      if (!notaOk) {
        toast('Cliente salvo — a nota falhou, adicione pela tela do cliente', 'err');
      } else if (!alsoSaveToAddressBook) {
        toast(notaObs ? 'Cliente e nota salvos ✓' : 'Cliente salvo ✓', 'ok');
      }
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

    initialSig = formSig();
  }, () => confirmDiscard(formSig() !== initialSig));
}
