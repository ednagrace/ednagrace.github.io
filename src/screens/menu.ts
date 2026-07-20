import { MONTHS, APP_VERSION, SUPORTE_WPP } from '../constants.js';
import { ENVS, ALL_FIELDS } from '../constants.js';
import { ENV, IS_STAGING, API_BASE, apiUrl } from '../env.js';
import { switchEnv } from '../env.js';
import { state, save, sessionValid } from '../state.js';
import { LS } from '../env.js';
import { render } from '../render.js';
import { esc, byId, informed } from '../format.js';
import { pad, parseISO, todayISO } from '../dateUtils.js';
import { openSheet, closeSheet, toast, copyToClipboard } from '../ui.js';
import { forceRefresh } from '../ui.js';
import { isAdmin, logout, refreshSession } from '../auth.js';
import { authHeaders, isOnline, saveSettingsRemote, getReport, reportsForView } from '../api.js';
import { monthReports, metaFor, aprovadasNoMes } from '../aggregations.js';
import {
  DEFAULT_HEADER, HEADER_PALETTE, PRIMARIES,
  hexToRgb, rgbToHex, rgbToHsl, hslToRgb, currentHeaderColor, validateHeaderColor, applyHeaderColor,
} from '../theme.js';
import { openPanel } from './panel.js';
import { openImport } from './import.js';
import { openMsg } from './messages.js';

/* ---------------- MENU / SETTINGS ---------------- */
export function openMenu() {
  openSheet(`
    <h2>Menu</h2>
    <button class="menu-item" id="mi-panel">
      <span class="mi-ico">📊</span>
      <span>Painel do mês<small>Totais e resumo por semana</small></span>
    </button>
    <button class="menu-item" id="mi-sheet">
      <span class="mi-ico">📗</span>
      <span>Gerar planilha do Google<small>${MONTHS[Number(state.month.split('-')[1]) - 1]} ${state.month.split('-')[0]} — o mês selecionado na tela inicial</small></span>
    </button>
    <button class="menu-item" id="mi-import">
      <span class="mi-ico">📥</span>
      <span>Importar planilha<small>Criar relatórios em massa (CSV, XLSX, XLS, ODS)</small></span>
    </button>
    <button class="menu-item" id="mi-share">
      <span class="mi-ico">💬</span>
      <span>Compartilhar resumo do dia<small>Enviar por WhatsApp</small></span>
    </button>
    <button class="menu-item" id="mi-msg">
      <span class="mi-ico">📝</span>
      <span>Mensagens<small>Templates de WhatsApp</small></span>
    </button>
    <button class="menu-item" id="mi-config">
      <span class="mi-ico">🔧</span>
      <span>Configurações<small>Promotora, loja e meta do dia</small></span>
    </button>
    <button class="menu-item" id="mi-update">
      <span class="mi-ico">🔄</span>
      <span>Forçar atualização<small>Limpa o cache e recarrega o app (${APP_VERSION})</small></span>
    </button>
    ${isAdmin() ? `<button class="menu-item" id="mi-docs">
      <span class="mi-ico">📖</span>
      <span>Documentação da API<small>Só para o desenvolvedor</small></span>
    </button>
    <button class="menu-item" id="mi-env">
      <span class="mi-ico">${IS_STAGING ? '🧪' : '🚀'}</span>
      <span>Ambiente: ${ENVS[ENV].label}<small>${IS_STAGING
        ? 'Banco de teste — toque para voltar à produção'
        : 'Banco real da Edna — toque para ir ao teste'}</small></span>
    </button>` : ''}
    <button class="menu-item" id="mi-logout">
      <span class="mi-ico">🚪</span>
      <span>Sair<small>${esc(state.session.email || '')}</small></span>
    </button>
    <div class="status-line" id="cfg-status" style="margin-top:12px"></div>
    <div class="app-version">Relatório Diário · ${APP_VERSION}<br><b>Desenvolvido por JPANTUNES13</b></div>
  `, () => {
    byId('mi-config').onclick = () => { closeSheet(); openConfig(); };
    byId('mi-panel').onclick = () => { closeSheet(); openPanel(); };
    byId('mi-sheet').onclick = () => { closeSheet(); generateSheet(); };
    byId('mi-import').onclick = () => { closeSheet(); openImport(); };
    byId('mi-update').onclick = () => { closeSheet(); forceRefresh(); };
    if (byId('mi-docs')) byId('mi-docs').onclick = () => {
      closeSheet();
      window.open(apiUrl('/docs?token=' + encodeURIComponent(state.session.token || '')), '_blank');
    };
    if (byId('mi-env')) byId('mi-env').onclick = () => {
      const destino = IS_STAGING ? 'prod' : 'staging';
      // Say out loud where we're headed. The dangerous confusion is thinking you're in
      // staging when you're actually in production — so the warning names the database.
      const msg = destino === 'staging'
        ? 'Ir para o AMBIENTE DE TESTE?\n\nO app vai passar a usar o banco de teste (descartável). Seus dados de produção no aparelho ficam guardados e intactos.'
        : 'Voltar para a PRODUÇÃO?\n\nO app volta a usar o banco REAL da Edna. O que você criou no teste fica lá, separado.';
      if (confirm(msg)) switchEnv(destino);
      else closeSheet();
    };
    byId('mi-share').onclick = () => { closeSheet(); shareToday(); };
    byId('mi-msg').onclick = () => { closeSheet(); openMsg(); };
    byId('mi-logout').onclick = () => { closeSheet(); logout(); };
    const st = byId('cfg-status');
    st.textContent = API_BASE ? '✓ Conectado ao servidor' : '⚠ Servidor não configurado';
  });
}

