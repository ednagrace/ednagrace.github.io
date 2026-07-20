import type { Contact } from './types.js';
import { state } from './state.js';
import { toast } from './ui.js';

export function currentContact(): Contact | null {
  return state.contacts.find(c => String(c.id) === String(state.contatoId)) || null;
}
export function contactLabel(c: Contact): string {
  return (c.name && c.name.trim()) || c.phone || c.email || 'Sem nome';
}
// Normalizes a BR phone number into wa.me format (country code 55 + area code + number).
export function phoneDigits(p?: string): string {
  let d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = '55' + d;   // missing country code
  return d;
}
// The device address book can only be READ (Contact Picker). To "save to the address
// book" we generate a .vcf card and Android asks whether to add it to contacts.
export function contactPickerAvailable(): boolean {
  return !!((navigator as any).contacts && (navigator as any).contacts.select && (window as any).ContactsManager);
}
export function vcardFor(c: Contact): string {
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
export function saveToDeviceContacts(c: Contact) {
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
