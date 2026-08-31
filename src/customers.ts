import type { Customer, CustomerEvent } from './types.js';
import { state } from './state.js';
import { toast } from './ui.js';
import { pad, parseISO } from './dateUtils.js';

export function currentCustomer(): Customer | null {
  return state.customers.find(c => String(c.id) === String(state.customerId)) || null;
}
export function customerLabel(c: Customer): string {
  return (c.name && c.name.trim()) || c.phone || c.email || (c.sequencia ? 'seq ' + c.sequencia : '') || 'Sem nome';
}
// Normalizes a BR phone number into wa.me format (country code 55 + area code + number).
export function phoneDigits(p?: string | null): string {
  let d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = '55' + d;   // missing country code
  return d;
}
// Número de celular BR: DDD (2 dígitos) + 9 + 8 dígitos = 11 dígitos, 3º dígito '9'.
// Fixo não costuma ter WhatsApp. Não é coluna no banco — calculada na hora, pra não ficar
// desatualizada se o telefone for editado. Mesmo cálculo em espelho no back-end
// (relatorio-api/api/customers.js, filtro ?whatsapp=1).
export function looksLikeWhatsApp(phone?: string | null): boolean {
  const d = String(phone || '').replace(/\D/g, '').replace(/^55/, '');
  return d.length === 11 && d[2] === '9';
}
// The device address book can only be READ (Contact Picker). To "save to the address
// book" we generate a .vcf card and Android asks whether to add it to contacts.
export function contactPickerAvailable(): boolean {
  return !!((navigator as any).contacts && (navigator as any).contacts.select && (window as any).ContactsManager);
}
export function vcardFor(c: Customer): string {
  // FN is required in vCard 3.0 — without it Android rejects the card.
  // If there's no name, use the phone (or email) as the identifier.
  const nome = (c.name || '').trim() || (c.phone || '').trim() || (c.email || '').trim() || 'Contato';
  const l = ['BEGIN:VCARD', 'VERSION:3.0'];
  l.push('FN:' + nome);
  l.push('N:' + nome + ';;;;');
  if (c.phone) l.push('TEL;TYPE=CELL:' + c.phone);
  if (c.email) l.push('EMAIL;TYPE=INTERNET:' + c.email);
  l.push('END:VCARD');
  return l.join('\r\n');
}
// IMPORTANT: must be called INSIDE the tap gesture (before any await), otherwise
// Android blocks navigator.share().
export function saveToDeviceContacts(c: Customer) {
  const blob = new Blob([vcardFor(c)], { type: 'text/vcard;charset=utf-8' });
  const nome = ((c.name || c.phone || 'contato') + '').replace(/[^\w\-]+/g, '_') + '.vcf';
  const file = new File([blob], nome, { type: 'text/vcard' });

  // 1) try the native share sheet (Android offers "Contacts")
  if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
    (navigator as any).share({ files: [file], title: c.name || 'Contato' })
      .catch(() => downloadVcf(blob, nome));   // if declined/fails, download the card
    return;
  }
  // 2) fallback: download the .vcf — tapping the notification opens "add to contacts"
  downloadVcf(blob, nome);
}

function downloadVcf(blob: Blob, nome: string) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    toast('Cartão salvo — toque na notificação para adicionar aos contatos', 'ok');
  } catch (e) {
    toast('Não foi possível gerar o cartão de contato', 'err');
  }
}

function fmtDateBR(iso?: string | null): string {
  if (!iso) return '';
  const d = parseISO(iso);
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
}

export interface TipoDef { value: string; emoji: string; label: string; desc: string }
// Opções oferecidas ao criar uma nota nova. Cada resultado aparece só uma vez aqui — antes
// "Cartão aprovado" e "Aprovada" eram duas entradas pro mesmo resultado (uma do vocabulário
// atual do app, outra herdada da digitalização do caderno antigo), confuso na hora de escolher.
// Mesma lista usada no formulário de "Nova nota" — precisa bater com TIPOS_EVENTO em
// relatorio-api/api/customers.js.
export const TIPOS_NOVA_NOTA: TipoDef[] = [
  { value: 'cartao-aprovado', emoji: '✅', label: 'Cartão aprovado', desc: 'Proposta ou cartão aprovado.' },
  { value: 'proposta-reprovada', emoji: '❌', label: 'Reprovada', desc: 'Proposta recusada.' },
  { value: 'link-pendente', emoji: '🔗', label: 'Link pendente', desc: 'Aguardando o cliente preencher o link enviado.' },
  { value: 'ficha-cartao', emoji: '📇', label: 'Ficha de cartão', desc: 'Ficha/proposta preenchida, aguardando decisão.' },
  { value: 'nota-geral', emoji: '🗒️', label: 'Nota geral', desc: 'Observação solta, sem categoria específica.' },
];
// `tipo` vem cru da digitalização das fotos (ex.: "nota-geral;proposta-reprovada") — pode ter
// mais de uma etiqueta separada por ";". Rótulos pra EXIBIR qualquer tag já usada em algum
// evento — inclui `proposta-aprovada`, tag antiga da digitalização que não aparece mais como
// opção em "Nova nota" (mesmo significado de `cartao-aprovado`), mas que eventos antigos ainda
// carregam e precisam mostrar certo.
export const TIPO_LABELS: [string, string][] = [
  ...TIPOS_NOVA_NOTA.map((t): [string, string] => [t.value, t.emoji + ' ' + t.label]),
  ['proposta-aprovada', '✅ Cartão aprovado'],
];
export function eventLabel(ev: CustomerEvent): string {
  const tags = String(ev.tipo || '').split(';').map((s) => s.trim());
  const found = TIPO_LABELS.find(([tag]) => tags.includes(tag));
  const label = found ? found[1] : (tags[0] ? '🗒️ ' + tags[0] : '');
  const data = fmtDateBR(ev.dataEvento);
  return label + (data ? ' ' + data : '');
}

// Linha compacta pra lista de Clientes: telefone/sequência + limite + status mais recente,
// só os pedaços que existem — nada de poluir a linha com campos vazios.
export function customerInfoLine(c: Customer): string {
  const bits: string[] = [];
  if (c.sequencia) bits.push('seq ' + c.sequencia);
  if (c.limite != null && c.limite !== '') bits.push('💰 R$ ' + c.limite);
  if (c.ultimoEvento) bits.push(eventLabel(c.ultimoEvento));
  return bits.join(' · ');
}