// Opens the support WhatsApp chat already with an initial message.
function openSupportWhatsApp() {
  const txt = 'Olá! Sou ' + (state.config.promotora || '') + ' (' + (state.config.loja || '') +
              '). Preciso de ajuda com o app Relatório Diário (' + APP_VERSION + ').';
  window.open('https://wa.me/' + SUPORTE_WPP + '?text=' + encodeURIComponent(txt), '_blank');
}

function openConfig() {
  const c = state.config;
  openSheet(`
    <h2>Configurações</h2>
    ${state.session.email ? `<div class="status-line" style="margin-bottom:12px">Logado como <b>${esc(state.session.email)}</b></div>` : ''}
    <div class="field">
      <label>Promotora</label>
      <input id="c-prom" type="text" value="${esc(c.promotora)}" />
    </div>
    <div class="field">
      <label>Loja</label>
      <input id="c-loja" type="text" value="${esc(c.loja)}" />
    </div>
    <div class="field">
      <label>Meta do dia (cartões aprovados)</label>
      <input id="c-metadia" type="number" inputmode="numeric" min="0" value="${esc(c.metaDia != null ? c.metaDia : 3)}" />
    </div>
    <div class="field">
      <label>🎂 Data de nascimento da promotora</label>
      <input id="c-birth" type="date" value="${/^\d{4}-\d{2}-\d{2}$/.test(c.birthDate || '') ? esc(c.birthDate) : ''}" max="${todayISO()}" />
      <div class="status-line">O app dá os parabéns no dia do aniversário.</div>
    </div>
    ${IS_STAGING ? `
    <div class="field">
      <label>Cor do cabeçalho</label>
      <div class="status-line">No ambiente de teste o cabeçalho é sempre âmbar, para não se confundir com a produção.</div>
    </div>` : `
    <div class="field">
      <label>Cor do cabeçalho</label>
      <div class="cpick">
        <div class="cp-preview" id="cp-prev"><span id="cp-hex"></span></div>
        <div class="cp-sub">Cores primárias</div>
        <div class="cp-primaries" id="cp-primaries">
          ${PRIMARIES.map((cor) => `<button type="button" class="cp-dot" data-cor="${cor}" style="background:${cor}" aria-label="${cor}"></button>`).join('')}
        </div>
        <div class="cp-sub">Todas as cores</div>
        <div class="swatches" id="cp-grid">
          ${HEADER_PALETTE.map((p) => `<button type="button" class="swatch" data-cor="${p.cor}" style="background:${p.cor}" aria-label="${p.cor}"></button>`).join('')}
        </div>
        <div class="cp-sub">Escurecer / clarear</div>
        <input type="range" id="cp-light" class="cp-range" min="6" max="62" step="1" />
        <div class="cp-rgb">
          <label>R<input id="cp-r" type="number" min="0" max="255" inputmode="numeric" /></label>
          <label>G<input id="cp-g" type="number" min="0" max="255" inputmode="numeric" /></label>
          <label>B<input id="cp-b" type="number" min="0" max="255" inputmode="numeric" /></label>
        </div>
        <div class="status-line" id="cp-msg"></div>
      </div>
    </div>`}
    <div class="actions">
      <button class="primary" id="c-save" style="flex:1">Salvar</button>
    </div>
    <button type="button" class="pdf-btn btn-wpp" id="c-suporte" style="margin-top:16px">💬 Falar no WhatsApp (suporte)</button>
  `, () => {
    byId('c-suporte').onclick = () => openSupportWhatsApp();

    // Header color picker (production only): primaries + spectrum grid + lightness + RGB.
    // chosenColor always holds the last VALID color; Save uses it.
    let chosenColor = currentHeaderColor();
    if (!IS_STAGING) {
      const msg = byId('cp-msg');
      let cur = hexToRgb(chosenColor as string) || hexToRgb(DEFAULT_HEADER)!;
      const paint = () => {
        const hex = rgbToHex(cur.r, cur.g, cur.b);
        byId('cp-prev').style.background = hex;
        byId('cp-hex').textContent = hex.toUpperCase();
        byId('cp-r').value = Math.round(cur.r);
        byId('cp-g').value = Math.round(cur.g);
        byId('cp-b').value = Math.round(cur.b);
        document.querySelectorAll('#cp-grid .swatch, #cp-primaries .cp-dot').forEach((b) =>
          b.classList.toggle('sel', (b.getAttribute('data-cor') as string).toLowerCase() === hex.toLowerCase()));
        const erro = validateHeaderColor(hex);
        if (erro) { msg.textContent = '⚠ ' + erro; msg.classList.add('warn'); }
        else { chosenColor = hex; msg.textContent = 'Cor válida ✓'; msg.classList.remove('warn'); }
      };
      const syncSlider = () => { byId('cp-light').value = Math.round(rgbToHsl(cur.r, cur.g, cur.b).l); };
      const setHex = (hex: string) => { const rgb = hexToRgb(hex); if (rgb) { cur = rgb; paint(); syncSlider(); } };

      document.querySelectorAll('#cp-grid .swatch, #cp-primaries .cp-dot').forEach((b) => {
        (b as HTMLElement).onclick = () => setHex(b.getAttribute('data-cor') as string);
      });
      byId('cp-light').oninput = (e: Event) => {
        const hsl = rgbToHsl(cur.r, cur.g, cur.b);
        cur = hslToRgb(hsl.h, hsl.s, Number((e.target as HTMLInputElement).value)) || cur;
        paint();  // don't re-sync the slider while the user is dragging it
      };
      const onRgb = () => {
        const cl = (v: string) => Math.max(0, Math.min(255, Number(v) || 0));
        cur = { r: cl(byId('cp-r').value), g: cl(byId('cp-g').value), b: cl(byId('cp-b').value) };
        paint(); syncSlider();
      };
      ['cp-r', 'cp-g', 'cp-b'].forEach((id) => { byId(id).oninput = onRgb; });

      paint(); syncSlider();
    }

    byId('c-save').onclick = () => {
      state.config.promotora = byId('c-prom').value.trim() || 'Edna Grace';
      state.config.loja      = byId('c-loja').value.trim() || 'Savegnago';
      state.config.metaDia   = Math.max(0, Number(byId('c-metadia').value) || 3);
      const dob = byId('c-birth').value;   // 'YYYY-MM-DD' or ''
      state.config.birthDate = /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : '';
      if (!IS_STAGING) state.config.headerColor = (chosenColor === DEFAULT_HEADER) ? '' : (chosenColor as string);
      save(LS.config, state.config);
      saveSettingsRemote();          // save to Neon (shared)
      applyHeaderColor();
      closeSheet();
      render();
      toast('Configurações salvas ✓', 'ok');
    };
  });
}

