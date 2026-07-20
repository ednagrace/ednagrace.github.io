/* =====================================================================
   Relatório Diário — Edna Grace / Savegnago
   Plain-TypeScript PWA (no framework), built for the Galaxy A15.
   ===================================================================== */
import { state, sessionValid } from './state.js';
import { showTestBanner, checkEnvironment } from './env.js';
import { applyHeaderColor } from './theme.js';
import { render } from './render.js';
import { syncNow, postAuthInit } from './api.js';
import { quickCols } from './screens/form.js';
import { showLogin } from './screens/login.js';

/* ---------------- Global events ---------------- */
window.addEventListener('online',  () => { render(); syncNow(false); });
window.addEventListener('offline', () => { render(); });

// If the width changes (screen rotation), recompute the quick-button columns.
let lastQuickCols = quickCols();
window.addEventListener('resize', () => {
  const c = quickCols();
  if (c !== lastQuickCols) {
    lastQuickCols = c;
    if (state.view === 'form') render();
  }
});
// When reopening/returning to the app, sync automatically (picks up what another
// account entered).
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(true); });

/* ---------------- Boot ---------------- */
function boot() {
  showTestBanner();      // amber banner if we're in the test environment
  applyHeaderColor();    // header color (production) or amber (staging)
  checkEnvironment();    // and the API confirms (or denies) which environment this is
  if (sessionValid()) { render(); postAuthInit(); }
  else { showLogin(); }
}
boot();
