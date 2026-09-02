import { APP_VERSION } from '../constants.js';
import { state } from '../state.js';
import { app } from '../render.js';
import { esc, byId } from '../format.js';
import { initGis, logout } from '../auth.js';

declare const google: any;

/* ---------------- LOGIN SCREENS ---------------- */
export function showLogin() {
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-logo">📋</div>
        <h1>Relatório Diário</h1>
        <p class="auth-sub">${esc(state.config.promotora)} · ${esc(state.config.loja)}</p>
        <div id="gbtn" class="gbtn-wrap"></div>
        <p class="auth-note">Entre com a conta Google autorizada.<br>Você só faz isso uma vez.</p>
        <div class="app-version">${APP_VERSION}<br><b>Desenvolvido por JPANTUNES13</b></div>
      </div>
    </div>`;
  initGis(() => {
    try {
      google.accounts.id.renderButton(byId('gbtn'),
        { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width: 260 });
      google.accounts.id.prompt();
    } catch (e) {}
  });
}

export function showDenied(email: string) {
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-logo">🚫</div>
        <h1>Acesso negado</h1>
        <p class="auth-sub">${esc(email || '')}</p>
        <p class="auth-note">Este email não tem permissão para usar o app.</p>
        <button class="auth-admin" id="auth-switch">Entrar com outra conta</button>
      </div>
    </div>`;
  byId('auth-switch').onclick = logout;
}