/* ---------------- Exports ---------------- */
// Opens the column picker before generating the spreadsheet. The month comes from the caller.
export function generateSheet(month?: string) {
  const target = month || state.month;
  const [y, m] = target.split('-').map(Number);
  const rows = monthReports(target);
  if (!rows.length) { toast('Nenhum relatório neste mês', 'err'); return; }

  // A column with at least one informed value that month comes checked; 100% N/A comes
  // unchecked (auto-hide). But any of them can be checked/unchecked.
  const hasData = (k: string) => rows.some(r => informed(r[k]));
  const linhas = ALL_FIELDS.map(f => `
    <label class="col-pick">
      <input type="checkbox" data-col="${f.key}" ${hasData(f.key) ? 'checked' : ''} />
      <span class="col-name">${f.emoji} ${f.label}</span>
      ${hasData(f.key) ? '' : '<span class="col-tag">sem dados</span>'}
    </label>`).join('');

  openSheet(`
    <h2>Planilha de ${MONTHS[m-1]} ${y}</h2>
    <p class="status-line" style="margin:-4px 0 10px">Escolha as colunas. As sem dados no mês já vêm desmarcadas.</p>
    <div class="col-actions">
      <button type="button" class="chip-btn" id="col-all">Marcar todas</button>
      <button type="button" class="chip-btn" id="col-def">Só as com dados</button>
    </div>
    <div class="col-list">${linhas}</div>
    <label class="col-pick fillzero">
      <input type="checkbox" id="col-fillzero" />
      <span class="col-name">Preencher vazios com 0 <small>(só nesta planilha; não muda os dados)</small></span>
    </label>
    <div class="actions">
      <button class="primary" id="col-gerar" style="flex:1">📊 Gerar planilha</button>
    </div>
  `, () => {
    const inputs = () => Array.from(document.querySelectorAll('.col-list input[data-col]')) as HTMLInputElement[];
    byId('col-all').onclick = () => inputs().forEach(i => { i.checked = true; });
    byId('col-def').onclick = () => inputs().forEach(i => { i.checked = hasData(i.getAttribute('data-col') as string); });
    byId('col-gerar').onclick = () => {
      const fields = inputs().filter(i => i.checked).map(i => i.getAttribute('data-col') as string);
      if (!fields.length) { toast('Escolha ao menos uma coluna', 'err'); return; }
      const fillZero = (byId('col-fillzero') as HTMLInputElement).checked;
      closeSheet();
      doGenerateSheet(target, fields, fillZero);
    };
  });
}

