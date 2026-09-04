import { sessionValid, state, save, load } from './state.js';
import { LS } from './env.js';
import { setBackAction } from './nav.js';
import { showLogin } from './screens/login.js';
import { renderForm, formBack, formCanLeave } from './screens/form.js';
import { renderPanel, panelBack } from './screens/panel.js';
import { renderMsg, msgBack, msgCanLeave } from './screens/messages.js';
import { renderImport, importBack, importCanLeave } from './screens/import.js';
import { renderList } from './screens/list.js';
import { renderCustomers, customersBack } from './screens/customers.js';

export const app = document.getElementById('app') as HTMLElement;

/* Guard consulted before HOME (the 🏠 in the appbar) or a deep link leaves the
   current screen. A screen holding unsaved input (form, message editor, import)
   sets one that asks to confirm discarding it; every other screen leaves freely.
   Reset to "yes, leave" at the top of every render(). */
let leaveGuard: () => boolean = () => true;

/* May we navigate away from the current screen right now? Used by the deep-link
   listener (router.ts) so a link tapped mid-form still runs the discard check. */
export function canLeaveCurrentView(): boolean { return leaveGuard(); }

export function render() {
  leaveGuard = () => true;
  if (!sessionValid()) { setBackAction(null); return showLogin(); }

  let draw: () => void;
  if (state.view === 'form')           { setBackAction(formBack);      leaveGuard = formCanLeave;   draw = renderForm; }
  else if (state.view === 'panel')     { setBackAction(panelBack);                                  draw = renderPanel; }
  else if (state.view === 'msg')       { setBackAction(msgBack);       leaveGuard = msgCanLeave;    draw = renderMsg; }
  else if (state.view === 'import')    { setBackAction(importBack);    leaveGuard = importCanLeave; draw = renderImport; }
  else if (state.view === 'customers') { setBackAction(customersBack);                              draw = renderCustomers; }
  else                                 { setBackAction(null); state.view = 'list';                 draw = renderList; }

  syncHash();      // keep the address bar pointing at this screen (shareable / bookmarkable)
  persistRoute();  // remember it, so a cold start reopens here (see router.ts)
  return draw();
}

/* The 🏠 button and "go to the start screen" links land here. */
export function goHome() {
  if (!leaveGuard()) return;
  leaveGuard = () => true;
  state.editing = null;
  state.customersPickMode = false;
  state.view = 'list';
  render();
  window.scrollTo(0, 0);
}

/* ---------------- URL <-> screen ---------------- */
function routeHash(): string {
  switch (state.view) {
    case 'panel':     return '#/painel';
    case 'msg':       return '#/mensagens';
    case 'import':    return '#/importar';
    case 'customers': return state.customersPickMode ? '#/mensagens' : '#/clientes';
    case 'form':      return state.editingNew
                             ? '#/novo'
                             : '#/relatorio/' + ((state.editing && state.editing.data) || '');
    default:          return '#/';
  }
}

/* replaceState (not location.hash = / pushState): updating the address bar must
   NOT add a history entry or fire hashchange — that would fight the hardware-back
   handling in nav.js and the deep-link listener in router.js. */
function syncHash() {
  const h = routeHash();
  if (location.hash !== h) {
    try { history.replaceState(history.state, '', h); } catch (e) {}
  }
}

/* What a cold start should reopen. The form and the "pick a client" mode are
   transient (their unsaved state is gone once the app is killed), so we save a
   safe landing screen for those instead. */
function persistRoute() {
  let r: string = state.view;
  if (state.view === 'form') r = 'list';
  if (state.view === 'customers' && state.customersPickMode) r = 'msg';
  try { save(LS.lastRoute, r); } catch (e) {}
}
export function lastRoute(): string { return load<string>(LS.lastRoute, 'list'); }
