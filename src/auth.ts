import { ADMIN_EMAIL, GOOGLE_CLIENT_ID } from './constants.js';
import { apiUrl } from './env.js';
import { state, save, sessionValid } from './state.js';
import { LS } from './env.js';
import { toast } from './ui.js';
import { render } from './render.js';
import { postAuthInit } from './api.js';
import { showDenied, showLogin } from './screens/login.js';

declare const google: any;

export { sessionValid };

// Developer-only items (e.g. API docs)
export function isAdmin(): boolean {
  return String(state.session.email || '').toLowerCase() === ADMIN_EMAIL;
}

let gisTries = 0;
export function initGis(onReady?: () => void): boolean {
  const w = window as any;
  if (w.google && google.accounts && google.accounts.id && GOOGLE_CLIENT_ID) {
    if (!(initGis as any)._done) {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onGoogleCredential,
        auto_select: true,
        itp_support: true,
        cancel_on_tap_outside: false,
      });
      (initGis as any)._done = true;
    }
    if (onReady) onReady();
    return true;
  }
  if (gisTries++ < 40) setTimeout(() => initGis(onReady), 150);
  return false;
}

// Exchanges the Google ID token for our long session (via /api/login).
export async function onGoogleCredential(resp: any) {
  if (!resp || !resp.credential) return;
  try {
    const r = await fetch(apiUrl('/api/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: resp.credential }),
    });
    const data = await r.json();
    if (!data.ok) {
      if (r.status === 403) return showDenied(data.email || '');
      return toast(data.error || 'Falha no login', 'err');
    }
    state.session = { token: data.session, email: data.email, name: data.name || '', exp: data.exp };
    save(LS.session, state.session);
    render();
    postAuthInit();
  } catch (e) {
    toast('Sem conexão para completar o login', 'err');
  }
}

// Tries to silently reissue the session (One Tap with auto_select).
export function refreshSession() {
  if (!initGis()) return;
  try { google.accounts.id.prompt(); } catch (e) {}
}

export function logout() {
  try { if ((window as any).google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
  state.session = {};
  save(LS.session, state.session);
  showLogin();
}
