/* ---------- Formatting/value utilities ---------- */
export function num(v: any): number { return Number(v) || 0; }
// Display: "not informed" (null/undefined/'') shows as an em dash; a number shows as itself.
export function fmtNA(v: any): string | number { return (v === null || v === undefined || v === '') ? '—' : v; }
// Parse a value into a number, or null when it is empty / not informed.
export function numOrNull(v: any): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
// True when the field carries a real number (as opposed to N/A).
export function informed(v: any): v is number { return typeof v === 'number' && Number.isFinite(v); }

export function esc(s: any): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
}

export function haptic() { if (navigator.vibrate) navigator.vibrate(8); }

export function byId(id: string): any { return document.getElementById(id); }
