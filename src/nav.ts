/* =====================================================================
   Hardware "back" button (Android) / browser back → navigate INSIDE the
   app instead of leaving the PWA.

   The app never touched window.history, so a single back press dropped
   the promotora straight out of the PWA — even with a bottom sheet open
   or halfway through a sub-screen. Fix: always keep one decoy history
   entry in front of us. A back press then fires `popstate` (instead of
   closing the app); we handle it as "go back one step" and re-arm the
   decoy. Only on the home screen, with nothing open, a second press
   within a couple of seconds is allowed through to close the app.
   ===================================================================== */
import { dismissTopSheet, toast } from './ui.js';

// What "back" should do on the current screen (set by render() per view).
// null = home screen (the list): nothing to go back to inside the app.
type BackAction = (() => void) | null;

let backAction: BackAction = null;
let started = false;
let lastHomeBack = 0;

export function setBackAction(fn: BackAction) { backAction = fn; }

function armDecoy() { history.pushState({ ednaDecoy: true }, ''); }

function onPopState() {
  // 1) A bottom sheet is open → close it (honoring its "discard unsaved?" guard).
  if (dismissTopSheet()) { armDecoy(); return; }

  // 2) On a sub-screen → run that screen's own back handler (form/panel/…).
  if (backAction) { backAction(); armDecoy(); return; }

  // 3) Home screen, nothing open → require a second press to leave the app.
  const now = Date.now();
  if (now - lastHomeBack < 2000) { history.back(); return; }  // let the app close
  lastHomeBack = now;
  toast('Toque em voltar de novo para sair');
  armDecoy();
}

export function initNav() {
  if (started || typeof history === 'undefined') return;
  started = true;
  history.replaceState({ ednaRoot: true }, '');
  armDecoy();
  window.addEventListener('popstate', onPopState);
}
