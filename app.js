/* =====================================================================
   Relatório Diário — Edna Grace / Savegnago
   PWA em JS puro (sem framework), pensado para o Galaxy A15.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- Definição dos campos do relatório ---------- */
  const GROUPS = [
    {
      title: 'Abordagem', emoji: '👥', fields: [
        { key: 'clientesAbordados', label: 'Clientes Abordados', emoji: '👥' },
      ]
    },
    {
      title: 'Propostas', emoji: '📋', fields: [
        { key: 'aprovadas',  label: 'Aprovadas',   emoji: '✅', dailyMeta: true },
        { key: 'preAprovado',label: 'Pré-Aprovado',emoji: '🟡' },
        { key: 'reprovadas', label: 'Reprovadas',  emoji: '❌' },
        { key: 'analise',    label: 'Em Análise',  emoji: '🔍' },
        { key: 'pendencias', label: 'Pendências',  emoji: '⏳' },
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
        { key: 'cartaoAtivacao', label: 'Ativação',  emoji: '✅' },
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
  /* ---------------- Ambientes: PRODUÇÃO e TESTE ----------------
     O app fala com uma de duas APIs. A de produção grava no banco real da Edna; a de
     teste grava num branch do Neon — uma cópia descartável. Só o desenvolvedor troca,
     pelo menu; a Edna nunca vê essa opção e nunca sai da produção. */
  const ENVS = {
    prod: {
      label: 'Produção',
      api: 'https://relatorio-api.vercel.app',
    },
    staging: {
      label: 'Teste',
      api: 'https://relatorio-api-git-staging-joaopauloantunes-projects.vercel.app',
    },
  };

  // Fica FORA do namespace abaixo: precisa ser lido antes de sabermos qual é o ambiente.
  const LS_ENV = 'edna.env';
  function envAtual() {
    try { return localStorage.getItem(LS_ENV) === 'staging' ? 'staging' : 'prod'; }
    catch (e) { return 'prod'; }   // qualquer erro cai na produção, que é o normal
  }
  const ENV = envAtual();
  const IS_STAGING = ENV === 'staging';

  /* O armazenamento local é SEPARADO por ambiente, e isto não é cosmético.
     O app é offline-first: ele guarda o cache de relatórios e uma FILA DE ENVIO no
     celular. Sem separar, você entraria no teste, criaria dados de mentira, voltaria
     para a produção — e a fila sincronizaria esses dados de mentira DENTRO do banco
     real. Seria um jeito novo de perder dados, no lugar do antigo.

     A produção mantém exatamente os nomes de chave de sempre ('edna.config', ...), então
     ninguém é deslogado nem perde o que já estava no aparelho. */
  const PREFIXO = IS_STAGING ? 'edna.staging.' : 'edna.';
  const LS = {
    config:  PREFIXO + 'config',
    reports: PREFIXO + 'reports.cache',
    queue:   PREFIXO + 'queue',
    metas:   PREFIXO + 'metas',
    session: PREFIXO + 'session',
    settingsPending: PREFIXO + 'settingsPending',
    templates: PREFIXO + 'templates',
    contacts: PREFIXO + 'contacts',
  };

  // Emails autorizados (o back-end também confere — isto é só para a UX).
  const ALLOWLIST = [
    'ednapromotora69@gmail.com',
    'edna.cristina.g69@gmail.com',
    'jpantunesdesouza@gmail.com',
  ];

  // Configuração fixa do site — igual para qualquer navegador/aparelho.
  // Não são segredos (a API só aceita sessão válida de um email da allowlist).
  // O API_BASE agora vem do ambiente escolhido (produção, salvo alguém trocar no menu).
  const API_BASE = ENVS[ENV].api;
  const GOOGLE_CLIENT_ID = '81605218542-e00ff2h9oontd7vrtic5gpt0cf0but6u.apps.googleusercontent.com';
  const APP_VERSION = 'v48'; // aumente junto com o CACHE do sw.js a cada atualização

  // Config do usuário (fica no celular como cache; a fonte compartilhada é o Neon).
  const defaultConfig = {
    promotora:'Edna Grace',
    loja:     'Savegnago',
    metaDia:  3,                  // meta diária de cartões aprovados (editável)
    headerColor: '',             // header color (production only); empty = brand red
    birthDate: '',               // 'YYYY-MM-DD' — promotora's date of birth
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
    contacts: load(LS.contacts, []),      // [{ id, name, phone, email, gender }]
    msg:     { id: null, title: '', body: '' },
    contatoId: null,                      // contato selecionado na tela Mensagens
    imp:     { file: null, fileName: '', sheetUrl: '', preview: null, busy: false },
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

  /* ---------- Contatos ---------- */
  async function pullContacts() {
    if (!API_BASE || !sessionValid() || !isOnline()) return;
    try {
      const res = await fetch(apiUrl('/api/contacts'), { headers: authHeaders() });
      if (res.status === 401) { refreshSession(); return; }
      const data = await res.json();
      if (data && data.ok) { state.contacts = data.contacts || []; save(LS.contacts, state.contacts); }
    } catch (e) {}
  }

  function contatoAtual() {
    return state.contacts.find(c => String(c.id) === String(state.contatoId)) || null;
  }
  function contatoLabel(c) {
    return (c.name && c.name.trim()) || c.phone || c.email || 'Sem nome';
  }
  // Normaliza telefone BR para o formato do wa.me (DDI 55 + DDD + número).
  function phoneDigits(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length === 10 || d.length === 11) d = '55' + d;   // faltou o DDI
    return d;
  }
  // A agenda do celular só pode ser LIDA (Contact Picker). Para "salvar na agenda"
  // geramos um cartão .vcf e o Android pergunta se quer adicionar aos contatos.
  function contactPickerDisponivel() {
    return !!(navigator.contacts && navigator.contacts.select && window.ContactsManager);
  }
  function vcardDe(c) {
    // FN é obrigatório no vCard 3.0 — sem ele o Android recusa o cartão.
    // Se não houver nome, usa o telefone (ou e-mail) como identificação.
    const nome = (c.name || '').trim() || (c.phone || '').trim() || (c.email || '').trim() || 'Contato';
    const l = ['BEGIN:VCARD', 'VERSION:3.0'];
    l.push('FN:' + nome);
    l.push('N:' + nome + ';;;;');
    if (c.phone) l.push('TEL;TYPE=CELL:' + c.phone);
    if (c.email) l.push('EMAIL;TYPE=INTERNET:' + c.email);
    l.push('END:VCARD');
    return l.join('\r\n');
  }
  // IMPORTANTE: precisa ser chamada DENTRO do gesto de toque (antes de qualquer await),
  // senão o Android bloqueia o navigator.share().
  function salvarNaAgenda(c) {
    const blob = new Blob([vcardDe(c)], { type: 'text/vcard;charset=utf-8' });
    const nome = ((c.name || c.phone || 'contato') + '').replace(/[^\w\-]+/g, '_') + '.vcf';
    const file = new File([blob], nome, { type: 'text/vcard' });

    // 1) tenta o compartilhamento nativo (o Android oferece "Contatos")
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: c.name || 'Contato' })
        .catch(() => baixarVcf(blob, nome));   // se recusar/falhar, baixa o cartão
      return;
    }
    // 2) fallback: baixa o .vcf — tocar na notificação abre "adicionar aos contatos"
    baixarVcf(blob, nome);
  }

  function baixarVcf(blob, nome) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      toast('Cartão salvo — toque na notificação para adicionar aos contatos', 'ok');
    } catch (e) {
      toast('Não foi possível gerar o cartão de contato', 'err');
    }
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
  // Itens só de desenvolvedor (ex.: documentação da API)
  const ADMIN_EMAIL = 'jpantunesdesouza@gmail.com';
  function ehAdmin() {
    return String(state.session.email || '').toLowerCase() === ADMIN_EMAIL;
  }

  /* ---------------- Troca de ambiente (só desenvolvedor) ----------------
     Trocar recarrega a página: o API_BASE e as chaves do localStorage são decididos
     uma vez, na carga. Recarregar é mais simples — e mais seguro — do que tentar
     religar tudo com o app em pé. */
  function trocarEnv(novo) {
    if (!ENVS[novo] || novo === ENV) return;
    try { localStorage.setItem(LS_ENV, novo); } catch (e) {}
    location.reload();
  }

  /* Faixa vermelha, impossível de ignorar, quando o app está no ambiente de teste.
     Só aparece no staging — em produção o app fica exatamente como sempre foi. */
  function mostrarBannerTeste() {
    if (!IS_STAGING || byId('env-banner')) return;
    const b = document.createElement('button');
    b.id = 'env-banner';
    b.type = 'button';
    b.textContent = '🧪 AMBIENTE DE TESTE — banco descartável · toque para voltar à produção';
    b.onclick = () => trocarEnv('prod');
    document.body.insertBefore(b, document.body.firstChild);
    // A classe também pinta o cabeçalho de âmbar. Como ele é sticky (sempre visível),
    // o aviso continua na tela mesmo com a página rolada — a faixa sozinha sumiria.
    document.body.classList.add('has-env-banner');
  }

  /* Confere o ambiente com a PRÓPRIA API, em vez de confiar no que o app acha que é.
     É a mesma lição do incidente de 13/07: a configuração pode mentir; o que vale é o
     que o código em execução responde. Se o app pensa que está no teste mas a API diz
     'production', ele está a um clique de escrever no banco real — então voltamos para
     a produção na marra, para que pelo menos o rótulo não minta. */
  async function conferirAmbiente() {
    let raiz;
    try {
      raiz = await (await fetch(apiUrl('/'), { cache: 'no-store' })).json();
    } catch (e) {
      return;   // offline: não dá para conferir, e o app é offline-first. Segue.
    }
    const esperado = IS_STAGING ? 'staging' : 'production';
    if (raiz && raiz.env && raiz.env !== esperado) {
      alert(
        'ATENÇÃO: o app está marcado como "' + ENVS[ENV].label + '", mas a API respondeu "' +
        raiz.env + '".\n\nPor segurança, voltando para a produção.'
      );
      try { localStorage.removeItem(LS_ENV); } catch (e) {}
      location.reload();
      return;
    }
    if (IS_STAGING) console.info('[ambiente] teste · API', raiz.env, '· banco', raiz.db);
  }

  /* ---------------- Cor do cabeçalho (só PRODUÇÃO) ----------------
     A cor fica salva no banco (settings), então é a mesma em todos os aparelhos.
     O ambiente de TESTE não escolhe cor: é sempre âmbar, para nunca se confundir com a
     produção. Por isso não há checagem entre ambientes — a única regra é "produção não
     pode ser âmbar", garantida por validarCorCabecalho. */
  const DEFAULT_HEADER = '#e8734e';   // coral da marca
  const TEST_AMBER = '#e08a00';

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function relLum({ r, g, b }) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function hueOf({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return 0;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  // null = ok; senão, o motivo (para mostrar ao usuário).
  function validarCorCabecalho(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 'cor inválida';
    // Header text is white and large/bold, so require WCAG AA for large text (>= 3:1).
    // This admits vibrant brand tones like the coral while still rejecting pale colors.
    if (1.05 / (relLum(rgb) + 0.05) < 3) return 'clara demais — o texto branco do cabeçalho fica ilegível';
    // Faixa de matiz laranja/âmbar/amarelo: reservada ao ambiente de teste.
    const h = hueOf(rgb);
    if (h >= 30 && h <= 70) return 'parecida com o âmbar do ambiente de teste — escolha outra família de cor';
    return null;
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }
  function rgbToHex(r, g, b) {
    const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }
  const hslToRgb = (h, s, l) => hexToRgb(hslToHex(h, s, l));

  // Paint-style swatch grid: a spectrum of header-ready colors. Built by sweeping the hue
  // wheel at two lightness levels and KEEPING ONLY what passes validarCorCabecalho (enough
  // contrast for white text, and never the reserved test amber). The brand coral leads.
  const HEADER_PALETTE = (() => {
    const out = [{ nome: 'Coral', cor: DEFAULT_HEADER }];
    for (const l of [34, 46]) {
      for (let h = 0; h < 360; h += 15) {
        const cor = hslToHex(h, 72, l);
        if (!validarCorCabecalho(cor) && !out.some((o) => o.cor === cor)) {
          out.push({ nome: cor, cor });
        }
      }
    }
    // A few neutrals to round it out (like Paint's grey row).
    ['#4b5563', '#37414f', '#263238', '#111827'].forEach((cor) => out.push({ nome: cor, cor }));
    return out;
  })();

  // Primary base colors (a quick row, like Paint's basic colors). All header-valid.
  const PRIMARIES = ['#d10a11', '#e8734e', '#b02a6b', '#8e24aa', '#5e35b1',
    '#1b52c0', '#0277bd', '#0f6f7f', '#1e7d45', '#37414f'];

  // A cor que o cabeçalho deve ter agora. No teste, null (o CSS força âmbar).
  function corCabecalho() {
    if (IS_STAGING) return null;
    const c = state.config.headerColor;
    return (c && !validarCorCabecalho(c)) ? c : DEFAULT_HEADER;
  }
  // Mixes a hex color toward black (amount < 0) or white (amount > 0), |amount| in [0,1].
  function shade(hex, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const target = amount < 0 ? 0 : 255;
    const t = Math.abs(amount);
    const h = (v) => Math.round(v + (target - v) * t).toString(16).padStart(2, '0');
    return '#' + h(rgb.r) + h(rgb.g) + h(rgb.b);
  }
  // Applies the configured color to the WHOLE identity: sets --header-color and derives the
  // dark/soft shades (used by buttons, FAB, quick-select, login gradient…) plus the mobile
  // status-bar color. Test environment is always amber.
  function aplicarCorCabecalho() {
    const c = IS_STAGING ? TEST_AMBER : corCabecalho();
    const root = document.documentElement.style;
    root.setProperty('--header-color', c);
    root.setProperty('--header-dark', shade(c, -0.22));
    root.setProperty('--header-soft', shade(c, 0.88));
    const rgb = hexToRgb(c) || { r: 20, g: 22, b: 30 };
    root.setProperty('--header-glow', `rgba(${rgb.r},${rgb.g},${rgb.b},0.4)`);
    // Note: the system status bar is intentionally left at the fixed dark theme-color from
    // index.html — it does NOT follow the header color (avoids the cached-color hairline).
  }

  /* Escape hatch contra cache teimoso: apaga TODOS os caches, desregistra o service
     worker e recarrega com cache-buster. A sessão e os dados locais são preservados
     (ficam no localStorage, que não é tocado). */
  async function forcarAtualizacao() {
    toast('Limpando cache e recarregando...');
    try {
      if (window.caches) {
        const chaves = await caches.keys();
        await Promise.all(chaves.map((k) => caches.delete(k)));
      }
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (e) { /* segue e recarrega mesmo assim */ }
    // cache-buster na URL para furar também o cache HTTP (max-age=600 do GitHub Pages)
    location.replace(location.origin + location.pathname + '?u=' + Date.now());
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
      headerColor: state.config.headerColor || '',
      birthDate: state.config.birthDate || '',
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
        if (typeof s.headerColor !== 'undefined') state.config.headerColor = s.headerColor;
        if (typeof s.birthDate !== 'undefined') state.config.birthDate = s.birthDate;
        save(LS.config, state.config);
        aplicarCorCabecalho();   // a cor pode ter mudado em outro aparelho
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
    if (state.view === 'import') return renderImport();
    return renderList();
  }

  /* ---------------- TELA: IMPORTAR PLANILHA ---------------- */
  function openImport() {
    state.imp = { file: null, fileName: '', sheetUrl: '', preview: null, busy: false };
    state.view = 'import';
    render();
    window.scrollTo(0, 0);
  }

  function renderImport() {
    const imp = state.imp || {};
    const p = imp.preview;

    const previaHTML = !p ? '' : `
      <div class="imp-preview">
        <div class="imp-nums">
          <div><b>${p.total}</b><span>relatórios</span></div>
          <div class="ok"><b>${p.novos}</b><span>novos</span></div>
          <div class="warn"><b>${p.substituidos}</b><span>substituem</span></div>
          <div class="err"><b>${(p.errors || []).length}</b><span>erros</span></div>
        </div>
        ${p.substituidos ? `<div class="hint-inline">⚠️ ${p.substituidos} dia(s) já existem e serão <b>substituídos</b> pelos dados da planilha.</div>` : ''}
        ${(p.errors || []).length ? `<div class="imp-errors">${p.errors.slice(0, 8).map(e =>
            `<div>Linha ${e.linha}: ${esc(e.erro)}</div>`).join('')}${p.errors.length > 8 ? `<div>… e mais ${p.errors.length - 8}</div>` : ''}</div>` : ''}
        ${p.aviso ? `<div class="hint-inline">${esc(p.aviso)}</div>` : ''}
        ${p.total ? `<button type="button" class="btn-save" id="imp-commit" style="width:100%;height:54px;margin-top:14px">✅ Importar ${p.total} relatório(s)</button>` : ''}
      </div>`;

    app.innerHTML = `
      <header class="appbar">
        <button class="iconbtn" id="btn-back" aria-label="Voltar">‹</button>
        <div style="flex:1"><h1>Importar planilha</h1><span class="sub">Criar relatórios em massa</span></div>
      </header>
      <div class="screen">
        <button type="button" class="btn-save" id="imp-gsheet" style="width:100%;height:54px">📗 Criar planilha no Google (editável)</button>
        <div class="hint-inline">Cria uma planilha já no formato certo, pronta para preencher e compartilhar. <b>Não precisa ser pública</b> — o app lê direto do Drive.</div>
        <button type="button" class="pdf-btn" id="imp-modelo" style="margin-top:12px">⬇️ Ou baixar modelo em XLSX (Excel)</button>

        <h2 class="panel-h">1. Escolha a planilha</h2>

        <div class="field">
          <label>Link da planilha do Google</label>
          <input id="imp-url" type="url" inputmode="url" placeholder="https://docs.google.com/spreadsheets/d/..." value="${esc(imp.sheetUrl || '')}" />
          <div class="hint-inline">Planilhas criadas aqui (pasta <b>Edna App</b>) são lidas direto do Drive — <b>não precisam ser públicas</b>. Só uma planilha de fora exigiria compartilhamento por link.</div>
        </div>

        <div class="imp-or">ou</div>

        <label class="imp-file">
          <input type="file" id="imp-input" accept=".csv,.xlsx,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet" hidden />
          <span class="imp-file-ico">📄</span>
          <span class="imp-file-txt">${imp.fileName ? esc(imp.fileName) : 'Escolher arquivo (CSV, XLSX, XLS, ODS)'}</span>
        </label>

        <button type="button" class="btn-save" id="imp-analisar" style="width:100%;height:54px;margin-top:6px" ${imp.busy ? 'disabled' : ''}>
          ${imp.busy ? 'Analisando...' : '🔎 Analisar planilha'}
        </button>

        ${p ? '<h2 class="panel-h">2. Confira antes de importar</h2>' : ''}
        ${previaHTML}
      </div>`;

    byId('btn-back').onclick = () => { state.view = 'list'; render(); };
    byId('imp-modelo').onclick = baixarModelo;
    byId('imp-gsheet').onclick = criarPlanilhaGoogle;
    byId('imp-input').onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      state.imp.file = f;
      state.imp.fileName = f.name;
      state.imp.preview = null;
      render();
    };
    byId('imp-url').oninput = (e) => { state.imp.sheetUrl = e.target.value.trim(); };
    byId('imp-analisar').onclick = () => analisarPlanilha(false);
    if (byId('imp-commit')) byId('imp-commit').onclick = () => analisarPlanilha(true);
  }

  function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // Cria uma planilha nova e editável no Google Drive (formato certo, pronta para preencher).
  // Compartilhar um LINK é sempre permitido pelo Chrome — ao contrário de arquivos .xlsx,
  // que ele recusa no Web Share (o famoso NotAllowedError).
  async function criarPlanilhaGoogle() {
    if (!isOnline() || !sessionValid()) { toast('Conecte à internet', 'err'); return; }
    const btn = byId('imp-gsheet');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Criando planilha...'; }
    try {
      const res = await fetch(apiUrl('/api/import'), {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ action: 'modelo-google' }),
      });
      if (res.status === 401) { refreshSession(); throw new Error('sessão expirada — faça login de novo'); }
      const data = await res.json();
      if (!data.ok || !data.url) throw new Error(data.error || 'não consegui criar a planilha');

      state.imp.sheetUrl = data.url;   // já deixa pronta para "Analisar"
      const copiado = await copyToClipboard(data.url);
      mostrarPlanilhaCriada(data.url, data.name || 'Planilha', copiado);
    } catch (e) {
      toast('Erro: ' + e.message, 'err');
    } finally {
      const b = byId('imp-gsheet');
      if (b) { b.disabled = false; b.textContent = '📗 Criar planilha no Google (editável)'; }
    }
  }

  function mostrarPlanilhaCriada(url, nome, copiado) {
    openSheet(`
      <h2>Planilha criada ✓</h2>
      <div class="file-ready">
        <span class="fr-ico">📗</span>
        <span class="fr-txt"><b>${esc(nome)}</b><small>no Drive, pasta “Edna App” · editável</small></span>
      </div>
      <p class="status-line" style="margin:-6px 0 12px">
        ${copiado ? '🔗 Link copiado para a área de transferência.' : 'Use os botões abaixo.'}
      </p>
      <div class="actions">
        <button class="secondary" id="pg-share">📤 Compartilhar link</button>
        <button class="primary" id="pg-open" style="flex:1">Abrir planilha</button>
      </div>
      <div class="status-line" id="pg-status" style="margin-top:12px">
        Preencha, volte aqui e toque em <b>Analisar planilha</b> — o link já está no campo.
      </div>
    `, () => {
      const st = byId('pg-status');
      byId('pg-open').onclick = () => window.open(url, '_blank');
      byId('pg-share').onclick = async () => {
        try {
          if (navigator.share) {
            // Compartilhar TEXTO/URL — sempre permitido (o bloqueio é só para arquivos)
            await navigator.share({ title: nome, text: 'Planilha para preencher:', url });
            st.textContent = '✅ Enviado.';
            st.style.color = '#1e9e57';
          } else {
            const ok = await copyToClipboard(url);
            st.textContent = ok ? '🔗 Link copiado.' : 'Não consegui copiar o link.';
            st.style.color = ok ? '#1e9e57' : '#d10a11';
          }
        } catch (e) {
          if (e && e.name === 'AbortError') { st.textContent = 'Compartilhamento cancelado.'; st.style.color = '#6b7280'; return; }
          const ok = await copyToClipboard(url);
          st.textContent = ok ? '🔗 Link copiado (compartilhar falhou).' : 'Falhou: ' + (e.message || '?');
          st.style.color = ok ? '#e08a00' : '#d10a11';
        }
      };
    });
  }

  async function baixarModelo() {
    if (!isOnline() || !sessionValid()) { toast('Conecte à internet para baixar o modelo', 'err'); return; }
    const btn = byId('imp-modelo');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparando modelo...'; }
    try {
      const res = await fetch(apiUrl('/api/import'), { headers: authHeaders() });
      if (res.status === 401) { refreshSession(); throw new Error('sessão expirada — faça login de novo'); }
      if (!res.ok) throw new Error('o servidor respondeu ' + res.status);
      const data = await res.json();
      if (!data.ok || !data.base64) throw new Error(data.error || 'resposta inválida do servidor');

      const blob = base64ToBlob(data.base64, XLSX_MIME);
      if (!blob.size) throw new Error('arquivo veio vazio');
      // Mostra uma tela com botões: o download/compartilhar acontece no TOQUE dela
      // (se fizermos aqui, direto, o Android bloqueia por não haver gesto do usuário).
      mostrarArquivoPronto(blob, data.filename || 'modelo_relatorios.xlsx', XLSX_MIME);
    } catch (e) {
      toast('Não consegui baixar o modelo: ' + e.message, 'err');
    } finally {
      const b = byId('imp-modelo');
      if (b) { b.disabled = false; b.textContent = '📥 Baixar modelo (XLSX)'; }
    }
  }

  // Tela "arquivo pronto": diz o nome/tamanho e dá as opções (com gesto do usuário).
  function mostrarArquivoPronto(blob, fname, mime) {
    const url = URL.createObjectURL(blob);
    const kb = Math.max(1, Math.round(blob.size / 1024));
    let podeCompartilhar = false;
    try {
      podeCompartilhar = !!(navigator.canShare &&
        navigator.canShare({ files: [new File([blob], fname, { type: mime })] }));
    } catch (e) {}

    openSheet(`
      <h2>Modelo pronto ✓</h2>
      <div class="file-ready">
        <span class="fr-ico">📄</span>
        <span class="fr-txt"><b>${esc(fname)}</b><small>${kb} KB · planilha XLSX</small></span>
      </div>
      <div class="actions">
        <button class="primary" id="fr-save" style="flex:1">⬇️ Salvar no celular</button>
        ${podeCompartilhar ? '<button class="secondary" id="fr-share">📤 Compartilhar</button>' : ''}
      </div>
      <div class="status-line" id="fr-status" style="margin-top:12px">
        Toque em <b>Salvar</b>: o arquivo vai para <b>Downloads</b> e o celular mostra uma
        notificação — é só tocar nela para abrir no Google Planilhas ou Excel.
      </div>
    `, () => {
      const st = byId('fr-status');
      byId('fr-save').onclick = () => {
        try {
          const a = document.createElement('a');
          a.href = url; a.download = fname;
          document.body.appendChild(a); a.click(); a.remove();
          st.innerHTML = '✅ Salvo em <b>Downloads</b> — toque na notificação do navegador para abrir.';
          st.style.color = '#1e9e57';
        } catch (e) {
          st.textContent = '✗ Não consegui salvar: ' + e.message;
          st.style.color = '#d10a11';
        }
      };
      if (byId('fr-share')) byId('fr-share').onclick = async () => {
        const file = new File([blob], fname, { type: mime });
        try {
          if (!navigator.share) throw new Error('navigator.share indisponível');
          await navigator.share({ files: [file], title: fname });
          st.textContent = '✅ Enviado.';
          st.style.color = '#1e9e57';
        } catch (e) {
          // AbortError = o usuário fechou o menu de compartilhar (não é erro de verdade)
          if (e && e.name === 'AbortError') {
            st.textContent = 'Compartilhamento cancelado.';
            st.style.color = '#6b7280';
            return;
          }
          // Qualquer outra falha → baixa o arquivo, para nunca ficar sem nada.
          st.innerHTML = 'Não deu para compartilhar (<b>' + esc(e && e.name ? e.name : 'erro') + ': ' +
            esc(e && e.message ? e.message : '?') + '</b>). Baixando o arquivo...';
          st.style.color = '#e08a00';
          try {
            const a = document.createElement('a');
            a.href = url; a.download = fname;
            document.body.appendChild(a); a.click(); a.remove();
            st.innerHTML += '<br>✅ Salvo em <b>Downloads</b> — toque na notificação para abrir.';
          } catch (e2) {
            st.innerHTML += '<br>✗ Também falhou ao baixar: ' + esc(e2.message);
            st.style.color = '#d10a11';
          }
        }
      };
    });
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  async function analisarPlanilha(commit) {
    const imp = state.imp;
    if (!imp.file && !imp.sheetUrl) { toast('Escolha um arquivo ou cole o link', 'err'); return; }
    if (!isOnline() || !sessionValid()) { toast('Conecte à internet', 'err'); return; }

    imp.busy = true; render();
    try {
      const body = { commit: !!commit, promotora: state.config.promotora, loja: state.config.loja };
      if (imp.file) {
        if (imp.file.size > 3 * 1024 * 1024) throw new Error('arquivo muito grande (máx. 3 MB)');
        body.fileBase64 = bufToBase64(await imp.file.arrayBuffer());
        body.filename = imp.fileName;
      } else {
        body.sheetUrl = imp.sheetUrl;
      }

      const res = await fetch(apiUrl('/api/import'), {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
      });
      if (res.status === 401) { refreshSession(); toast('Faça login novamente', 'err'); imp.busy = false; render(); return; }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'falha');

      imp.busy = false;
      if (commit) {
        await refreshFromCloud(true);
        state.view = 'list';
        render();
        toast(data.imported + ' relatório(s) importado(s) ✓', 'ok');
      } else {
        imp.preview = data;
        render();
      }
    } catch (e) {
      imp.busy = false;
      render();
      toast('Erro: ' + e.message, 'err');
    }
  }

  /* ---------- Agregações (painel / resumo) ---------- */
  function monthReports(monthKey) {
    return reportsForView().filter(r => monthKeyOf(r.data) === monthKey)
      .sort((a, b) => a.data.localeCompare(b.data));
  }
  function monthTotals(monthKey) {
    const rows = monthReports(monthKey);
    const t = {};
    // Soma só os valores informados. Se NINGUÉM informou o campo no mês, o total é N/A (null),
    // não 0 — o painel mostra "—".
    NUMERIC_KEYS.forEach(k => {
      let s = 0, any = false;
      rows.forEach(r => { if (informed(r[k])) { s += r[k]; any = true; } });
      t[k] = any ? s : null;
    });
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
        ${isBirthday() ? `<div class="bday-banner">🎉🎂 Feliz aniversário, ${esc((state.config.promotora || '').split(' ')[0] || 'promotora')}!<small>${ageToday() != null ? ageToday() + ' anos hoje — o' : 'O'} app não esqueceu de você 💛</small></div>` : ''}
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

        <button type="button" class="pdf-btn" id="btn-sheet-month">📗 Planilha do Google · ${MONTHS[m-1]} ${y}</button>

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
    // A planilha sai do mês que está no seletor acima — o mesmo mês cuja lista está na tela.
    byId('btn-sheet-month').onclick = () => generateSheet(monthKey);
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
    const bateuDia = informed(r.aprovadas) && r.aprovadas >= metaDiaVal();
    chips.push(`<span class="chip ${bateuDia ? 'ok' : 'neutral'}">✅ ${fmtNA(r.aprovadas)}${bateuDia ? ' 🎯' : ''}</span>`);
    chips.push(`<span class="chip no">❌ ${fmtNA(r.reprovadas)}</span>`);
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
    const feitas = t.aprovadas || 0;   // N/A conta como 0 na barra de meta
    const pct = meta > 0 ? Math.min(100, Math.round((feitas / meta) * 100)) : 0;
    const weeks = weeklyBreakdown(monthKey);
    const maxAp = Math.max(1, ...weeks.map(w => w.aprovadas));

    // Gráfico de pizza (donut) — propostas por situação (cores validadas). N/A entra como 0.
    const propSegs = [
      { label: 'Aprovadas', value: t.aprovadas || 0, color: '#0ca30c' },
      { label: 'Reprovadas', value: t.reprovadas || 0, color: '#d03b3b' },
      { label: 'Em Análise', value: t.analise || 0, color: '#c98500' },
      { label: 'Pendências', value: t.pendencias || 0, color: '#e0662f' },
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
        <div class="st-num">${fmtNA(t[f.key])}</div>
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
    pullTemplates().then(() => { if (state.view === 'msg') { selectFirstTemplate(); render(); } });
    pullContacts().then(() => { if (state.view === 'msg') render(); });
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
  // Flexão de gênero do contato: masculino → "o", feminino → "a", outro/sem info → "o(a)".
  // Ex.: "atendê-l{oa}" vira atendê-lo / atendê-la / atendê-lo(a).
  function oaDoContato() {
    const c = contatoAtual();
    const g = c && c.gender ? String(c.gender).toLowerCase() : '';
    if (g === 'masculino') return 'o';
    if (g === 'feminino') return 'a';
    return 'o(a)';
  }
  function applyPlaceholders(s) {
    const d = new Date();
    const hoje = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    const c = contatoAtual();
    return String(s || '')
      .replace(/{saudacao}/gi, saudacaoAgora())
      .replace(/{contato}/gi, c ? ((c.name || '').trim() || contatoLabel(c)) : '')
      .replace(/{oa}/gi, oaDoContato())
      .replace(/{hoje}/gi, hoje)
      .replace(/{promotora}/gi, state.config.promotora || '')
      .replace(/{loja}/gi, state.config.loja || '');
  }

  function renderMsg() {
    const cur = state.msg;
    const hojeFmt = (() => { const d = new Date(); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); })();
    const ct = contatoAtual();
    const phTable = `
      <div class="ph-table">
        <button type="button" class="ph-row" data-ph="{saudacao}"><code>{saudacao}</code><span>${saudacaoAgora()} <i>(muda com a hora)</i></span></button>
        <button type="button" class="ph-row" data-ph="{contato}"><code>{contato}</code><span>${ct ? esc(contatoLabel(ct)) : '<i>nome do contato escolhido</i>'}</span></button>
        <button type="button" class="ph-row" data-ph="{oa}"><code>{oa}</code><span>${esc(oaDoContato())} <i>— ex.: atendê-l{oa} → atendê-l${esc(oaDoContato())}</i></span></button>
        <button type="button" class="ph-row" data-ph="{hoje}"><code>{hoje}</code><span>${hojeFmt}</span></button>
        <button type="button" class="ph-row" data-ph="{promotora}"><code>{promotora}</code><span>${esc(state.config.promotora)}</span></button>
        <button type="button" class="ph-row" data-ph="{loja}"><code>{loja}</code><span>${esc(state.config.loja)}</span></button>
      </div>`;

    const contatoOpts = ['<option value="">— Sem contato (escolher no WhatsApp) —</option>']
      .concat(state.contacts.map(c =>
        `<option value="${c.id}" ${String(c.id) === String(state.contatoId) ? 'selected' : ''}>${esc(contatoLabel(c))}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`))
      .join('');

    const contatoBloco = `
      <div class="field">
        <label>Contato (opcional)</label>
        <select id="ct-sel">${contatoOpts}</select>
        <div class="ct-buttons">
          ${contactPickerDisponivel() ? '<button type="button" class="ct-btn" id="ct-agenda">📇 Da agenda</button>' : ''}
          <button type="button" class="ct-btn" id="ct-novo">➕ Novo contato</button>
          ${ct ? '<button type="button" class="ct-btn" id="ct-edit">✏️ Editar</button>' : ''}
        </div>
        ${ct && !ct.phone ? '<div class="hint-inline">⚠️ Este contato não tem telefone — o WhatsApp vai abrir para você escolher o destinatário.</div>' : ''}
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
        ${contatoBloco}
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
    byId('ct-sel').onchange = (e) => { state.contatoId = e.target.value || null; render(); };
    byId('ct-novo').onclick = () => openContatoSheet(null);
    if (byId('ct-edit')) byId('ct-edit').onclick = () => openContatoSheet(contatoAtual());
    if (byId('ct-agenda')) byId('ct-agenda').onclick = pegarDaAgenda;
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
    const c = contatoAtual();
    const tel = c ? phoneDigits(c.phone) : '';
    // Com telefone → abre a conversa direto. Sem telefone → WhatsApp pede o destinatário.
    window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(txt), '_blank');
  }

  /* ---------- Contatos: pegar da agenda + editor ---------- */
  async function pegarDaAgenda() {
    if (!contactPickerDisponivel()) { toast('Seu navegador não permite ler a agenda', 'err'); return; }
    try {
      const sel = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: false });
      if (!sel || !sel.length) return;
      const a = sel[0];
      openContatoSheet({
        id: null,
        name: (a.name && a.name[0]) || '',
        phone: (a.tel && a.tel[0]) || '',
        email: (a.email && a.email[0]) || '',
        gender: '',
      });
    } catch (e) {
      toast('Não foi possível abrir a agenda', 'err');
    }
  }

  function openContatoSheet(c) {
    const cur = c || { id: null, name: '', phone: '', email: '', gender: '' };
    const isNew = !cur.id;
    openSheet(`
      <h2>${isNew ? 'Novo contato' : 'Editar contato'}</h2>
      <div class="field">
        <label>Nome (opcional)</label>
        <input id="ct-name" type="text" value="${esc(cur.name || '')}" placeholder="Ex.: Maria Silva" />
      </div>
      <div class="field">
        <label>Telefone (opcional)</label>
        <input id="ct-phone" type="tel" inputmode="tel" value="${esc(cur.phone || '')}" placeholder="(19) 99999-9999" />
      </div>
      <div class="field">
        <label>E-mail (opcional)</label>
        <input id="ct-email" type="email" inputmode="email" value="${esc(cur.email || '')}" placeholder="maria@email.com" />
      </div>
      <div class="field">
        <label>Gênero (opcional)</label>
        <select id="ct-gender">
          <option value="" ${!cur.gender ? 'selected' : ''}>— Não informar —</option>
          <option value="feminino" ${cur.gender === 'feminino' ? 'selected' : ''}>Feminino</option>
          <option value="masculino" ${cur.gender === 'masculino' ? 'selected' : ''}>Masculino</option>
          <option value="outro" ${cur.gender === 'outro' ? 'selected' : ''}>Outro</option>
        </select>
      </div>
      <label class="check-row">
        <input type="checkbox" id="ct-agenda-save" />
        <span>Salvar também na agenda do celular
          <small>Gera o cartão de contato — o celular pergunta se quer adicionar.</small></span>
      </label>
      <div class="actions">
        ${!isNew ? '<button class="secondary" id="ct-del">🗑️ Excluir</button>' : ''}
        <button class="primary" id="ct-save" style="flex:1">Salvar contato</button>
      </div>
      <div class="status-line" id="ct-status"></div>
    `, () => {
      byId('ct-save').onclick = async () => {
        const dados = {
          id: cur.id || undefined,
          name: byId('ct-name').value.trim(),
          phone: byId('ct-phone').value.trim(),
          email: byId('ct-email').value.trim(),
          gender: byId('ct-gender').value,
        };
        if (!dados.name && !dados.phone && !dados.email) {
          byId('ct-status').textContent = 'Preencha ao menos nome, telefone ou e-mail.';
          byId('ct-status').style.color = '#d10a11';
          return;
        }
        const tambemAgenda = byId('ct-agenda-save').checked;
        if (!isOnline() || !sessionValid()) { toast('Conecte à internet para salvar', 'err'); return; }

        // Agenda PRIMEIRO, ainda dentro do gesto de toque (o Android exige isso).
        // Usa os dados do formulário — não precisa esperar o banco.
        if (tambemAgenda) salvarNaAgenda(dados);

        try {
          const res = await fetch(apiUrl('/api/contacts'), {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ contact: dados }),
          });
          if (res.status === 401) { refreshSession(); toast('Faça login novamente', 'err'); return; }
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || 'falha');
          await pullContacts();
          state.contatoId = data.contact.id;
          closeSheet();
          render();
          if (!tambemAgenda) toast('Contato salvo ✓', 'ok');
        } catch (e) { toast('Erro: ' + e.message, 'err'); }
      };
      if (byId('ct-del')) byId('ct-del').onclick = async () => {
        if (!window.confirm('Excluir o contato “' + contatoLabel(cur) + '”?')) return;
        if (!isOnline() || !sessionValid()) { toast('Conecte à internet para excluir', 'err'); return; }
        try {
          const res = await fetch(apiUrl('/api/contacts?id=' + encodeURIComponent(cur.id)), {
            method: 'DELETE', headers: authHeaders(),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || 'falha');
          await pullContacts();
          state.contatoId = null;
          closeSheet();
          render();
          toast('Contato excluído', 'ok');
        } catch (e) { toast('Erro: ' + e.message, 'err'); }
      };
    });
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
    // A new report starts with every field NOT INFORMED (N/A), not 0. Typing 0 is a
    // deliberate choice; leaving a field untouched keeps it N/A.
    NUMERIC_KEYS.forEach(k => r[k] = null);
    return r;
  }

  function renderForm() {
    const r = state.editing;
    const groupsHTML = GROUPS.map(g => `
      <div class="group">
        <h2><span>${g.emoji}</span> ${g.title}</h2>
        ${g.fields.map(f => counterHTML(f, r[f.key])).join('')}
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

  /* Botões rápidos: sempre 3 linhas COMPLETAS. Quantas colunas cabem depende da tela —
     no celular dão 5 (0-4 / 5-9 / 10-14); em telas maiores entram mais retângulos,
     mantendo a mesma largura mínima. */
  const QUICK_MIN_W = 58;   // largura mínima do retângulo em telas grandes (px)
  const QUICK_GAP = 7;      // gap da grade (px)
  const QUICK_ROWS = 3;
  const PHONE_MAX = 600;    // até aqui é "celular"
  function quickCols() {
    const appW = Math.min(window.innerWidth || 360, 640); // #app tem max-width 640
    // Celular: sempre 5 colunas → 0-4 / 5-9 / 10-14 (retângulos mais largos)
    if (appW < PHONE_MAX) return 5;
    // Telas maiores: cabe mais retângulo, mantendo a mesma largura mínima
    const inner = Math.max(240, appW - 58);               // paddings da tela + do card
    const cols = Math.floor((inner + QUICK_GAP) / (QUICK_MIN_W + QUICK_GAP));
    return Math.max(5, Math.min(10, cols));
  }

  function counterHTML(f, val) {
    const cols = quickCols();
    const maxN = cols * QUICK_ROWS - 1;   // ex.: 5 colunas → 0..14
    const na = !informed(val);            // N/A quando o valor não é um número
    const quick = [];
    for (let n = 0; n <= maxN; n++) {
      quick.push(`<button type="button" data-q="${f.key}" data-n="${n}" class="${val === n ? 'active' : ''}">${n}</button>`);
    }
    return `
      <div class="counter" id="counter-${f.key}">
        <div class="top">
          <div class="name"><span class="emoji">${f.emoji}</span> ${f.label}</div>
          <div class="stepper">
            <button type="button" class="minus" data-step="${f.key}" data-d="-1">−</button>
            <input class="val-input ${na ? 'na' : ''}" id="val-${f.key}" type="text"
              inputmode="numeric" pattern="[0-9]*" placeholder="—" aria-label="${f.label}"
              value="${informed(val) ? val : ''}" />
            <button type="button" class="plus" data-step="${f.key}" data-d="1">＋</button>
          </div>
        </div>
        <div class="quick" style="grid-template-columns: repeat(${cols}, 1fr)">${quick.join('')}</div>
        ${f.dailyMeta ? `<div class="daily-hint ${informed(val) && val >= metaDiaVal() ? 'hit' : ''}" id="dhint-${f.key}">${dailyHintText(val)}</div>` : ''}
      </div>`;
  }

  function dailyHintText(val) {
    const md = metaDiaVal();
    if (!informed(val)) return `🎯 Meta do dia: — / ${md}`;
    return val >= md ? `🎯 Meta do dia batida! (${val}/${md})` : `🎯 Meta do dia: ${val} / ${md}`;
  }

  function wireCounter(f, r) {
    const container = byId('counter-' + f.key);
    const input = byId('val-' + f.key);

    // Atualiza os destaques (botões rápidos, meta do dia) a partir do estado — sem mexer
    // no texto do input, para não atrapalhar o cursor enquanto a pessoa digita.
    function reflect() {
      const v = r[f.key];
      const na = !informed(v);
      input.classList.toggle('na', na);
      container.querySelectorAll('.quick button').forEach(b => {
        b.classList.toggle('active', !na && Number(b.getAttribute('data-n')) === v);
      });
      if (f.dailyMeta) {
        const dh = byId('dhint-' + f.key);
        if (dh) { dh.textContent = dailyHintText(v); dh.classList.toggle('hit', informed(v) && v >= metaDiaVal()); }
      }
    }
    // n === null => N/A; número => valor. Também escreve no input (botões e steppers usam).
    function set(n) {
      r[f.key] = (n === null) ? null : Math.max(0, n);
      input.value = (r[f.key] === null) ? '' : String(r[f.key]);
      reflect();
    }

    // Digitação livre: só dígitos; apagar tudo = N/A (null). Não reescreve o input aqui.
    input.oninput = () => {
      const digits = input.value.replace(/\D/g, '');
      if (digits !== input.value) input.value = digits;   // remove qualquer caractere não numérico
      r[f.key] = digits === '' ? null : parseInt(digits, 10);
      reflect();
    };

    container.querySelectorAll('.quick button').forEach(b => {
      b.onclick = () => {
        const n = Number(b.getAttribute('data-n'));
        // Tocar de novo no número já selecionado desmarca (volta para N/A).
        set(r[f.key] === n ? null : n);
        haptic();
      };
    });
    container.querySelectorAll('[data-step]').forEach(b => {
      b.onclick = () => {
        const d = Number(b.getAttribute('data-d'));
        const cur = r[f.key];
        // ＋ a partir de N/A começa em 0; − no 0 (ou em N/A) volta para N/A.
        if (!informed(cur)) set(d > 0 ? 0 : null);
        else set(cur + d < 0 ? null : cur + d);
        haptic();
      };
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
    NUMERIC_KEYS.forEach(k => r[k] = numOrNull(r[k]));   // preserva N/A (não força 0)

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
      ${ehAdmin() ? `<button class="menu-item" id="mi-docs">
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
      byId('mi-update').onclick = () => { closeSheet(); forcarAtualizacao(); };
      if (byId('mi-docs')) byId('mi-docs').onclick = () => {
        closeSheet();
        window.open(apiUrl('/docs?token=' + encodeURIComponent(state.session.token || '')), '_blank');
      };
      if (byId('mi-env')) byId('mi-env').onclick = () => {
        const destino = IS_STAGING ? 'prod' : 'staging';
        // Dizer em voz alta para onde se está indo. A confusão perigosa é achar que se
        // está no teste quando se está na produção — então o aviso nomeia o banco.
        const msg = destino === 'staging'
          ? 'Ir para o AMBIENTE DE TESTE?\n\nO app vai passar a usar o banco de teste (descartável). Seus dados de produção no aparelho ficam guardados e intactos.'
          : 'Voltar para a PRODUÇÃO?\n\nO app volta a usar o banco REAL da Edna. O que você criou no teste fica lá, separado.';
        if (confirm(msg)) trocarEnv(destino);
        else closeSheet();
      };
      byId('mi-share').onclick = () => { closeSheet(); shareToday(); };
      byId('mi-msg').onclick = () => { closeSheet(); openMsg(); };
      byId('mi-logout').onclick = () => { closeSheet(); logout(); };
      const st = byId('cfg-status');
      st.textContent = API_BASE ? '✓ Conectado ao servidor' : '⚠ Servidor não configurado';
    });
  }

  // Abre o WhatsApp do suporte já com uma mensagem inicial.
  const SUPORTE_WPP = '5519999974213'; // 55 (BR) + 19 99997-4213
  function openSuporteWhatsApp() {
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
      byId('c-suporte').onclick = () => openSuporteWhatsApp();

      // Header color picker (production only): primaries + spectrum grid + lightness + RGB.
      // corEscolhida always holds the last VALID color; Save uses it.
      let corEscolhida = corCabecalho();
      if (!IS_STAGING) {
        const msg = byId('cp-msg');
        let cur = hexToRgb(corEscolhida) || hexToRgb(DEFAULT_HEADER);
        const paint = () => {
          const hex = rgbToHex(cur.r, cur.g, cur.b);
          byId('cp-prev').style.background = hex;
          byId('cp-hex').textContent = hex.toUpperCase();
          byId('cp-r').value = Math.round(cur.r);
          byId('cp-g').value = Math.round(cur.g);
          byId('cp-b').value = Math.round(cur.b);
          document.querySelectorAll('#cp-grid .swatch, #cp-primaries .cp-dot').forEach((b) =>
            b.classList.toggle('sel', b.getAttribute('data-cor').toLowerCase() === hex.toLowerCase()));
          const erro = validarCorCabecalho(hex);
          if (erro) { msg.textContent = '⚠ ' + erro; msg.classList.add('warn'); }
          else { corEscolhida = hex; msg.textContent = 'Cor válida ✓'; msg.classList.remove('warn'); }
        };
        const syncSlider = () => { byId('cp-light').value = Math.round(rgbToHsl(cur.r, cur.g, cur.b).l); };
        const setHex = (hex) => { const rgb = hexToRgb(hex); if (rgb) { cur = rgb; paint(); syncSlider(); } };

        document.querySelectorAll('#cp-grid .swatch, #cp-primaries .cp-dot').forEach((b) => {
          b.onclick = () => setHex(b.getAttribute('data-cor'));
        });
        byId('cp-light').oninput = (e) => {
          const hsl = rgbToHsl(cur.r, cur.g, cur.b);
          cur = hslToRgb(hsl.h, hsl.s, Number(e.target.value)) || cur;
          paint();  // don't re-sync the slider while the user is dragging it
        };
        const onRgb = () => {
          const cl = (v) => Math.max(0, Math.min(255, Number(v) || 0));
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
        if (!IS_STAGING) state.config.headerColor = (corEscolhida === DEFAULT_HEADER) ? '' : corEscolhida;
        save(LS.config, state.config);
        saveSettingsRemote();          // salva no Neon (compartilhado)
        aplicarCorCabecalho();
        closeSheet();
        render();
        toast('Configurações salvas ✓', 'ok');
      };
    });
  }

  /* ---------------- Exportações ---------------- */
  // Abre a seleção de colunas antes de gerar a planilha. O mês vem de quem chamou.
  function generateSheet(month) {
    const alvo = month || state.month;
    const [y, m] = alvo.split('-').map(Number);
    const rows = monthReports(alvo);
    if (!rows.length) { toast('Nenhum relatório neste mês', 'err'); return; }

    // Uma coluna com pelo menos um valor informado no mês vem marcada; 100% N/A vem
    // desmarcada (auto-esconde). Mas dá para marcar/desmarcar qualquer uma.
    const temDado = (k) => rows.some(r => informed(r[k]));
    const linhas = ALL_FIELDS.map(f => `
      <label class="col-pick">
        <input type="checkbox" data-col="${f.key}" ${temDado(f.key) ? 'checked' : ''} />
        <span class="col-name">${f.emoji} ${f.label}</span>
        ${temDado(f.key) ? '' : '<span class="col-tag">sem dados</span>'}
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
      const inputs = () => Array.from(document.querySelectorAll('.col-list input[data-col]'));
      byId('col-all').onclick = () => inputs().forEach(i => { i.checked = true; });
      byId('col-def').onclick = () => inputs().forEach(i => { i.checked = temDado(i.getAttribute('data-col')); });
      byId('col-gerar').onclick = () => {
        const fields = inputs().filter(i => i.checked).map(i => i.getAttribute('data-col'));
        if (!fields.length) { toast('Escolha ao menos uma coluna', 'err'); return; }
        const fillZero = byId('col-fillzero').checked;
        closeSheet();
        doGenerateSheet(alvo, fields, fillZero);
      };
    });
  }

  // Chama a API já com a seleção de colunas e a opção de preencher vazios com 0.
  async function doGenerateSheet(month, fields, fillZero) {
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
    } catch (e) {
      toast('Erro ao gerar planilha: ' + e.message, 'err');
    }
  }

  function showSheetLink(url, copied, month) {
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
    txt += `👥 Clientes abordados: ${fmtNA(r.clientesAbordados)}\n\n`;
    txt += `*Propostas*\n✅ Aprovadas: ${fmtNA(r.aprovadas)}\n🟡 Pré-aprovado: ${fmtNA(r.preAprovado)}\n❌ Reprovadas: ${fmtNA(r.reprovadas)}\n🔍 Em análise: ${fmtNA(r.analise)}\n⏳ Pendências: ${fmtNA(r.pendencias)}\n\n`;
    txt += `🔗 Link: ${fmtNA(r.link)}\n`;
    txt += `💳 Cartão — 📦 Entregas: ${fmtNA(r.cartaoEntregas)} | 🕓 A receber: ${fmtNA(r.cartaoReceber)} | ✅ Ativação: ${fmtNA(r.cartaoAtivacao)}\n\n`;
    txt += `*Serviços*\n💬 SMS: ${fmtNA(r.sms)}\n🎁 Bônus: ${fmtNA(r.bonus)}\n📄 Fatura Digital: ${fmtNA(r.faturaDigital)}\n🦷 Odonto Plus: ${fmtNA(r.odontoPlus)}\n`;
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
    RED: [0.91, 0.45, 0.31], WHITE: [1, 1, 1], INK: [0.11, 0.11, 0.14],
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

    // Seções vêm dos GROUPS: qualquer campo novo entra sozinho. N/A aparece como "—".
    GROUPS.forEach(g => {
      section(g.title);
      g.fields.forEach(f => row(f.label, fmtNA(r[f.key])));
      y -= 6;
    });

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
    NUMERIC_KEYS.forEach(k => r[k] = numOrNull(r[k]));
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
    const pct = meta > 0 ? Math.round(((t.aprovadas || 0) / meta) * 100) : 0;
    const weeks = weeklyBreakdown(monthKey);
    const PIE = [
      { label: 'Aprovadas', value: t.aprovadas || 0, color: [0.047, 0.639, 0.047] },
      { label: 'Reprovadas', value: t.reprovadas || 0, color: [0.816, 0.231, 0.231] },
      { label: 'Em Análise', value: t.analise || 0, color: [0.788, 0.522, 0.000] },
      { label: 'Pendências', value: t.pendencias || 0, color: [0.878, 0.400, 0.184] },
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
      ALL_FIELDS.forEach(f => row(f.label, fmtNA(t[f.key])));
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
    try {
      const file = new File([blob], fname, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        // Se o share falhar (ex.: sem gesto do usuário) ou for cancelado → baixa o arquivo.
        navigator.share({ files: [file], title: fname })
          .catch(() => baixarArquivo(blob, fname));
        return;
      }
    } catch (e) { /* cai no download abaixo */ }
    baixarArquivo(blob, fname);
  }

  function baixarArquivo(blob, fname) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      toast('Salvo em Downloads: ' + fname, 'ok');
    } catch (e) {
      toast('Não foi possível salvar o arquivo', 'err');
    }
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
  // Display: "not informed" (null/undefined/'') shows as an em dash; a number shows as itself.
  function fmtNA(v) { return (v === null || v === undefined || v === '') ? '—' : v; }
  // Parse a value into a number, or null when it is empty / not informed.
  function numOrNull(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  // True when the field carries a real number (as opposed to N/A).
  function informed(v) { return typeof v === 'number' && Number.isFinite(v); }

  // Birth date is stored as 'YYYY-MM-DD'. It's a birthday when day/month match today.
  function isBirthday() {
    const dob = state.config.birthDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return false;
    const now = new Date();
    return dob.slice(5) === pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }
  // Age turned today (only meaningful when isBirthday()).
  function ageToday() {
    const dob = state.config.birthDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return null;
    return new Date().getFullYear() - Number(dob.slice(0, 4));
  }
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

  // Se a largura mudar (girar a tela), recalcula as colunas dos botões rápidos.
  let lastQuickCols = quickCols();
  window.addEventListener('resize', () => {
    const c = quickCols();
    if (c !== lastQuickCols) {
      lastQuickCols = c;
      if (state.view === 'form') render();
    }
  });
  // Ao reabrir/voltar para o app, atualiza sozinho (pega o que outra conta lançou).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(true); });

  async function postAuthInit() {
    await flushSettings();   // envia mudanças locais pendentes (merge no servidor)
    await pullSettings();    // baixa a config compartilhada
    pullTemplates();         // baixa os templates de mensagem
    pullContacts();          // baixa os contatos
    refreshFromCloud(true);
    flushQueue(true);
  }

  /* ---------------- Início ---------------- */
  function boot() {
    mostrarBannerTeste();   // faixa âmbar se estivermos no ambiente de teste
    aplicarCorCabecalho();  // cor do cabeçalho (produção) ou âmbar (teste)
    conferirAmbiente();     // e a API confirma (ou desmente) que ambiente é esse
    if (sessionValid()) { render(); postAuthInit(); }
    else { showLogin(); }
  }
  boot();
})();
