/* =====================================================================
   Deep links + "reabrir onde eu estava".

   Celulares mais simples matam o PWA assim que a promotora troca de app.
   Ao voltar, o app não pode aparecer numa tela em branco nem no meio de
   um formulário perdido — tem que reabrir onde ela estava.

   Duas fontes decidem a tela inicial, nesta ordem:
     1. O hash da URL — um link ('#/painel', '#/clientes',
        '#/relatorio/2026-09-02', …) abre exatamente naquela tela.
     2. Senão, a última tela salva pelo render.ts na visita anterior.

   O render.ts mantém a barra de endereço sincronizada com history.replaceState,
   então navegar dentro do app NÃO dispara 'hashchange' nem cria entradas no
   histórico (não briga com o botão voltar do celular — ver nav.ts). Só um
   hashchange DE VERDADE (link tocado, URL digitada) chega no listener daqui.
   ===================================================================== */
import { state } from './state.js';
import { render, lastRoute, canLeaveCurrentView } from './render.js';
import { openPanel } from './screens/panel.js';
import { openMsg } from './screens/messages.js';
import { openImport } from './screens/import.js';
import { openCustomers } from './screens/customers.js';
import { openForm, openNew } from './screens/form.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parseHash(raw: string): [string, string] {
  const clean = (raw || '').replace(/^#\/?/, '').replace(/\/+$/, '');
  const [seg, arg] = clean.split('/');
  return [seg || '', arg || ''];
}

// Returns true when it handled navigation (caller must not also render()).
function dispatch(seg: string, arg: string): boolean {
  switch (seg) {
    case '':
    case 'inicio':
    case 'lista':     state.view = 'list'; render(); return true;
    case 'painel':    openPanel();          return true;
    case 'mensagens': openMsg();            return true;
    case 'importar':  openImport();         return true;
    case 'clientes':  openCustomers();      return true;
    case 'novo':      openNew();            return true;
    case 'relatorio': if (ISO.test(arg)) { openForm(arg); return true; } return false;
    default:          return false;
  }
}

// Names persisted by render.ts (state.view) -> how to reopen that screen.
const RESUME: Record<string, () => void> = {
  panel:     openPanel,
  msg:       openMsg,
  import:    openImport,
  customers: openCustomers,
};

/* Called once at boot, after the session check. Returns true when it already
   put a screen on the page (so boot() must not call render() again). */
export function applyInitialRoute(): boolean {
  const hash = location.hash;
  if (hash && hash.length > 1) {
    const [seg, arg] = parseHash(hash);
    if (dispatch(seg, arg)) return true;
  }
  const resume = RESUME[lastRoute()];
  if (resume) { resume(); return true; }
  return false;   // boot() renders the home list
}

export function initRouter() {
  window.addEventListener('hashchange', () => {
    // A link tapped while a form / editor holds unsaved input: run the same
    // "descartar?" check the back button does. If declined, stay put — the hash
    // is re-synced by the next render().
    if (!canLeaveCurrentView()) return;
    const [seg, arg] = parseHash(location.hash);
    dispatch(seg, arg);
  });
}
