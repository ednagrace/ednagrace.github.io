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
    templates: 'edna.templates',
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
  const APP_VERSION = 'v24'; // aumente junto com o CACHE do sw.js a cada atualização

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
    templates: load(LS.templates, []),    // [{ id, title, body }]
    msg:     { id: null, title: '', body: '' },
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

  async function apiDelete(dataISO) {
    const res = await fetch(apiUrl('/api/reports?data=' + encodeURIComponent(dataISO)), {
      method: 'DELETE', headers: authHeaders(),
    });
    if (res.status === 401) { refreshSession(); throw new Error('sessão expirada'); }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erro ao excluir');
    return data;
  }

  /* ---------- Templates de mensagem (WhatsApp) ---------- */
  async function pullTemplates() {
    if (!API_BASE || !sessionValid() || !isOnline()) return;
    try {
      const res = await fetch(apiUrl('/api/templates'), { headers: authHeaders() });
      if (res.status === 401) { refreshSession(); return; }
      const data = await res.json();
      if (data && data.ok) { state.templates = data.templates || []; save(LS.templates, state.templates); }
    } catch (e) {}
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
    if (state.view === 'panel') return renderPanel();
    if (state.view === 'msg') return renderMsg();
    return renderList();
  }

  /* ---------- Agregações (painel / resumo) ---------- */
  function monthReports(monthKey) {
    return reportsForView().filter(r => monthKeyOf(r.data) === monthKey)
      .sort((a, b) => a.data.localeCompare(b.data));
  }
  function monthTotals(monthKey) {
    const rows = monthReports(monthKey);
    const t = {};
    NUMERIC_KEYS.forEach(k => t[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    t._dias = rows.length;
    return t;
  }
  function mondayOf(dateISO) {
    const d = parseISO(dateISO);
    const dow = (d.getDay() + 6) % 7; // 0 = segunda
    d.setDate(d.getDate() - dow);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function weeklyBreakdown(monthKey) {
    const map = {};
    monthReports(monthKey).forEach(r => {
      const wk = mondayOf(r.data);
      if (!map[wk]) map[wk] = { week: wk, aprovadas: 0, reprovadas: 0, dias: 0 };
      map[wk].aprovadas += Number(r.aprovadas) || 0;
      map[wk].reprovadas += Number(r.reprovadas) || 0;
      map[wk].dias += 1;
    });
    return Object.values(map).sort((a, b) => a.week.localeCompare(b.week));
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
          <div class="app-version">${APP_VERSION}</div>
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
        <button class="iconbtn" id="btn-panel" aria-label="Painel do mês">📊</button>
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
    byId('fab-new').onclick = () => openNew();
    byId('prev-month').onclick = () => shiftMonth(-1);
    byId('next-month').onclick = () => shiftMonth(1);
    byId('btn-menu').onclick = openMenu;
    byId('btn-panel').onclick = openPanel;
    byId('btn-meta').onclick = editMetaPrompt;
    byId('btn-meta-dia').onclick = editMetaDiaPrompt;
    const s = byId('search');
    s.oninput = () => { state.search = s.value; /* re-render leve */ renderListSoft(rows); };
    if (byId('try-sync')) byId('try-sync').onclick = () => flushQueue(false);
    wireCards();
  }

  /* Swipe para excluir (estilo iOS): passou de 50% da largura → solta e o item
     voa para fora e é excluído. Até 50% → volta ao repouso. O gesto É a confirmação. */
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function swipeDelete(wrap, card, dir) {
    const dataISO = card.getAttribute('data-open');
    const w = wrap.offsetWidth;
    const h = wrap.offsetHeight;

    // Sem internet não dá para excluir: volta ao repouso.
    if (!isOnline() || !sessionValid()) {
      card.style.transition = 'transform .18s ease';
      card.style.transform = 'translateX(0)';
      wrap.classList.remove('will-delete');
      toast('Conecte à internet para excluir', 'err');
      return;
    }

    // 1) a lixeira cresce e "empurra" o item para fora da lista
    wrap.style.setProperty('--push', (dir * 26) + 'px');
    wrap.classList.add('committing');
    card.style.transition = 'transform .22s cubic-bezier(.4,0,1,1)';
    card.style.transform = 'translateX(' + (dir * (w + 60)) + 'px)';
    await sleep(220);

    // 2) a linha colapsa (some da lista)
    wrap.style.height = h + 'px';
    wrap.style.overflow = 'hidden';
    void wrap.offsetHeight; // força reflow
    wrap.style.transition = 'height .18s ease, opacity .18s ease, margin-bottom .18s ease';
    wrap.style.height = '0px';
    wrap.style.opacity = '0';
    wrap.style.marginBottom = '-10px'; // compensa o gap da lista
    await sleep(190);

    // 3) exclui de fato (se falhar, o render devolve o item)
    const ok = await deleteReportNow(dataISO);
    render();
    toast(ok ? 'Relatório excluído' : 'Não foi possível excluir', ok ? 'ok' : 'err');
  }

  function wireSwipe(wrap) {
    const card = wrap.querySelector('.report-card');
    if (!card) return;
    let startX = 0, startY = 0, dx = 0, dragging = false, decided = false, horiz = false;

    card.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.card-pdf')) return; // não arrasta pelo botão de PDF
      startX = e.clientX; startY = e.clientY;
      dx = 0; dragging = true; decided = false; horiz = false;
      card.style.transition = 'none';
    });

    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const mx = e.clientX - startX, my = e.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true;
        horiz = Math.abs(mx) > Math.abs(my);
        if (horiz) { try { card.setPointerCapture(e.pointerId); } catch (err) {} }
      }
      if (!horiz) return;
      const w = wrap.offsetWidth;
      dx = Math.max(-w, Math.min(w, mx));
      card.style.transform = 'translateX(' + dx + 'px)';
      // passou de 50% → a lixeira cresce avisando que ao soltar vai excluir
      wrap.classList.toggle('will-delete', Math.abs(dx) > w / 2);
    });

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      const w = wrap.offsetWidth;
      if (horiz && Math.abs(dx) > w / 2) {          // > 50% → exclui
        swipeDelete(wrap, card, dx < 0 ? -1 : 1);
      } else {                                      // ≤ 50% → volta ao repouso
        card.style.transition = 'transform .18s ease';
        card.style.transform = 'translateX(0)';
        wrap.classList.remove('will-delete');
      }
      if (horiz && Math.abs(dx) > 8) {              // impede que o arraste vire clique
        card.dataset.swiped = '1';
        setTimeout(() => { delete card.dataset.swiped; }, 250);
      }
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
  }

  function wireCards() {
    Array.from(document.querySelectorAll('[data-pdf]')).forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const rep = getReport(btn.getAttribute('data-pdf'));
        sharePDF(rep ? Object.assign({}, rep) : null);
      };
    });

    Array.from(document.querySelectorAll('[data-open]')).forEach(el => {
      el.onclick = () => {
        if (el.dataset.swiped === '1') return; // acabou de arrastar
        openForm(el.getAttribute('data-open'));
      };
    });

    Array.from(document.querySelectorAll('.card-wrap')).forEach(wireSwipe);
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
      <div class="card-wrap">
        <div class="swipe-bg" data-del="${r.data}" title="Excluir">
          <span>🗑️</span><span>🗑️</span>
        </div>
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
      </div>
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

  /* ---------------- TELA: PAINEL DO MÊS ---------------- */
  function openPanel() { state.view = 'panel'; render(); window.scrollTo(0, 0); }

  // Gráfico donut em SVG (sem biblioteca). segs = [{label, value, color}].
  function donutSVG(segs, total) {
    const C = 2 * Math.PI * 45;
    const active = segs.filter(s => s.value > 0);
    const gap = total > 0 && active.length > 1 ? 3 : 0;
    let acc = 0, arcs = '';
    if (total <= 0) {
      arcs = '<circle cx="60" cy="60" r="45" fill="none" stroke="#e6e8ec" stroke-width="18"/>';
    } else {
      segs.forEach(s => {
        if (s.value <= 0) return;
        const segLen = (s.value / total) * C;
        const dash = Math.max(0.001, segLen - gap);
        arcs += `<circle cx="60" cy="60" r="45" fill="none" stroke="${s.color}" stroke-width="18" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-acc}"/>`;
        acc += segLen;
      });
    }
    return `<svg class="donut" viewBox="0 0 120 120" width="118" height="118" role="img" aria-label="Gráfico de propostas">
      <g transform="rotate(-90 60 60)">${arcs}</g>
      <text x="60" y="57" text-anchor="middle" class="donut-num">${total}</text>
      <text x="60" y="73" text-anchor="middle" class="donut-lbl">propostas</text>
    </svg>`;
  }

  function renderPanel() {
    const monthKey = state.month;
    const [y, m] = monthKey.split('-').map(Number);
    const t = monthTotals(monthKey);
    const meta = metaFor(monthKey);
    const feitas = t.aprovadas;
    const pct = meta > 0 ? Math.min(100, Math.round((feitas / meta) * 100)) : 0;
    const weeks = weeklyBreakdown(monthKey);
    const maxAp = Math.max(1, ...weeks.map(w => w.aprovadas));

    // Gráfico de pizza (donut) — propostas por situação (cores validadas)
    const propSegs = [
      { label: 'Aprovadas', value: t.aprovadas, color: '#0ca30c' },
      { label: 'Reprovadas', value: t.reprovadas, color: '#d03b3b' },
      { label: 'Em Análise', value: t.analise, color: '#c98500' },
      { label: 'Pendências', value: t.pendencias, color: '#e0662f' },
    ];
    const propTotal = propSegs.reduce((s, x) => s + x.value, 0);
    const legend = propSegs.map(s => `
      <div class="lg-row">
        <span class="lg-dot" style="background:${s.color}"></span>
        <span class="lg-label">${s.label}</span>
        <span class="lg-val">${s.value}${propTotal ? ' · ' + Math.round((s.value / propTotal) * 100) + '%' : ''}</span>
      </div>`).join('');

    const tiles = ALL_FIELDS.map(f => `
      <div class="stat-tile">
        <div class="st-emoji">${f.emoji}</div>
        <div class="st-num">${t[f.key]}</div>
        <div class="st-label">${f.label}</div>
      </div>`).join('');

    const weeksHTML = weeks.length ? weeks.map(w => {
      const d = parseISO(w.week);
      const end = new Date(d); end.setDate(d.getDate() + 6);
      const label = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' – ' + pad(end.getDate()) + '/' + pad(end.getMonth() + 1);
      return `
        <div class="week-row">
          <div class="wk-head"><span>Semana ${label}</span><b>${w.aprovadas} aprov.</b></div>
          <div class="wk-bar"><i style="width:${Math.round((w.aprovadas / maxAp) * 100)}%"></i></div>
          <div class="wk-sub">${w.dias} dia(s) · ❌ ${w.reprovadas} reprov.</div>
        </div>`;
    }).join('') : '<div class="empty"><p>Sem relatórios neste mês.</p></div>';

    app.innerHTML = `
      <header class="appbar">
        <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
        <div style="flex:1">
          <h1>Painel do mês</h1>
          <span class="sub">${esc(state.config.promotora)} · ${esc(state.config.loja)}</span>
        </div>
        <button class="iconbtn" id="btn-share-month" aria-label="Compartilhar">📤</button>
      </header>

      <div class="screen">
        <div class="month-nav">
          <button id="prev-month" aria-label="Mês anterior">‹</button>
          <div class="label">${MONTHS[m-1]} ${y}</div>
          <button id="next-month" aria-label="Próximo mês">›</button>
        </div>

        <div class="meta-card">
          <div class="row"><span class="label">Meta do mês · aprovados</span></div>
          <div class="row" style="margin-top:4px">
            <div class="big">${feitas}<small> / ${meta || '—'}</small></div>
            <div style="text-align:right;font-size:22px;font-weight:800">${meta ? pct + '%' : ''}</div>
          </div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <div class="hint">${t._dias} dia(s) com relatório no mês</div>
        </div>

        <h2 class="panel-h">Propostas do mês</h2>
        <div class="chart-card">
          ${donutSVG(propSegs, propTotal)}
          <div class="legend">${legend}</div>
        </div>

        <h2 class="panel-h">Totais do mês</h2>
        <div class="stat-grid">${tiles}</div>

        <h2 class="panel-h">Por semana</h2>
        <div class="weeks">${weeksHTML}</div>

        <button type="button" class="pdf-btn" id="btn-month-pdf">📄 PDF do resumo do mês</button>
        <button type="button" class="pdf-btn btn-wpp" id="btn-month-txt">💬 Enviar texto no WhatsApp</button>
      </div>`;

    byId('btn-back').onclick = () => { state.view = 'list'; render(); };
    byId('prev-month').onclick = () => shiftMonth(-1);
    byId('next-month').onclick = () => shiftMonth(1);
    byId('btn-month-pdf').onclick = () => shareMonthPDF(monthKey);
    byId('btn-month-txt').onclick = byId('btn-share-month').onclick = () => shareMonth(monthKey);
  }

  function shareMonth(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const t = monthTotals(monthKey);
    const meta = metaFor(monthKey);
    const weeks = weeklyBreakdown(monthKey);
    let txt = `📊 *Resumo do mês — ${MONTHS[m-1]} ${y}*\n`;
    txt += `🏪 ${state.config.loja} · 👤 ${state.config.promotora}\n`;
    txt += `📅 ${t._dias} dia(s) com relatório\n\n`;
    txt += `*Propostas*\n✅ Aprovadas: ${t.aprovadas}\n❌ Reprovadas: ${t.reprovadas}\n🔍 Em análise: ${t.analise}\n⏳ Pendências: ${t.pendencias}\n\n`;
    txt += `🔗 Links: ${t.link}\n💳 Cartão — 📦 ${t.cartaoEntregas} entregas · 🕓 ${t.cartaoReceber} a receber\n\n`;
    txt += `*Serviços*\n💬 SMS: ${t.sms}\n🎁 Bônus: ${t.bonus}\n📄 Fatura Digital: ${t.faturaDigital}\n🦷 Odonto Plus: ${t.odontoPlus}\n`;
    if (meta) txt += `\n🎯 Meta: ${t.aprovadas}/${meta} aprovados (${Math.round((t.aprovadas / meta) * 100)}%)\n`;
    if (weeks.length) {
      txt += `\n*Aprovadas por semana*\n`;
      weeks.forEach(w => { const d = parseISO(w.week); txt += `• Semana ${pad(d.getDate())}/${pad(d.getMonth() + 1)}: ${w.aprovadas}\n`; });
    }
    if (navigator.share) navigator.share({ title: 'Resumo do mês', text: txt }).catch(() => {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
  }

  /* ---------------- TELA: MENSAGENS (templates) ---------------- */
  function openMsg() {
    pullTemplates().then(() => { if (state.view === 'msg') selectFirstTemplate(); });
    selectFirstTemplate();
    state.view = 'msg';
    render();
    window.scrollTo(0, 0);
  }
  function selectFirstTemplate() {
    state.msg = state.templates[0]
      ? { id: state.templates[0].id, title: state.templates[0].title, body: state.templates[0].body }
      : { id: null, title: '', body: '' };
  }
  function saudacaoAgora() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Bom dia';
    if (h >= 12 && h < 18) return 'Boa tarde';
    return 'Boa noite';
  }
  function applyPlaceholders(s) {
    const d = new Date();
    const hoje = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    return String(s || '')
      .replace(/{saudacao}/gi, saudacaoAgora())
      .replace(/{hoje}/gi, hoje)
      .replace(/{promotora}/gi, state.config.promotora || '')
      .replace(/{loja}/gi, state.config.loja || '');
  }

  function renderMsg() {
    const cur = state.msg;
    const hojeFmt = (() => { const d = new Date(); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); })();
    const phTable = `
      <div class="ph-table">
        <button type="button" class="ph-row" data-ph="{saudacao}"><code>{saudacao}</code><span>${saudacaoAgora()} <i>(muda com a hora)</i></span></button>
        <button type="button" class="ph-row" data-ph="{hoje}"><code>{hoje}</code><span>${hojeFmt}</span></button>
        <button type="button" class="ph-row" data-ph="{promotora}"><code>{promotora}</code><span>${esc(state.config.promotora)}</span></button>
        <button type="button" class="ph-row" data-ph="{loja}"><code>{loja}</code><span>${esc(state.config.loja)}</span></button>
      </div>`;
    const options = ['<option value="">— Novo template —</option>']
      .concat(state.templates.map(t =>
        `<option value="${t.id}" ${String(t.id) === String(cur.id) ? 'selected' : ''}>${esc(t.title)}</option>`))
      .join('');

    app.innerHTML = `
      <header class="appbar">
        <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
        <div style="flex:1"><h1>Mensagens</h1><span class="sub">Templates de WhatsApp</span></div>
      </header>
      <div class="screen">
        <div class="field">
          <label>Template</label>
          <select id="tpl-sel">${options}</select>
        </div>
        <div class="field">
          <label>Título</label>
          <input id="tpl-title" type="text" value="${esc(cur.title)}" placeholder="Ex.: Boas-vindas" />
        </div>
        <div class="field">
          <label>Mensagem</label>
          <textarea id="tpl-body" rows="8" placeholder="Escreva a mensagem...">${esc(cur.body)}</textarea>
          <div class="hint-inline">Atalhos (preenchidos ao enviar) — toque para inserir:</div>
          ${phTable}
        </div>
        <div class="msg-actions">
          ${cur.id ? '<button class="btn-ghost" id="tpl-del">🗑️</button>' : ''}
          <button class="btn-ghost" id="tpl-save">💾 Salvar</button>
          <button class="btn-save" id="tpl-send">📤 Enviar</button>
        </div>
      </div>`;

    byId('btn-back').onclick = () => { state.view = 'list'; render(); };
    byId('tpl-sel').onchange = (e) => {
      const id = e.target.value;
      const t = state.templates.find(x => String(x.id) === String(id));
      state.msg = t ? { id: t.id, title: t.title, body: t.body } : { id: null, title: '', body: '' };
      render();
    };
    byId('tpl-title').oninput = (e) => { state.msg.title = e.target.value; };
    byId('tpl-body').oninput = (e) => { state.msg.body = e.target.value; };
    // Atalhos clicáveis: insere o placeholder na posição do cursor
    Array.from(document.querySelectorAll('.ph-row')).forEach(btn => {
      btn.onclick = () => {
        const ta = byId('tpl-body');
        const ph = btn.getAttribute('data-ph');
        const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
        const e = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
        ta.value = ta.value.slice(0, s) + ph + ta.value.slice(e);
        state.msg.body = ta.value;
        ta.focus();
        const pos = s + ph.length;
        ta.setSelectionRange(pos, pos);
      };
    });
    byId('tpl-save').onclick = saveTemplate;
    byId('tpl-send').onclick = sendTemplate;
    if (byId('tpl-del')) byId('tpl-del').onclick = deleteTemplate;
  }

  function sendTemplate() {
    const txt = applyPlaceholders(state.msg.body);
    if (!txt.trim()) { toast('Mensagem vazia', 'err'); return; }
    if (navigator.share) navigator.share({ text: txt }).catch(() => {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank');
  }

  async function saveTemplate() {
    const t = state.msg;
    if (!t.title.trim()) { toast('Dê um título ao template', 'err'); return; }
    if (!isOnline() || !sessionValid()) { toast('Conecte à internet para salvar', 'err'); return; }
    try {
      const res = await fetch(apiUrl('/api/templates'), {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ template: { id: t.id || undefined, title: t.title, body: t.body } }),
      });
      if (res.status === 401) { refreshSession(); toast('Faça login novamente', 'err'); return; }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'falha');
      await pullTemplates();
      state.msg = { id: data.template.id, title: data.template.title, body: data.template.body };
      render();
      toast('Template salvo ✓', 'ok');
    } catch (e) { toast('Erro: ' + e.message, 'err'); }
  }

  async function deleteTemplate() {
    const t = state.msg;
    if (!t.id) { state.msg = { id: null, title: '', body: '' }; render(); return; }
    if (!window.confirm('Excluir o template “' + t.title + '”?')) return;
    if (!isOnline() || !sessionValid()) { toast('Conecte à internet para excluir', 'err'); return; }
    try {
      const res = await fetch(apiUrl('/api/templates?id=' + encodeURIComponent(t.id)), {
        method: 'DELETE', headers: authHeaders(),
      });
      if (res.status === 401) { refreshSession(); toast('Faça login novamente', 'err'); return; }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'falha');
      await pullTemplates();
      selectFirstTemplate();
      render();
      toast('Template excluído', 'ok');
    } catch (e) { toast('Erro: ' + e.message, 'err'); }
  }

  /* ---------------- TELA: FORMULÁRIO ---------------- */
  function openForm(dataISO) {
    const existing = getReport(dataISO);
    state.editing = existing || blankReport(dataISO);
    state.editingNew = !existing;
    state.view = 'form';
    render();
    window.scrollTo(0, 0);
  }

  // Sempre começa em branco (zerado), título "Novo".
  function openNew() {
    state.editing = blankReport(todayISO());
    state.editingNew = true;
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
          <h1>${state.editingNew ? 'Novo' : 'Editar'} Relatório</h1>
          <span class="sub">${esc(state.config.promotora)} · ${esc(state.config.loja)}</span>
        </div>
        ${!state.editingNew ? '<button class="iconbtn" id="btn-del" aria-label="Excluir">🗑️</button>' : ''}
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
    if (byId('btn-del')) byId('btn-del').onclick = onDelete;

    // liga os contadores
    ALL_FIELDS.forEach(f => wireCounter(f, r));
  }

  // Exclui de fato (sem perguntar). Usado pelo swipe — o gesto já é a confirmação.
  async function deleteReportNow(dataISO) {
    try {
      await apiDelete(dataISO);
      state.reports = state.reports.filter(x => x.data !== dataISO);
      state.queue = state.queue.filter(x => x.data !== dataISO);
      save(LS.reports, state.reports);
      save(LS.queue, state.queue);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Exclusão COM confirmação — usada pelo botão 🗑️ do formulário.
  async function deleteReportByDate(dataISO) {
    if (!getReport(dataISO)) return false;
    const d = parseISO(dataISO);
    const quando = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    if (!window.confirm('Excluir o relatório de ' + quando + '?\n\nEsta ação não pode ser desfeita.')) return false;
    if (!isOnline() || !sessionValid()) { toast('Conecte à internet para excluir', 'err'); return false; }
    const ok = await deleteReportNow(dataISO);
    if (!ok) toast('Não foi possível excluir', 'err');
    return ok;
  }

  async function onDelete() {
    const r = state.editing;
    if (!getReport(r.data)) { state.view = 'list'; render(); return; }
    const btn = byId('btn-del');
    if (btn) btn.disabled = true;
    const ok = await deleteReportByDate(r.data);
    if (ok) {
      state.view = 'list';
      render();
      toast('Relatório excluído', 'ok');
    } else if (btn) {
      btn.disabled = false;
    }
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
    // Novo relatório para um dia que já existe → confirma antes de substituir.
    if (state.editingNew && getReport(r.data)) {
      const dd = parseISO(r.data);
      if (!window.confirm('Já existe um relatório para ' + pad(dd.getDate()) + '/' + pad(dd.getMonth() + 1) + '/' + dd.getFullYear() + '.\nSubstituir?')) return;
    }
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
      <button class="menu-item" id="mi-panel">
        <span class="mi-ico">📊</span>
        <span>Painel do mês<small>Totais e resumo por semana</small></span>
      </button>
      <button class="menu-item" id="mi-sheet">
        <span class="mi-ico">📗</span>
        <span>Gerar planilha do Google<small>Salva no Drive e compartilha</small></span>
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
      <button class="menu-item" id="mi-logout">
        <span class="mi-ico">🚪</span>
        <span>Sair<small>${esc(state.session.email || '')}</small></span>
      </button>
      <div class="status-line" id="cfg-status" style="margin-top:12px"></div>
      <div class="app-version">Relatório Diário · ${APP_VERSION}</div>
    `, () => {
      byId('mi-config').onclick = () => { closeSheet(); openConfig(); };
      byId('mi-panel').onclick = () => { closeSheet(); openPanel(); };
      byId('mi-sheet').onclick = () => { closeSheet(); generateSheet(); };
      byId('mi-share').onclick = () => { closeSheet(); shareToday(); };
      byId('mi-msg').onclick = () => { closeSheet(); openMsg(); };
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
  // Gera/atualiza a planilha do Google no Drive do gerente, copia o link e mostra opções.
  async function generateSheet() {
    if (!isOnline() || !sessionValid()) { toast('Conecte à internet', 'err'); return; }
    toast('Gerando planilha...');
    try {
      const res = await fetch(apiUrl('/api/sheet'), {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ month: state.month }),
      });
      if (res.status === 401) { refreshSession(); toast('Faça login novamente', 'err'); return; }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'falha');
      const copied = await copyToClipboard(data.url);
      showSheetLink(data.url, copied);
    } catch (e) {
      toast('Erro ao gerar planilha: ' + e.message, 'err');
    }
  }

  function showSheetLink(url, copied) {
    openSheet(`
      <h2>Planilha pronta ✓</h2>
      <p class="status-line" style="margin:-4px 0 12px">${copied ? '🔗 Link copiado para a área de transferência.' : 'Toque em “Copiar link” abaixo.'}</p>
      <div class="field">
        <input id="sheet-url" type="text" readonly value="${esc(url)}" onclick="this.select()" />
      </div>
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

  async function copyToClipboard(text) {
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

  // Monta um PDF (A4) a partir de uma função de desenho — reaproveitado por relatório e resumo.
  function pdfBuild(draw) {
    let c = '';
    const F1 = 'F1', F2 = 'F2';
    const txt = (x, y, size, font, color, s) => { const [r, g, b] = color; c += `BT /${font} ${size} Tf ${r} ${g} ${b} rg ${x} ${y} Td (${pdfEsc(latin1(s))}) Tj ET\n`; };
    const rect = (x, y, w, h, color) => { const [r, g, b] = color; c += `${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f\n`; };
    const line = (x1, y, x2, color) => { const [r, g, b] = color; c += `${r} ${g} ${b} RG 0.6 w ${x1} ${y} m ${x2} ${y} l S\n`; };
    // Setor de pizza preenchido (a0/a1 em radianos, CCW). Aproxima o arco com Béziers.
    const sector = (cx, cy, R, a0, a1, color) => {
      const [r, g, b] = color;
      let s = `${r} ${g} ${b} rg ${cx} ${cy} m ${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)} l `;
      let start = a0;
      const dir = a1 >= a0 ? 1 : -1;
      while (Math.abs(a1 - start) > 1e-6) {
        const step = dir * Math.min(Math.PI / 2, Math.abs(a1 - start));
        const end = start + step;
        const k = (4 / 3) * Math.tan(step / 4);
        const p0x = cx + R * Math.cos(start), p0y = cy + R * Math.sin(start);
        const c1x = p0x - k * R * Math.sin(start), c1y = p0y + k * R * Math.cos(start);
        const p1x = cx + R * Math.cos(end), p1y = cy + R * Math.sin(end);
        const c2x = p1x + k * R * Math.sin(end), c2y = p1y - k * R * Math.cos(end);
        s += `${c1x} ${c1y} ${c2x} ${c2y} ${p1x} ${p1y} c `;
        start = end;
      }
      c += s + `${cx} ${cy} l f\n`;
    };
    draw({ txt, rect, line, sector, F1, F2 });
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

  function buildMonthPDF(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const t = monthTotals(monthKey);
    const meta = metaFor(monthKey);
    const pct = meta > 0 ? Math.round((t.aprovadas / meta) * 100) : 0;
    const weeks = weeklyBreakdown(monthKey);
    const PIE = [
      { label: 'Aprovadas', value: t.aprovadas, color: [0.047, 0.639, 0.047] },
      { label: 'Reprovadas', value: t.reprovadas, color: [0.816, 0.231, 0.231] },
      { label: 'Em Análise', value: t.analise, color: [0.788, 0.522, 0.000] },
      { label: 'Pendências', value: t.pendencias, color: [0.878, 0.400, 0.184] },
    ];
    const pieTotal = PIE.reduce((s, x) => s + x.value, 0);

    return pdfBuild(({ txt, rect, line, sector, F1, F2 }) => {
      let yy = 752;
      rect(0, 792, 595, 50, PDF.RED);
      txt(40, 814, 19, F2, PDF.WHITE, 'RESUMO DO MÊS');
      txt(40, 799, 10.5, F1, PDF.WHITE, (state.config.loja || '') + '  ·  ' + (state.config.promotora || ''));
      txt(40, yy, 10, F1, PDF.MUTED, 'MÊS');
      txt(40, yy - 17, 15, F2, PDF.INK, MONTHS[m - 1] + ' ' + y + '  —  ' + t._dias + ' dia(s) com relatório');
      yy -= 46;
      const section = (title) => { txt(40, yy, 11, F2, PDF.RED, title.toUpperCase()); line(40, yy - 6, 555, PDF.LIGHT); yy -= 24; };
      const row = (label, value) => { txt(48, yy, 12, F1, PDF.INK, label); txt(360, yy, 13, F2, PDF.INK, String(value)); yy -= 21; };
      section('Meta');
      row('Aprovados no mês', t.aprovadas + ' / ' + (meta || '—') + (meta ? '   (' + pct + '%)' : ''));
      yy -= 6;

      // Gráfico de pizza das propostas + legenda
      section('Propostas');
      const cx = 115, cy = yy - 62, R = 56;
      if (pieTotal <= 0) {
        sector(cx, cy, R, 0, 2 * Math.PI - 1e-4, [0.90, 0.90, 0.92]);
      } else {
        let a = Math.PI / 2; // começa no topo
        PIE.forEach(s => {
          if (s.value <= 0) return;
          const a1 = a + (s.value / pieTotal) * 2 * Math.PI;
          sector(cx, cy, R, a, a1, s.color);
          a = a1;
        });
      }
      // legenda à direita
      let ly = yy - 26;
      PIE.forEach(s => {
        rect(220, ly - 8, 11, 11, s.color);
        txt(238, ly, 12, F1, PDF.INK, s.label);
        txt(430, ly, 12, F2, PDF.INK, s.value + (pieTotal ? '  (' + Math.round((s.value / pieTotal) * 100) + '%)' : ''));
        ly -= 26;
      });
      yy = cy - R - 18;

      section('Totais do mês');
      ALL_FIELDS.forEach(f => row(f.label, t[f.key]));
      yy -= 6;
      if (weeks.length) {
        section('Por semana');
        weeks.forEach(w => {
          const d = parseISO(w.week);
          row('Semana ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1),
            w.aprovadas + ' aprov · ' + w.reprovadas + ' reprov · ' + w.dias + ' dia(s)');
        });
      }
      line(40, 54, 555, PDF.LIGHT);
      let quando = ''; try { quando = new Date().toLocaleString('pt-BR'); } catch (e) {}
      txt(40, 40, 9, F1, PDF.MUTED, 'Gerado em ' + quando + '  ·  App Relatório Diário');
    });
  }

  function shareMonthPDF(monthKey) {
    const blob = buildMonthPDF(monthKey);
    downloadOrShare(blob, 'Resumo_' + monthKey + '.pdf', 'application/pdf');
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
    pullTemplates();         // baixa os templates de mensagem
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
