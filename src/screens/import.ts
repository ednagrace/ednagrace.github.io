import { XLSX_MIME } from '../constants.js';
import { state, sessionValid } from '../state.js';
import { app, render } from '../render.js';
import { esc, byId } from '../format.js';
import { isOnline, authHeaders, refreshFromCloud } from '../api.js';
import { apiUrl } from '../env.js';
import { refreshSession } from '../auth.js';
import { toast, openSheet, copyToClipboard } from '../ui.js';

/* ---------------- SCREEN: IMPORT SPREADSHEET ---------------- */
export function openImport() {
  state.imp = { file: null, fileName: '', sheetUrl: '', preview: null, busy: false };
  state.view = 'import';
  render();
  window.scrollTo(0, 0);
}

export function renderImport() {
  const imp = state.imp || {};
  const p = imp.preview;

  const previewHTML = !p ? '' : `
    <div class="imp-preview">
      <div class="imp-nums">
        <div><b>${p.total}</b><span>relatórios</span></div>
        <div class="ok"><b>${p.novos}</b><span>novos</span></div>
        <div class="warn"><b>${p.substituidos}</b><span>substituem</span></div>
        <div class="err"><b>${(p.errors || []).length}</b><span>erros</span></div>
      </div>
      ${p.substituidos ? `<div class="hint-inline">⚠️ ${p.substituidos} dia(s) já existem e serão <b>substituídos</b> pelos dados da planilha.</div>` : ''}
      ${(p.errors || []).length ? `<div class="imp-errors">${p.errors.slice(0, 8).map((e: any) =>
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
      ${previewHTML}
    </div>`;

  byId('btn-back').onclick = () => { state.view = 'list'; render(); };
  byId('imp-modelo').onclick = downloadTemplateFile;
  byId('imp-gsheet').onclick = createGoogleSheet;
  byId('imp-input').onchange = (e: Event) => {
    const f = (e.target as HTMLInputElement).files && (e.target as HTMLInputElement).files![0];
    if (!f) return;
    state.imp.file = f;
    state.imp.fileName = f.name;
    state.imp.preview = null;
    render();
  };
  byId('imp-url').oninput = (e: Event) => { state.imp.sheetUrl = (e.target as HTMLInputElement).value.trim(); };
  byId('imp-analisar').onclick = () => analyzeSpreadsheet(false);
  if (byId('imp-commit')) byId('imp-commit').onclick = () => analyzeSpreadsheet(true);
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(bin);
}
function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Creates a new editable spreadsheet in Google Drive (right format, ready to fill in).
// Sharing a LINK is always allowed by Chrome — unlike .xlsx files, which it refuses
// under Web Share (the famous NotAllowedError).
async function createGoogleSheet() {
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

    state.imp.sheetUrl = data.url;   // already ready for "Analyze"
    const copied = await copyToClipboard(data.url);
    showSheetCreated(data.url, data.name || 'Planilha', copied);
  } catch (e: any) {
    toast('Erro: ' + e.message, 'err');
  } finally {
    const b = byId('imp-gsheet');
    if (b) { b.disabled = false; b.textContent = '📗 Criar planilha no Google (editável)'; }
  }
}

function showSheetCreated(url: string, nome: string, copied: boolean) {
  openSheet(`
    <h2>Planilha criada ✓</h2>
    <div class="file-ready">
      <span class="fr-ico">📗</span>
      <span class="fr-txt"><b>${esc(nome)}</b><small>no Drive, pasta “Edna App” · editável</small></span>
    </div>
    <p class="status-line" style="margin:-6px 0 12px">
      ${copied ? '🔗 Link copiado para a área de transferência.' : 'Use os botões abaixo.'}
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
        if ((navigator as any).share) {
          // Sharing TEXT/URL — always allowed (the block is only for files)
          await (navigator as any).share({ title: nome, text: 'Planilha para preencher:', url });
          st.textContent = '✅ Enviado.';
          st.style.color = '#1e9e57';
        } else {
          const ok = await copyToClipboard(url);
          st.textContent = ok ? '🔗 Link copiado.' : 'Não consegui copiar o link.';
          st.style.color = ok ? '#1e9e57' : '#d10a11';
        }
      } catch (e: any) {
        if (e && e.name === 'AbortError') { st.textContent = 'Compartilhamento cancelado.'; st.style.color = '#6b7280'; return; }
        const ok = await copyToClipboard(url);
        st.textContent = ok ? '🔗 Link copiado (compartilhar falhou).' : 'Falhou: ' + (e.message || '?');
        st.style.color = ok ? '#e08a00' : '#d10a11';
      }
    };
  });
}

