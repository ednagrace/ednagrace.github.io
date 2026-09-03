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

/* Confirmação de "sair sem salvar" nas telas de cadastro: o botão voltar (ou tocar
   fora de um sheet) descarta o que foi digitado. Só pergunta quando há alteração
   pendente (`dirty`); sem alteração, sai direto sem incomodar. Retorna true = pode sair. */
export function confirmDiscard(dirty: boolean): boolean {
  return !dirty || window.confirm(
    'Você preencheu o formulário e ainda não salvou.\n\n' +
    'Se voltar agora, o que você digitou será perdido. Voltar mesmo assim?'
  );
}

/* ---------------- Bottom sheet ---------------- */
// Open sheets, oldest first. Tracked so the hardware "back" button (see nav.ts)
// can close the topmost one, honoring its dismiss guard.
interface SheetEntry { el: HTMLElement; onBeforeDismiss?: () => boolean; }
const openSheets: SheetEntry[] = [];

// onBeforeDismiss: chamado quando a pessoa toca fora do sheet (ou usa o botão
// voltar do celular) para fechá-lo. Se devolver false, o sheet fica aberto
// (ex.: formulário com dados não salvos).
export function openSheet(html: string, onReady?: () => void, onBeforeDismiss?: () => boolean) {
  const bd = document.createElement('div');
  bd.className = 'sheet-backdrop';
  bd.innerHTML = `<div class="sheet">${html}</div>`;
  bd.onclick = (e) => {
    if (e.target !== bd) return;
    if (onBeforeDismiss && !onBeforeDismiss()) return;
    closeSheet();
  };
  document.body.appendChild(bd);
  openSheets.push({ el: bd, onBeforeDismiss });
  if (onReady) onReady();
}
export function closeSheet() {
  const entry = openSheets.pop();
  if (entry) { entry.el.remove(); return; }
  const bd = document.querySelector('.sheet-backdrop');   // fallback: stray backdrop
  if (bd) bd.remove();
}

/* Hardware/browser back button: close the topmost sheet, honoring its "discard
   unsaved?" guard. Returns true when a sheet was open — whether or not it
   actually closed — so the caller knows the back press was consumed here. */
export function dismissTopSheet(): boolean {
  const entry = openSheets[openSheets.length - 1];
  if (!entry) return false;
  if (entry.onBeforeDismiss && !entry.onBeforeDismiss()) return true;
  closeSheet();
  return true;
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
