import type { Cliente, ClienteEvento } from './types.js';
import { pad, parseISO } from './dateUtils.js';

export function clienteLabel(c: Cliente): string {
  return (c.nome && c.nome.trim()) || 'seq ' + c.sequencia;
}

function fmtDateBR(iso?: string | null): string {
  if (!iso) return '';
  const d = parseISO(iso);
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
}

// `tipo` vem cru da digitalização das fotos (ex.: "nota-geral;proposta-reprovada") — pode
// ter mais de uma etiqueta separada por ";". Mostra só a mais relevante, não a lista toda.
// Mesma lista usada no <select> de "nova nota" — precisa bater com TIPOS em
// relatorio-api/api/cliente-eventos.js.
export const TIPO_LABELS: [string, string][] = [
  ['cartao-aprovado', '✅ Cartão aprovado'],
  ['proposta-aprovada', '✅ Aprovada'],
  ['proposta-reprovada', '❌ Reprovada'],
  ['link-pendente', '🔗 Link pendente'],
  ['ficha-cartao', '📇 Ficha de cartão'],
  ['nota-geral', '🗒️ Nota'],
];
export function eventoLabel(ev: ClienteEvento): string {
  const tags = String(ev.tipo || '').split(';').map((s) => s.trim());
  const found = TIPO_LABELS.find(([tag]) => tags.includes(tag));
  const label = found ? found[1] : (tags[0] ? '🗒️ ' + tags[0] : '');
  const data = fmtDateBR(ev.dataEvento);
  return label + (data ? ' ' + data : '');
}

// Linha compacta pra listas (contatos e clientes): sequência + limite + status mais recente,
// só os pedaços que existem — nada de poluir a linha com campos vazios.
export function clienteInfoLine(c: Cliente): string {
  const bits: string[] = ['seq ' + c.sequencia];
  if (c.limite != null && c.limite !== '') bits.push('💰 R$ ' + c.limite);
  if (c.ultimoEvento) bits.push(eventoLabel(c.ultimoEvento));
  return bits.join(' · ');
}