async function downloadTemplateFile() {
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
    // Shows a screen with buttons: the download/share happens on the TAP
    // (doing it here, directly, gets blocked by Android for lacking a user gesture).
    showFileReady(blob, data.filename || 'modelo_relatorios.xlsx', XLSX_MIME);
  } catch (e: any) {
    toast('Não consegui baixar o modelo: ' + e.message, 'err');
  } finally {
    const b = byId('imp-modelo');
    if (b) { b.disabled = false; b.textContent = '📥 Baixar modelo (XLSX)'; }
  }
}

// "File ready" screen: shows name/size and the options (with a user gesture).
function showFileReady(blob: Blob, fname: string, mime: string) {
  const url = URL.createObjectURL(blob);
  const kb = Math.max(1, Math.round(blob.size / 1024));
  let canShare = false;
  try {
    canShare = !!((navigator as any).canShare &&
      (navigator as any).canShare({ files: [new File([blob], fname, { type: mime })] }));
  } catch (e) {}

  openSheet(`
    <h2>Modelo pronto ✓</h2>
    <div class="file-ready">
      <span class="fr-ico">📄</span>
      <span class="fr-txt"><b>${esc(fname)}</b><small>${kb} KB · planilha XLSX</small></span>
    </div>
    <div class="actions">
      <button class="primary" id="fr-save" style="flex:1">⬇️ Salvar no celular</button>
      ${canShare ? '<button class="secondary" id="fr-share">📤 Compartilhar</button>' : ''}
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
      } catch (e: any) {
        st.textContent = '✗ Não consegui salvar: ' + e.message;
        st.style.color = '#d10a11';
      }
    };
    if (byId('fr-share')) byId('fr-share').onclick = async () => {
      const file = new File([blob], fname, { type: mime });
      try {
        if (!(navigator as any).share) throw new Error('navigator.share indisponível');
        await (navigator as any).share({ files: [file], title: fname });
        st.textContent = '✅ Enviado.';
        st.style.color = '#1e9e57';
      } catch (e: any) {
        // AbortError = the user closed the share sheet (not a real error)
        if (e && e.name === 'AbortError') {
          st.textContent = 'Compartilhamento cancelado.';
          st.style.color = '#6b7280';
          return;
        }
        // Any other failure → download the file, so it's never left empty-handed.
        st.innerHTML = 'Não deu para compartilhar (<b>' + esc(e && e.name ? e.name : 'erro') + ': ' +
          esc(e && e.message ? e.message : '?') + '</b>). Baixando o arquivo...';
        st.style.color = '#e08a00';
        try {
          const a = document.createElement('a');
          a.href = url; a.download = fname;
          document.body.appendChild(a); a.click(); a.remove();
          st.innerHTML += '<br>✅ Salvo em <b>Downloads</b> — toque na notificação para abrir.';
        } catch (e2: any) {
          st.innerHTML += '<br>✗ Também falhou ao baixar: ' + esc(e2.message);
          st.style.color = '#d10a11';
        }
      }
    };
  });
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

async function analyzeSpreadsheet(commit: boolean) {
  const imp = state.imp;
  if (!imp.file && !imp.sheetUrl) { toast('Escolha um arquivo ou cole o link', 'err'); return; }
  if (!isOnline() || !sessionValid()) { toast('Conecte à internet', 'err'); return; }

  imp.busy = true; render();
  try {
    const body: any = { commit: !!commit, promotora: state.config.promotora, loja: state.config.loja };
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
  } catch (e: any) {
    imp.busy = false;
    render();
    toast('Erro: ' + e.message, 'err');
  }
}