// Calls the API with the chosen columns and the "fill empty with 0" option.
async function doGenerateSheet(month: string, fields: string[], fillZero: boolean) {
  if (!isOnline() || !sessionValid()) { toast('Conecte à internet', 'err'); return; }
  toast('Gerando planilha...');
  try {
    const res = await fetch(apiUrl('/api/sheet'), {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ month, fields, fillZero }),
    });
    if (res.status === 401) { refreshSession(); toast('Faça login novamente', 'err'); return; }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'falha');
    const copied = await copyToClipboard(data.url);
    showSheetLink(data.url, copied, month);
  } catch (e: any) {
    toast('Erro ao gerar planilha: ' + e.message, 'err');
  }
}

function showSheetLink(url: string, copied: boolean, month?: string) {
  const [y, m] = String(month || state.month).split('-').map(Number);
  openSheet(`
    <h2>Planilha de ${MONTHS[m-1]} ${y} ✓</h2>
    <p class="status-line" style="margin:-4px 0 12px">${copied ? '🔗 Link copiado para a área de transferência.' : 'Toque em “Copiar link” abaixo.'}</p>
    <div class="field">
      <input id="sheet-url" type="text" readonly value="${esc(url)}" onclick="this.select()" />
    </div>
    <p class="status-line" style="margin:12px 0 0">
      ⏳ <b>Esta planilha é temporária</b> e some do Drive depois de alguns dias.
      Os dados ficam sempre aqui no app — é só gerar de novo quando precisar.<br><br>
      📌 <b>Quer guardar?</b> Abra a planilha e use <b>Arquivo → Fazer uma cópia</b>.
      A cópia vai para o <b>seu</b> Drive e essa <b>não é apagada</b>.
    </p>
    <div class="actions">
      <button class="secondary" id="sheet-copy">📋 Copiar link</button>
      <button class="primary" id="sheet-open">Abrir planilha</button>
    </div>
  `, () => {
    byId('sheet-copy').onclick = async () => {
      const ok = await copyToClipboard(url);
      toast(ok ? 'Link copiado ✓' : 'Não foi possível copiar', ok ? 'ok' : 'err');
    };
    byId('sheet-open').onclick = () => window.open(url, '_blank');
  });
}

function shareToday() {
  const r = getReport(todayISO()) || reportsForView()[0];
  if (!r) { toast('Nenhum relatório para compartilhar', 'err'); return; }
  const d = parseISO(r.data);
  const monthKey = r.data.slice(0, 7);
  const meta = metaFor(monthKey);
  const feitas = aprovadasNoMes(monthKey);
  let txt = `📋 *Relatório Diário — ${state.config.loja}*\n`;
  txt += `👤 ${state.config.promotora}\n`;
  txt += `📅 ${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}\n\n`;
  txt += `👥 Clientes abordados: ${r.clientesAbordados ?? '—'}\n\n`;
  txt += `*Propostas*\n✅ Aprovadas: ${r.aprovadas ?? '—'}\n🟡 Pré-aprovado: ${r.preAprovado ?? '—'}\n❌ Reprovadas: ${r.reprovadas ?? '—'}\n🔍 Em análise: ${r.analise ?? '—'}\n⏳ Pendências: ${r.pendencias ?? '—'}\n\n`;
  txt += `🔗 Link: ${r.link ?? '—'}\n`;
  txt += `💳 Cartão — 📦 Entregas: ${r.cartaoEntregas ?? '—'} | 🕓 A receber: ${r.cartaoReceber ?? '—'} | ✅ Ativação: ${r.cartaoAtivacao ?? '—'}\n\n`;
  txt += `*Serviços*\n💬 SMS: ${r.sms ?? '—'}\n🎁 Bônus: ${r.bonus ?? '—'}\n📄 Fatura Digital: ${r.faturaDigital ?? '—'}\n🦷 Odonto Plus: ${r.odontoPlus ?? '—'}\n`;
  if (r.obs) txt += `\n🗒️ Obs: ${r.obs}\n`;
  if (meta) txt += `\n🎯 Meta do mês: ${feitas}/${meta} aprovados\n`;

  if ((navigator as any).share) {
    (navigator as any).share({ title: 'Relatório Diário', text: txt }).catch(() => {});
  } else {
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
  }
}
