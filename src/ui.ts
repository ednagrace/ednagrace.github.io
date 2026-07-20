import { byId } from './format.js';

let toastTimer: ReturnType<typeof setTimeout>;
export function toast(msg: string, kind?: string) {
  const el = byId('sync-toast');
  el.textContent = msg;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------------- Bottom sheet ---------------- */
export function openSheet(html: string, onReady?: () => void) {
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `<div class="sheet">${html}</div>`;
  bd.onclick = (e) => { if (e.target === bd) closeSheet(); };
  document.body.appendChild(bd);
  if (onReady) onReady();
}
export function closeSheet() {
  const bd = document.querySelector('.sheet-backdrop');
  if (bd) bd.remove();
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

/* Escape hatch for stubborn caches: wipes ALL caches, unregisters the service
   worker, and reloads with a cache-buster. The session and local data are preserved
   (they live in localStorage, which isn't touched). */
export async function forceRefresh() {
  toast('Limpando cache e recarregando...');
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) { /* proceed and reload anyway */ }
  // cache-buster in the URL to also defeat the HTTP cache (GitHub Pages' max-age=600)
  location.replace(location.origin + location.pathname + '?u=' + Date.now());
}
