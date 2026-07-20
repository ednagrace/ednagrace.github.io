/* ---------- Helpers de data ---------- */
export function pad(n: number): string { return ('0' + n).slice(-2); }
export function todayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
export function currentMonthKey(): string {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}
export function monthKeyOf(dateISO: string): string { return dateISO ? dateISO.slice(0, 7) : ''; }
export function parseISO(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function weekday(d: Date): string {
  return ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][d.getDay()];
}
