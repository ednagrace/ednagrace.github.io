/**
 * Relatório Diário — Backend (Google Apps Script)
 * Promotora Edna Grace / Loja Savegnago
 *
 * O QUE FAZ:
 *  - Recebe os relatórios do app (PWA) e grava numa planilha Google Sheets.
 *  - Faz "upsert": se já existe relatório da mesma DATA + PROMOTORA, atualiza a linha;
 *    senão, cria uma nova. Assim não duplica se salvar o dia duas vezes.
 *  - Devolve a lista de relatórios para o app montar a tela de listagem/filtros.
 *
 * COMO PUBLICAR: veja o README.md (passo a passo em português).
 */

// Segredo simples para evitar gravações aleatórias de fora.
// Troque por qualquer texto e coloque o MESMO valor nas Configurações do app.
var TOKEN = 'edna-savegnago-2026';

// Nome da aba (worksheet) onde os dados ficam.
var SHEET_NAME = 'Relatorios';

// Ordem das colunas na planilha. NÃO reordene depois de começar a usar.
var COLUMNS = [
  'timestamp',       // quando foi gravado (ISO)
  'data',            // data do relatório (YYYY-MM-DD)
  'promotora',
  'loja',
  'metaMes',         // meta do mês (número)
  'aprovadas',
  'reprovadas',
  'analise',
  'pendencias',
  'link',
  'cartaoEntregas',
  'cartaoReceber',
  'sms',
  'bonus',
  'faturaDigital',
  'odontoPlus',
  'obs'
];

// Campos numéricos (para somar/validar).
var NUMERIC = ['metaMes','aprovadas','reprovadas','analise','pendencias','link',
  'cartaoEntregas','cartaoReceber','sms','bonus','faturaDigital','odontoPlus'];

/* ------------------------------------------------------------------ */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(COLUMNS);
    sh.setFrozenRows(1);
  }
  // Garante o cabeçalho na primeira execução.
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLUMNS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** GET: devolve todos os relatórios (o app filtra por mês no celular). */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (params.token && params.token !== TOKEN) {
      return json_({ ok: false, error: 'token inválido' });
    }
    var sh = getSheet_();
    var last = sh.getLastRow();
    if (last < 2) return json_({ ok: true, reports: [] });

    var values = sh.getRange(2, 1, last - 1, COLUMNS.length).getValues();
    var reports = values.map(function (row) {
      var obj = {};
      COLUMNS.forEach(function (col, i) {
        var v = row[i];
        if (col === 'data' && v instanceof Date) v = fmtDate_(v);
        if (NUMERIC.indexOf(col) !== -1) v = Number(v) || 0;
        obj[col] = v;
      });
      return obj;
    }).filter(function (r) { return r.data; });

    return json_({ ok: true, reports: reports });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** POST: cria ou atualiza um relatório (upsert por data + promotora). */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse(e.postData.contents || '{}');

    if (body.token !== TOKEN) {
      return json_({ ok: false, error: 'token inválido' });
    }
    var r = body.report || {};
    if (!r.data) return json_({ ok: false, error: 'data obrigatória' });

    var sh = getSheet_();
    var last = sh.getLastRow();

    // Procura linha existente (mesma data + promotora).
    var rowIndex = -1;
    if (last >= 2) {
      var dataCol = sh.getRange(2, 2, last - 1, 1).getValues(); // coluna 'data'
      var promCol = sh.getRange(2, 3, last - 1, 1).getValues(); // coluna 'promotora'
      for (var i = 0; i < dataCol.length; i++) {
        var d = dataCol[i][0];
        if (d instanceof Date) d = fmtDate_(d);
        if (String(d) === String(r.data) &&
            String(promCol[i][0]) === String(r.promotora || '')) {
          rowIndex = i + 2;
          break;
        }
      }
    }

    var rowValues = COLUMNS.map(function (col) {
      if (col === 'timestamp') return new Date().toISOString();
      if (NUMERIC.indexOf(col) !== -1) return Number(r[col]) || 0;
      return r[col] != null ? r[col] : '';
    });

    if (rowIndex === -1) {
      sh.appendRow(rowValues);
    } else {
      sh.getRange(rowIndex, 1, 1, COLUMNS.length).setValues([rowValues]);
    }

    return json_({ ok: true, updated: rowIndex !== -1 });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function fmtDate_(d) {
  var y = d.getFullYear();
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  var day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}
