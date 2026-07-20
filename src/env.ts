import { ENVS } from './constants.js';

// Lives OUTSIDE the storage namespace: must be read before we know which environment we're in.
const LS_ENV = 'edna.env';
function currentEnv(): 'prod' | 'staging' {
  try { return localStorage.getItem(LS_ENV) === 'staging' ? 'staging' : 'prod'; }
  catch (e) { return 'prod'; }   // any error falls back to production, the safe default
}
export const ENV = currentEnv();
export const IS_STAGING = ENV === 'staging';

/* Local storage is SEPARATE per environment, and this isn't cosmetic.
   The app is offline-first: it keeps a local report cache and a SEND QUEUE on the
   phone. Without separation, you'd enter staging, create fake data, go back to
   production — and the queue would sync that fake data INTO the real database.
   That would be a new way to lose data, replacing the old one.

   Production keeps the exact same key names as always ('edna.config', ...), so
   nobody gets logged out or loses what was already on the device. */
export const PREFIX = IS_STAGING ? 'edna.staging.' : 'edna.';
export const LS = {
  config:  PREFIX + 'config',
  reports: PREFIX + 'reports.cache',
  queue:   PREFIX + 'queue',
  metas:   PREFIX + 'metas',
  session: PREFIX + 'session',
  settingsPending: PREFIX + 'settingsPending',
  templates: PREFIX + 'templates',
  contacts: PREFIX + 'contacts',
};

// Fixed site config — the same for any browser/device.
// Not secrets (the API only accepts a valid session for an allowlisted email).
// API_BASE now comes from the chosen environment (production, unless switched in the menu).
export const API_BASE = ENVS[ENV].api;

/* ---------------- Environment switch (developer only) ----------------
   Switching reloads the page: API_BASE and the localStorage keys are decided once,
   at load time. Reloading is simpler — and safer — than trying to rewire everything
   with the app already running. */
export function switchEnv(next: 'prod' | 'staging') {
  if (!ENVS[next] || next === ENV) return;
  try { localStorage.setItem(LS_ENV, next); } catch (e) {}
  location.reload();
}

/* Impossible-to-miss red banner while the app is in the test environment.
   Only shows in staging — in production the app looks exactly as it always has. */
export function showTestBanner() {
  if (!IS_STAGING || document.getElementById('env-banner')) return;
  const b = document.createElement('button');
  b.id = 'env-banner';
  b.type = 'button';
  b.textContent = '🧪 AMBIENTE DE TESTE — banco descartável · toque para voltar à produção';
  b.onclick = () => switchEnv('prod');
  document.body.insertBefore(b, document.body.firstChild);
  // The class also paints the header amber. Since it's sticky (always visible),
  // the warning stays on screen even scrolled down — the banner alone would disappear.
  document.body.classList.add('has-env-banner');
}

/* Checks the environment against the API ITSELF, instead of trusting what the app
   thinks it is. Same lesson as the 07/13 incident: config can lie; what matters is
   what the running code responds. If the app thinks it's in staging but the API says
   'production', it's one click away from writing to the real database — so we force
   it back to production, so at least the label doesn't lie. */
export async function checkEnvironment() {
  let root: any;
  try {
    root = await (await fetch(apiUrl('/'), { cache: 'no-store' })).json();
  } catch (e) {
    return;   // offline: can't check, and the app is offline-first. Move on.
  }
  const expected = IS_STAGING ? 'staging' : 'production';
  if (root && root.env && root.env !== expected) {
    alert(
      'ATENÇÃO: o app está marcado como "' + ENVS[ENV].label + '", mas a API respondeu "' +
      root.env + '".\n\nPor segurança, voltando para a produção.'
    );
    try { localStorage.removeItem(LS_ENV); } catch (e) {}
    location.reload();
    return;
  }
  if (IS_STAGING) console.info('[env] staging · API', root.env, '· db', root.db);
}

export function apiUrl(path: string): string {
  return String(API_BASE || '').replace(/\/$/, '') + path;
}
