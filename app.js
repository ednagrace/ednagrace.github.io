/* =====================================================================
   Relatório Diário — Edna Grace / Savegnago
   PWA em JS puro (sem framework), pensado para o Galaxy A15.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- Definição dos campos do relatório ---------- */
  const GROUPS = [
    {
      title: 'Propostas', emoji: '📋', fields: [
        { key: 'aprovadas',  label: 'Aprovadas',  emoji: '✅', dailyMeta: true },
        { key: 'reprovadas', label: 'Reprovadas', emoji: '❌' },
        { key: 'analise',    label: 'Em Análise', emoji: '🔍' },
        { key: 'pendencias', label: 'Pendências', emoji: '⏳' },
      ]
    },
    {
      title: 'Links', emoji: '🔗', fields: [
        { key: 'link', label: 'Links', emoji: '🔗' },
      ]
    },
    {
      title: 'Cartão', emoji: '💳', fields: [
        { key: 'cartaoEntregas', label: 'Entregas',  emoji: '📦' },
        { key: 'cartaoReceber',  label: 'A Receber', emoji: '🕓' },
      ]
    },
    {
      title: 'Serviços', emoji: '⭐', fields: [
        { key: 'sms',           label: 'SMS',            emoji: '💬' },
        { key: 'bonus',         label: 'Bônus',          emoji: '🎁' },
        { key: 'faturaDigital', label: 'Fatura Digital', emoji: '📄' },
        { key: 'odontoPlus',    label: 'Odonto Plus',    emoji: '🦷' },
      ]
    },
  ];
  const ALL_FIELDS = GROUPS.flatMap(g => g.fields);
  const NUMERIC_KEYS = ALL_FIELDS.map(f => f.key);

  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const MONTHS_SHORT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

  /* ---------- Estado / armazenamento ---------- */
  const LS = {
    config:  'edna.config',
    reports: 'edna.reports.cache',
    queue:   'edna.queue',
    metas:   'edna.metas',
    session: 'edna.session',
    settingsPending: 'edna.settingsPending',
  };

  // Emails autorizados (o back-end também confere — isto é só para a UX).
  const ALLOWLIST = [
    'ednapromotora69@gmail.com',
    'edna.cristina.g69@gmail.com',
    'jpantunesdesouza@gmail.com',
  ];

  // Configuração fixa do site (produção) — igual para qualquer navegador/aparelho.
  // Não são segredos (a API só aceita sessão válida de um email da allowlist).
  const API_BASE = 'https://relatorio-api.vercel.app';
  const GOOGLE_CLIENT_ID = '81605218542-e00ff2h9oontd7vrtic5gpt0cf0but6u.apps.googleusercontent.com';

  // Config do usuário (fica no celular como cache; a fonte compartilhada é o Neon).
  const defaultConfig = {
    promotora:'Edna Grace',
    loja:     'Savegnago',
    metaDia:  3,                  // meta diária de cartões aprovados (editável)
  };

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  const state = {
    config:  Object.assign({}, defaultConfig, load(LS.config, {})),
    reports: load(LS.reports, []),        // cache local dos relatórios
    queue:   load(LS.queue, []),          // relatórios aguardando envio (offline)
    metas:   load(LS.metas, {}),          // { 'YYYY-MM': número }
    session: load(LS.session, {}),        // { token, email, name, exp }
    view:    'list',
    month:   currentMonthKey(),
    search:  '',
    editing: null,                        // relatório sendo editado no form
    syncing: false,
  };

  /* ---------- Helpers de data ---------- */
  function pad(n) { return ('0' + n).slice(-2); }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function currentMonthKey() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function monthKeyOf(dateISO) { return dateISO ? dateISO.slice(0, 7) : ''; }
  function parseISO(s) { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }

  /* ---------- Rede / API ---------- */
  function isOnline() { return navigator.onLine; }
  function apiUrl(path) { return String(API_BASE || '').replace(/\/$/, '') + path; }
  function authHeaders() {
    return { 'Authorization': 'Bearer ' + (state.session.token || ''), 'Content-Type': 'application/json' };
  }

  async function apiList() {
    if (!API_BASE || !sessionValid()) return null;
    const res = await fetch(apiUrl('/api/reports'), { headers: authHeaders() });
    if (res.status === 401) { refreshSession(); throw new Error('sessão expirada'); }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erro ao listar');
    return data.reports || [];
  }

  async function apiSave(report) {
    if (!API_BASE) throw new Error('API não configurada.');
    const res = await fetch(apiUrl('/api/reports'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ report }),
    });
    if (res.status === 401) { refreshSession(); throw new Error('sessão expirada'); }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erro ao salvar');
    return data;
  }

  /* ---------- Autenticação Google (login uma vez → sessão de 60 dias) ---------- */
  function isAllowed(email) {
    return !!email && ALLOWLIST.indexOf(String(email).toLowerCase()) !== -1;
  }
  function sessionValid() {
    return !!(state.session && state.session.token && state.session.exp &&
             (state.session.exp * 1000 > Date.now()));
  }

  let gisTries = 0;
  function initGis(onReady) {
    if (window.google && google.accounts && google.accounts.id && GOOGLE_CLIENT_ID) {
      if (!initGis._done) {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: onGoogleCredential,
          auto_select: true,
          itp_support: true,
          cancel_on_tap_outside: false,
        });
        initGis._done = true;
      }
      if (onReady) onReady();
      return true;
    }
    if (gisTries++ < 40) setTimeout(() => initGis(onReady), 150);
    return false;
  }

  // Troca o ID token do Google pela nossa sessão longa (via /api/login).
  async function onGoogleCredential(resp) {
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

  // Tenta reemitir a sessão silenciosamente (One Tap com auto_select).
  function refreshSession() {
    if (!initGis()) return;
    try { google.accounts.id.prompt(); } catch (e) {}
  }

  function logout() {
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
    state.session = {};
    save(LS.session, state.session);
    showLogin();
  }

  /* ---------- Configurações compartilhadas no Neon (metas, promotora, loja) ---------- */
  function businessSettings() {
    return {
      metas: state.metas,
      metaDia: Number(state.config.metaDia) || 3,
      promotora: state.config.promotora,
      loja: state.config.loja,
    };
  }
  // Chamado quando o usuário muda uma meta ou config: guarda pendência e tenta enviar.
  function saveSettingsRemote() {
    save(LS.settingsPending, businessSettings());
    flushSettings();
  }
  async function flushSettings() {
    const pending = load(LS.settingsPending, null);
    if (!pending || !API_BASE || !sessionValid() || !isOnline()) return;
    try {
      const res = await fetch(apiUrl('/api/settings'), {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ settings: pending }),
      });
      if (res.ok) localStorage.removeItem(LS.settingsPending);
    } catch (e) {}
  }
  // Baixa as configurações do Neon e aplica (fonte compartilhada entre aparelhos/logins).
  async function pullSettings() {
    if (!API_BASE || !sessionValid() || !isOnline()) return;
    try {
      const res = await fetch(apiUrl('/api/settings'), { headers: authHeaders() });
      if (res.status === 401) { refreshSession(); return; }
      const data = await res.json();
      if (data && data.ok && data.settings) {
        const s = data.settings;
        if (s.metas && typeof s.metas === 'object') { state.metas = Object.assign({}, s.metas); save(LS.metas, state.metas); }
        if (typeof s.metaDia !== 'undefined') state.config.metaDia = Number(s.metaDia) || 0;
        if (s.promotora) state.config.promotora = s.promotora;
        if (s.loja) state.config.loja = s.loja;
        save(LS.config, state.config);
        render();
      }
    } catch (e) {}
  }

  /* ---------- Fila offline ---------- */
  function enqueue(report) {
    // substitui item da mesma data na fila
    state.queue = state.queue.filter(r => r.data !== report.data);
    state.queue.push(report);
    save(LS.queue, state.queue);
  }

  async function flushQueue(silent) {
    if (state.syncing || !isOnline() || !API_BASE || !sessionValid()) return;
    if (state.queue.length === 0) return;
    state.syncing = true;
    const pending = state.queue.slice();
    for (const report of pending) {
      try {
        await apiSave(report);
        state.queue = state.queue.filter(r => r.data !== report.data);
        save(LS.queue, state.queue);
      } catch (e) { break; } // para no primeiro erro; tenta de novo depois
    }
    state.syncing = false;
    if (!silent && state.queue.length === 0) toast('Tudo sincronizado ✓', 'ok');
    render();
  }

  async function refreshFromCloud(silent) {
    if (!API_BASE || !isOnline() || !sessionValid()) return;
    try {
      const remote = await apiList();
      if (remote) {
        state.reports = remote;
        save(LS.reports, state.reports);
        render();
      }
    } catch (e) {
      if (!silent) toast('Sem conexão com o servidor', 'err');
    }
  }

  /* Une cache + fila para exibição (fila tem prioridade = versão mais nova). */
  function reportsForView() {
    const map = {};
    state.reports.forEach(r => { map[r.data] = Object.assign({}, r, { _synced: true }); });
    state.queue.forEach(r => { map[r.data] = Object.assign({}, r, { _synced: false }); });
    return Object.values(map).sort((a, b) => b.data.localeCompare(a.data));
  }

  function getReport(dataISO) {
    const q = state.queue.find(r => r.data === dataISO);
    if (q) return Object.assign({}, q);
    const c = state.reports.find(r => r.data === dataISO);
    if (c) return Object.assign({}, c);
    return null;
  }

  /* ---------- Meta do mês ---------- */
  const DEFAULT_META = 22; // meta padrão de propostas aprovadas por mês (editável)
  function metaFor(monthKey) {
    // se o mês ainda não teve meta definida, usa a padrão (22)
    return monthKey in state.metas ? (Number(state.metas[monthKey]) || 0) : DEFAULT_META;
  }
  function metaDiaVal() { return Number(state.config.metaDia) || 3; } // meta do dia (padrão 3)
  function setMeta(monthKey, val) {
    state.metas[monthKey] = Number(val) || 0;
    save(LS.metas, state.metas);
  }
  function aprovadasNoMes(monthKey) {
    return reportsForView()
      .filter(r => monthKeyOf(r.data) === monthKey)
      .reduce((sum, r) => sum + (Number(r.aprovadas) || 0), 0);
  }

  /* =====================================================================
     RENDER
     ===================================================================== */
  const app = document.getElementById('app');

  function render() {
    if (!sessionValid()) return showLogin();
    if (state.view === 'form') return renderForm();
    return renderList();
  }

  /* ---------------- TELAS DE LOGIN ---------------- */
  function showLogin() {
    app.innerHTML = `
      <div class="auth-screen">
        <div class="auth-card">
          <div class="auth-logo">📋</div>
          <h1>Relatório Diário</h1>
          <p class="auth-sub">${esc(state.config.promotora)} · ${esc(state.config.loja)}</p>
          <div id="gbtn" class="gbtn-wrap"></div>
          <p class="auth-note">Entre com a conta Google autorizada.<br>Você só faz isso uma vez.</p>
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

  function showDenied(email) {
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

  /* ---------------- TELA: LISTAGEM ---------------- */
  function renderList() {
    const monthKey = state.month;
    const [y, m] = monthKey.split('-').map(Number);
    const meta = metaFor(monthKey);
    const feitas = aprovadasNoMes(monthKey);
    const pct = meta > 0 ? Math.min(100, Math.round((feitas / meta) * 100)) : 0;
    const falta = Math.max(0, meta - feitas);

    let rows = reportsForView().filter(r => monthKeyOf(r.data) === monthKey);
    if (state.search.trim()) {
      const q = state.search.toLowerCase();
      rows = rows.filter(r =>
        (r.data || '').includes(q) ||
        (r.obs || '').toLowerCase().includes(q)
      );
    }

    const pendCount = state.queue.length;

    app.innerHTML = `
      <header class="appbar">
        <div style="flex:1">
          <h1>Relatórios Diários</h1>
          <span class="sub">${esc(state.config.promotora)} · ${esc(state.config.loja)}</span>
        </div>
        <span class="net-badge ${isOnline() ? '' : 'off'}">${isOnline() ? 'online' : 'offline'}</span>
        <button class="iconbtn" id="btn-menu" aria-label="Menu">⚙️</button>
      </header>

      <div class="screen">
        <div class="meta-card">
          <div class="row">
            <span class="label">Meta do mês · aprovados</span>
            <button class="edit-meta" id="btn-meta">editar</button>
          </div>
          <div class="row" style="margin-top:4px">
            <div class="big">${feitas}<small> / ${meta || '—'}</small></div>
            <div style="text-align:right">
              <div style="font-size:22px;font-weight:800">${meta ? pct + '%' : ''}</div>
            </div>
          </div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <div class="hint">${meta ? (falta > 0 ? `Faltam <b>${falta}</b> para a meta` : 'Meta batida! 🎉') : 'Toque em “editar” para definir a meta do mês'}</div>
          <div class="hint meta-dia-line">🎯 Meta do dia: <b>${metaDiaVal()}</b> aprovados <button class="edit-meta" id="btn-meta-dia">editar</button></div>
        </div>

        <div class="month-nav">
          <button id="prev-month" aria-label="Mês anterior">‹</button>
          <div class="label">${MONTHS[m-1]} ${y}</div>
          <button id="next-month" aria-label="Próximo mês">›</button>
        </div>

        <div class="search">
          <input id="search" type="search" inputmode="search" placeholder="Buscar por data ou observação" value="${esc(state.search)}" />
        </div>

        ${pendCount > 0 ? `<div class="chip no" style="margin-bottom:10px">⏳ ${pendCount} aguardando envio — <b id="try-sync" style="text-decoration:underline">sincronizar</b></div>` : ''}

        <div class="list">
          ${rows.length ? rows.map(cardHTML).join('') : emptyHTML()}
        </div>
      </div>

      <button class="fab" id="fab-new"><span class="plus">＋</span> Novo Relatório</button>
    `;

    // Eventos
    byId('fab-new').onclick = () => openForm(todayISO());
    byId('prev-month').onclick = () => shiftMonth(-1);
    byId('next-month').onclick = () => shiftMonth(1);
    byId('btn-menu').onclick = openMenu;
    byId('btn-meta').onclick = editMetaPrompt;
    byId('btn-meta-dia').onclick = editMetaDiaPrompt;
    const s = byId('search');
    s.oninput = () => { state.search = s.value; /* re-render leve */ renderListSoft(rows); };
    if (byId('try-sync')) byId('try-sync').onclick = () => flushQueue(false);
    wireCards();
  }

  // Liga os cliques dos cards: abrir relatório + botãozinho de PDF
  function wireCards() {
    Array.from(document.querySelectorAll('[data-pdf]')).forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const rep = getReport(btn.getAttribute('data-pdf'));
        sharePDF(rep ? Object.assign({}, rep) : null);
      };
    });
    Array.from(document.querySelectorAll('[data-open]')).forEach(el => {
      el.onclick = () => openForm(el.getAttribute('data-open'));
    });
  }

  // Re-render só da lista (mantém foco no campo de busca)
  function renderListSoft() {
    const monthKey = state.month;
    let rows = reportsForView().filter(r => monthKeyOf(r.data) === monthKey);
    if (state.search.trim()) {
      const q = state.search.toLowerCase();
      rows = rows.filter(r => (r.data||'').includes(q) || (r.obs||'').toLowerCase().includes(q));
    }
    const listEl = document.querySelector('.list');
    if (listEl) {
      listEl.innerHTML = rows.length ? rows.map(cardHTML).join('') : emptyHTML();
      wireCards();
    }
  }

  function cardHTML(r) {
    const d = parseISO(r.data);
    const totalProp = (Number(r.aprovadas)||0) + (Number(r.reprovadas)||0);
    const chips = [];
    const bateuDia = num(r.aprovadas) >= metaDiaVal();
    chips.push(`<span class="chip ${bateuDia ? 'ok' : 'neutral'}">✅ ${num(r.aprovadas)}${bateuDia ? ' 🎯' : ''}</span>`);
    chips.push(`<span class="chip no">❌ ${num(r.reprovadas)}</span>`);
    if (num(r.link))  chips.push(`<span class="chip">🔗 ${num(r.link)}</span>`);
    if (num(r.cartaoEntregas)) chips.push(`<span class="chip">📦 ${num(r.cartaoEntregas)}</span>`);
    const servicos = num(r.sms)+num(r.bonus)+num(r.faturaDigital)+num(r.odontoPlus);
    if (servicos) chips.push(`<span class="chip">⭐ ${servicos}</span>`);
    return `
      <div class="report-card" data-open="${r.data}">
        <div class="date-badge">
          <div class="d">${pad(d.getDate())}</div>
          <div class="m">${MONTHS_SHORT[d.getMonth()]}</div>
        </div>
        <div class="info">
          <div class="title">${weekday(d)}
            <span class="sync-dot ${r._synced ? 'done' : 'wait'}" title="${r._synced ? 'enviado' : 'aguardando'}"></span>
          </div>
          <div class="chips">${chips.join('')}</div>
        </div>
        <button class="card-pdf" data-pdf="${r.data}" title="Gerar PDF" aria-label="Gerar PDF">📄</button>
        <div class="go">›</div>
      </div>`;
  }

  function emptyHTML() {
    return `<div class="empty"><div class="ico">📝</div><p>Nenhum relatório neste mês.<br>Toque em <b>Novo Relatório</b> para começar.</p></div>`;
  }

  function shiftMonth(delta) {
    let [y, m] = state.month.split('-').map(Number);
    m += delta;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    state.month = y + '-' + pad(m);
    render();
  }

  function editMetaPrompt() {
    const cur = metaFor(state.month) || '';
    const [y, m] = state.month.split('-').map(Number);
    const v = window.prompt(`Meta de cartões aprovados para ${MONTHS[m-1]} ${y}:`, cur);
    if (v === null) return;
    setMeta(state.month, v);
    saveSettingsRemote();
    render();
  }

  function editMetaDiaPrompt() {
    const v = window.prompt('Meta de cartões aprovados por DIA:', metaDiaVal());
    if (v === null) return;
    state.config.metaDia = Math.max(0, Number(v) || 0);
    save(LS.config, state.config);
    saveSettingsRemote();
    render();
  }

  /* ---------------- TELA: FORMULÁRIO ---------------- */
  function openForm(dataISO) {
    const existing = getReport(dataISO);
    state.editing = existing || blankReport(dataISO);
    state.view = 'form';
    render();
    window.scrollTo(0, 0);
  }

  function blankReport(dataISO) {
    const r = {
      data: dataISO,
      promotora: state.config.promotora,
      loja: state.config.loja,
      metaMes: metaFor(monthKeyOf(dataISO)),
      obs: '',
    };
    NUMERIC_KEYS.forEach(k => r[k] = 0);
    return r;
  }

  function renderForm() {
    const r = state.editing;
    const groupsHTML = GROUPS.map(g => `
      <div class="group">
        <h2><span>${g.emoji}</span> ${g.title}</h2>
        ${g.fields.map(f => counterHTML(f, r[f.key] || 0)).join('')}
      </div>`).join('');

    app.innerHTML = `
      <header class="appbar">
        <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
        <div style="flex:1">
          <h1>${getReport(r.data) ? 'Editar' : 'Novo'} Relatório</h1>
          <span class="sub">${esc(state.config.promotora)} · ${esc(state.config.loja)}</span>
        </div>
      </header>

      <div class="screen">
        <div class="form-head">
          <div class="form-date">
            <label for="f-data">Data do relatório</label>
            <input id="f-data" type="date" value="${esc(r.data)}" max="${todayISO()}" />
          </div>
        </div>

        ${groupsHTML}

        <div class="group obs">
          <h2><span>🗒️</span> Observações</h2>
          <textarea id="f-obs" placeholder="Alguma observação do dia (opcional)">${esc(r.obs || '')}</textarea>
        </div>

        <button type="button" class="pdf-btn" id="btn-pdf">📄 Gerar PDF para WhatsApp</button>
      </div>

      <div class="savebar">
        <button class="btn-ghost" id="btn-cancel">Cancelar</button>
        <button class="btn-save" id="btn-save">💾 Salvar relatório</button>
      </div>
    `;

    // eventos gerais
    byId('btn-back').onclick = byId('btn-cancel').onclick = () => { state.view = 'list'; render(); };
    byId('f-data').onchange = (e) => { r.data = e.target.value; };
    byId('f-obs').oninput = (e) => { r.obs = e.target.value; };
    byId('btn-save').onclick = onSave;
    byId('btn-pdf').onclick = () => sharePDF(Object.assign({}, r));

    // liga os contadores
    ALL_FIELDS.forEach(f => wireCounter(f, r));
  }

  function counterHTML(f, val) {
    const quick = [];
    for (let n = 0; n <= 15; n++) {
      quick.push(`<button type="button" data-q="${f.key}" data-n="${n}" class="${Number(val) === n ? 'active' : ''}">${n}</button>`);
    }
    return `
      <div class="counter" id="counter-${f.key}">
        <div class="top">
          <div class="name"><span class="emoji">${f.emoji}</span> ${f.label}</div>
          <div class="stepper">
            <button type="button" class="minus" data-step="${f.key}" data-d="-1">−</button>
            <div class="val" id="val-${f.key}">${Number(val) || 0}</div>
            <button type="button" class="plus" data-step="${f.key}" data-d="1">＋</button>
          </div>
        </div>
        <div class="quick">${quick.join('')}</div>
        ${f.dailyMeta ? `<div class="daily-hint ${Number(val) >= metaDiaVal() ? 'hit' : ''}" id="dhint-${f.key}">${dailyHintText(val)}</div>` : ''}
      </div>`;
  }

  function dailyHintText(val) {
    const md = metaDiaVal();
    const n = Number(val) || 0;
    return n >= md ? `🎯 Meta do dia batida! (${n}/${md})` : `🎯 Meta do dia: ${n} / ${md}`;
  }

  function wireCounter(f, r) {
    const container = byId('counter-' + f.key);
    const valEl = byId('val-' + f.key);

    function set(n) {
      n = Math.max(0, n);
      r[f.key] = n;
      valEl.textContent = n;
      // destaca botão rápido correspondente
      container.querySelectorAll('.quick button').forEach(b => {
        b.classList.toggle('active', Number(b.getAttribute('data-n')) === n);
      });
      // atualiza o indicador da meta do dia (só na Aprovadas)
      if (f.dailyMeta) {
        const dh = byId('dhint-' + f.key);
        if (dh) { dh.textContent = dailyHintText(n); dh.classList.toggle('hit', n >= metaDiaVal()); }
      }
    }

    container.querySelectorAll('.quick button').forEach(b => {
      b.onclick = () => { set(Number(b.getAttribute('data-n'))); haptic(); };
    });
    container.querySelectorAll('[data-step]').forEach(b => {
      b.onclick = () => { set((Number(r[f.key]) || 0) + Number(b.getAttribute('data-d'))); haptic(); };
    });
  }

  async function onSave() {
    const r = state.editing;
    if (!r.data) { toast('Escolha a data', 'err'); return; }
    r.promotora = state.config.promotora;
    r.loja = state.config.loja;
    r.metaMes = metaFor(monthKeyOf(r.data));
    NUMERIC_KEYS.forEach(k => r[k] = Number(r[k]) || 0);

    const btn = byId('btn-save');
    btn.disabled = true; btn.textContent = 'Salvando...';

    // 1) guarda localmente na hora (nunca perde)
    enqueue(Object.assign({}, r));
    // atualiza também o cache para aparecer na lista já sincronizado-visual
    upsertCache(r);

    // 2) tenta enviar para o servidor (Neon)
    let sent = false;
    if (isOnline() && API_BASE && sessionValid()) {
      try {
        await apiSave(r);
        state.queue = state.queue.filter(x => x.data !== r.data);
        save(LS.queue, state.queue);
        sent = true;
      } catch (e) { sent = false; }
    }

    state.view = 'list';
    state.month = monthKeyOf(r.data);
    render();
    toast(sent ? 'Relatório salvo no servidor ✓'
               : 'Salvo no celular — envia quando tiver internet ⏳',
          sent ? 'ok' : '');
  }

  function upsertCache(r) {
    const i = state.reports.findIndex(x => x.data === r.data);
    if (i >= 0) state.reports[i] = Object.assign({}, r);
    else state.reports.push(Object.assign({}, r));
    save(LS.reports, state.reports);
  }

  /* ---------------- MENU / CONFIGURAÇÕES ---------------- */
  function openMenu() {
    openSheet(`
      <h2>Menu</h2>
      <button class="menu-item" id="mi-csv">
        <span class="mi-ico">📤</span>
        <span>Exportar CSV (mês)<small>Baixar/compartilhar planilha do mês</small></span>
      </button>
      <button class="menu-item" id="mi-share">
        <span class="mi-ico">💬</span>
        <span>Compartilhar resumo do dia<small>Enviar por WhatsApp</small></span>
      </button>
      <button class="menu-item" id="mi-config">
        <span class="mi-ico">🔧</span>
        <span>Configurações<small>Promotora, loja e meta do dia</small></span>
      </button>
      <button class="menu-item" id="mi-logout">
        <span class="mi-ico">🚪</span>
        <span>Sair<small>${esc(state.session.email || '')}</small></span>
      </button>
      <div class="status-line" id="cfg-status" style="margin-top:12px"></div>
    `, () => {
      byId('mi-config').onclick = () => { closeSheet(); openConfig(); };
      byId('mi-csv').onclick = () => { closeSheet(); exportCSV(); };
      byId('mi-share').onclick = () => { closeSheet(); shareToday(); };
      byId('mi-logout').onclick = () => { closeSheet(); logout(); };
      const st = byId('cfg-status');
      st.textContent = API_BASE ? '✓ Conectado ao servidor' : '⚠ Servidor não configurado';
    });
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
      <div class="actions">
        <button class="primary" id="c-save" style="flex:1">Salvar</button>
      </div>
    `, () => {
      byId('c-save').onclick = () => {
        state.config.promotora = byId('c-prom').value.trim() || 'Edna Grace';
        state.config.loja      = byId('c-loja').value.trim() || 'Savegnago';
        state.config.metaDia   = Math.max(0, Number(byId('c-metadia').value) || 3);
        save(LS.config, state.config);
        saveSettingsRemote();          // salva no Neon (compartilhado)
        closeSheet();
        toast('Configurações salvas ✓', 'ok');
      };
    });
  }

  /* ---------------- Exportações ---------------- */
  function exportCSV() {
    const rows = reportsForView().filter(r => monthKeyOf(r.data) === state.month)
      .sort((a,b) => a.data.localeCompare(b.data));
    if (!rows.length) { toast('Nada para exportar neste mês', 'err'); return; }
    const cols = ['data','promotora','loja','metaMes', ...NUMERIC_KEYS, 'obs'];
    const header = ['Data','Promotora','Loja','Meta',...ALL_FIELDS.map(f=>f.label),'Obs'];
    const lines = [header.join(';')];
    rows.forEach(r => {
      lines.push(cols.map(c => csvCell(r[c])).join(';'));
    });
    const csv = '﻿' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const fname = `relatorios_${state.month}.csv`;
    downloadOrShare(blob, fname, 'text/csv');
  }

  function shareToday() {
    const r = getReport(todayISO()) || reportsForView()[0];
    if (!r) { toast('Nenhum relatório para compartilhar', 'err'); return; }
    const d = parseISO(r.data);
    const meta = metaFor(monthKeyOf(r.data));
    const feitas = aprovadasNoMes(monthKeyOf(r.data));
    let txt = `📋 *Relatório Diário — ${state.config.loja}*\n`;
    txt += `👤 ${state.config.promotora}\n`;
    txt += `📅 ${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}\n\n`;
    txt += `*Propostas*\n✅ Aprovadas: ${num(r.aprovadas)}\n❌ Reprovadas: ${num(r.reprovadas)}\n🔍 Em análise: ${num(r.analise)}\n⏳ Pendências: ${num(r.pendencias)}\n\n`;
    txt += `🔗 Link: ${num(r.link)}\n`;
    txt += `💳 Cartão — 📦 Entregas: ${num(r.cartaoEntregas)} | 🕓 A receber: ${num(r.cartaoReceber)}\n\n`;
    txt += `*Serviços*\n💬 SMS: ${num(r.sms)}\n🎁 Bônus: ${num(r.bonus)}\n📄 Fatura Digital: ${num(r.faturaDigital)}\n🦷 Odonto Plus: ${num(r.odontoPlus)}\n`;
    if (r.obs) txt += `\n🗒️ Obs: ${r.obs}\n`;
    if (meta) txt += `\n🎯 Meta do mês: ${feitas}/${meta} aprovados\n`;

    if (navigator.share) {
      navigator.share({ title: 'Relatório Diário', text: txt }).catch(()=>{});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
    }
  }

  /* ---------------- Gerar PDF (sem biblioteca externa) ---------------- */
  // Cores (0-1) usadas no PDF
  const PDF = {
    RED: [0.82, 0.04, 0.07], WHITE: [1, 1, 1], INK: [0.11, 0.11, 0.14],
    MUTED: [0.42, 0.45, 0.50], LIGHT: [0.88, 0.89, 0.91], GREEN: [0.12, 0.62, 0.34],
  };
  function pdfEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
  function latin1(s) { return String(s).replace(/[^\x00-\xFF]/g, ''); } // remove o que não é Latin-1 (ex.: emoji)

  function buildReportPDF(r) {
    const d = parseISO(r.data);
    const mk = monthKeyOf(r.data);
    const meta = metaFor(mk);
    const feitas = aprovadasNoMes(mk);
    const pct = meta > 0 ? Math.round((feitas / meta) * 100) : 0;

    let c = '';
    const F1 = 'F1', F2 = 'F2';
    const txt = (x, y, size, font, color, s) => {
      const [rr, gg, bb] = color;
      c += `BT /${font} ${size} Tf ${rr} ${gg} ${bb} rg ${x} ${y} Td (${pdfEsc(latin1(s))}) Tj ET\n`;
    };
    const rect = (x, y, w, h, color) => { const [rr, gg, bb] = color; c += `${rr} ${gg} ${bb} rg ${x} ${y} ${w} ${h} re f\n`; };
    const line = (x1, y, x2, color) => { const [rr, gg, bb] = color; c += `${rr} ${gg} ${bb} RG 0.6 w ${x1} ${y} m ${x2} ${y} l S\n`; };

    // Cabeçalho vermelho
    rect(0, 792, 595, 50, PDF.RED);
    txt(40, 814, 19, F2, PDF.WHITE, 'RELATÓRIO DIÁRIO');
    txt(40, 799, 10.5, F1, PDF.WHITE, (r.loja || 'Savegnago') + '   ·   ' + (r.promotora || ''));

    let y = 752;
    // Data
    const dataFmt = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    txt(40, y, 10, F1, PDF.MUTED, 'DATA');
    txt(40, y - 17, 15, F2, PDF.INK, dataFmt + '  —  ' + weekday(d));
    y -= 46;

    const section = (title) => {
      txt(40, y, 11, F2, PDF.RED, title.toUpperCase());
      line(40, y - 6, 555, PDF.LIGHT);
      y -= 24;
    };
    const row = (label, value) => {
      txt(48, y, 12, F1, PDF.INK, label);
      txt(430, y, 13, F2, PDF.INK, String(value));
      y -= 21;
    };

    section('Propostas');
    row('Aprovadas', num(r.aprovadas));
    row('Reprovadas', num(r.reprovadas));
    row('Em Análise', num(r.analise));
    row('Pendências', num(r.pendencias));
    y -= 6;

    section('Links');
    row('Links', num(r.link));
    y -= 6;

    section('Cartão');
    row('Entregas', num(r.cartaoEntregas));
    row('A Receber (retirada na loja)', num(r.cartaoReceber));
    y -= 6;

    section('Serviços');
    row('SMS', num(r.sms));
    row('Bônus', num(r.bonus));
    row('Fatura Digital', num(r.faturaDigital));
    row('Odonto Plus', num(r.odontoPlus));
    y -= 6;

    section('Metas');
    const md = metaDiaVal();
    row('Meta do dia (aprovados)', num(r.aprovadas) + ' / ' + md + (num(r.aprovadas) >= md ? '   (batida)' : ''));
    row('Meta do mês (aprovados)', feitas + ' / ' + (meta || '—') + (meta ? '   (' + pct + '%)' : ''));
    y -= 6;

    // Observações (com quebra simples de linha)
    if (r.obs && String(r.obs).trim()) {
      section('Observações');
      const words = String(r.obs).replace(/\s+/g, ' ').trim().split(' ');
      let ln = '';
      const flush = () => { if (ln) { txt(48, y, 11, F1, PDF.INK, ln); y -= 16; ln = ''; } };
      words.forEach(w => {
        if ((ln + ' ' + w).length > 85) flush();
        ln = ln ? ln + ' ' + w : w;
      });
      flush();
    }

    // Rodapé
    line(40, 54, 555, PDF.LIGHT);
    let quando = '';
    try { quando = new Date().toLocaleString('pt-BR'); } catch (e) {}
    txt(40, 40, 9, F1, PDF.MUTED, 'Gerado em ' + quando + '  ·  App Relatório Diário');

    // Monta o arquivo PDF
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      '<< /Length ' + c.length + ' >>\nstream\n' + c + 'endstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(off => { pdf += String(off).padStart(10, '0') + ' 00000 n \n'; });
    pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  function sharePDF(r) {
    if (!r || !r.data) { toast('Nenhum relatório para gerar PDF', 'err'); return; }
    NUMERIC_KEYS.forEach(k => r[k] = Number(r[k]) || 0);
    const blob = buildReportPDF(r);
    const primeiroNome = (r.promotora || 'Edna').split(' ')[0];
    const fname = 'Relatorio_' + r.data + '_' + primeiroNome + '.pdf';
    downloadOrShare(blob, fname, 'application/pdf');
  }

  function downloadOrShare(blob, fname, mime) {
    const file = new File([blob], fname, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: fname }).catch(()=>{});
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname; document.body.appendChild(a); a.click();
    a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Arquivo baixado ✓', 'ok');
  }

  /* ---------------- Bottom sheet ---------------- */
  function openSheet(html, onReady) {
    const bd = document.createElement('div');
    bd.className = 'sheet-backdrop';
    bd.innerHTML = `<div class="sheet">${html}</div>`;
    bd.onclick = (e) => { if (e.target === bd) closeSheet(); };
    document.body.appendChild(bd);
    if (onReady) onReady();
  }
  function closeSheet() {
    const bd = document.querySelector('.sheet-backdrop');
    if (bd) bd.remove();
  }

  /* ---------------- Utilidades ---------------- */
  function byId(id) { return document.getElementById(id); }
  function num(v) { return Number(v) || 0; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function csvCell(v) {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return /[";\n]/.test(s) ? '"' + s + '"' : s;
  }
  function weekday(d) {
    return ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][d.getDay()];
  }
  function haptic() { if (navigator.vibrate) navigator.vibrate(8); }

  let toastTimer;
  function toast(msg, kind) {
    const el = byId('sync-toast');
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ---------------- Eventos globais ---------------- */
  // Sincroniza tudo: envia pendências e baixa o que há de novo (config + relatórios).
  function syncNow(silent) {
    if (!isOnline() || !sessionValid()) return;
    flushSettings();
    pullSettings();
    flushQueue(silent !== false);
    refreshFromCloud(true);
  }

  window.addEventListener('online',  () => { render(); syncNow(false); });
  window.addEventListener('offline', () => { render(); });
  // Ao reabrir/voltar para o app, atualiza sozinho (pega o que outra conta lançou).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(true); });

  async function postAuthInit() {
    await flushSettings();   // envia mudanças locais pendentes (merge no servidor)
    await pullSettings();    // baixa a config compartilhada
    refreshFromCloud(true);
    flushQueue(true);
  }

  /* ---------------- Início ---------------- */
  function boot() {
    if (sessionValid()) { render(); postAuthInit(); }
    else { showLogin(); }
  }
  boot();
})();
