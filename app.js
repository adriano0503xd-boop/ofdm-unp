
'use strict';

// Configuracion publica. Nunca colocar tokens privados aqui.
const cfg = {
  supabaseUrl: 'https://kevmpcrsfpotltqpxnvd.supabase.co',
  publishableKey: 'sb_publishable_dWczetPbr7EdiW477R5v2g_gtbLt-KV',
  refreshMs: 5000,
  staleAfterMs: 30000,
  limit: 300
};

const $ = id => document.getElementById(id);

const configured = Boolean(cfg.supabaseUrl && cfg.publishableKey);

const root = String(cfg.supabaseUrl || '').replace(/\/$/, '');

const endpoint =
  `${root}/rest/v1/ofdm_measurements?` +
  `select=id,created_at,seq,valid_frames,invalid_frames,bit_errors,total_bits,evm,points,waveform,scenario` +
  `&order=id.desc&limit=${cfg.limit}`;

let records = [];
let awgnRecords = [];
let historyLoaded = false;
let historyRequesting = false;
let historyLastFetch = 0;
let historyTruncated = false;
let requesting = false;

const pageNames = {
  inicio: 'Inicio',
  arquitectura: 'Arquitectura',
  monitor: 'Monitor en vivo',
  resultados: 'Resultados',
  proyecto: 'Acerca del proyecto'
};

// NAVEGACION

function navigate() {
  const raw = (location.hash || '#inicio').slice(1);

  const page = document.querySelector(
    `.page[data-page="${raw}"]`
  ) ? raw : 'inicio';

  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  document.querySelectorAll('nav a').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  $('crumb').textContent = pageNames[page];

  drawAll();

  if (
    page === 'resultados' &&
    (!historyLoaded || Date.now() - historyLastFetch > 120000)
  ) {
    fetchHistory();
  }
}

window.addEventListener('hashchange', navigate);

// ESTADO

function setState(state, message) {
  $('notice').className = 'notice ' + state;
  $('notice').textContent = message;

  $('connect-badge').textContent =
    state === 'online'
      ? 'EN LÍNEA'
      : state === 'offline'
        ? 'SIN DATOS RECIENTES'
        : 'VERIFICANDO';

  $('connect-badge').className =
    'pill ' + (state === 'online' ? '' : 'offline');

  $('sidebar-mode').textContent =
    state === 'online'
      ? 'Mediciones sincronizadas'
      : 'Último registro disponible';

  $('side-light').classList.toggle('dim', state !== 'online');
}

// FUNCIONES AUXILIARES

function fixed(value, digits = 6) {
  return Number.isFinite(Number(value)) &&
         value !== null &&
         value !== ''
    ? Number(value).toFixed(digits)
    : '—';
}

function fmtInt(value) {
  return Number(value ?? 0).toLocaleString('es-PE');
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function measuredBER(item) {
  return safeNumber(item?.total_bits) > 0
    ? safeNumber(item.bit_errors) / Number(item.total_bits)
    : null;
}

function decodeScenario(text) {
  const s = String(text || 'SIN_ESCENARIO').toUpperCase();

  const m = s.match(
    /^(AWGN|MULTI|ISI)_(CSI|LS|NOEQ)_(\d+)DB$/
  );

  return {
    name: s,
    family: m ? m[1] : null,
    mode: m ? m[2] : null,
    ebn0: m ? Number(m[3]) : null
  };
}

// RENDERIZADO DEL MONITOR

function render() {
  const d = records[0];

  if (!d) {
    $('scenario').textContent = 'SIN MEDICIONES';
    $('ebn0').textContent = '—';

    $('records').innerHTML =
      '<tr><td colspan="8">No hay mediciones disponibles</td></tr>';

    drawAll();
    return;
  }

  const scenario = decodeScenario(d.scenario);

  $('seq').textContent = fmtInt(d.seq);
  $('valid').textContent = fmtInt(d.valid_frames);
  $('invalid').textContent = fmtInt(d.invalid_frames);

  $('ber').textContent =
    measuredBER(d) === null
      ? '—'
      : fixed(measuredBER(d));

  $('bits').textContent = fmtInt(d.total_bits);
  $('evm').textContent = fixed(d.evm, 2) + ' %';

  $('time').textContent =
    new Date(d.created_at).toLocaleTimeString('es-PE');

  $('scenario').textContent =
    scenario.name.replaceAll('_', ' · ');

  $('ebn0').textContent =
    scenario.ebn0 === null
      ? 'No aplica'
      : `${scenario.ebn0} dB`;

  $('qam-tag').textContent =
    Array.isArray(d.points) && d.points.length >= 16
      ? 'EN LÍNEA'
      : 'SIN DATOS';

  $('wave-tag').textContent =
    Array.isArray(d.waveform) && d.waveform.length > 1
      ? 'SEÑAL ACTUAL'
      : 'SIN DATOS';

  const tbody = $('records');
  tbody.replaceChildren();

  for (const item of records.slice(0, 35)) {
    const row = document.createElement('tr');

    const columns = [
      new Date(item.created_at)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19),

      item.scenario || '—',
      item.seq,
      item.valid_frames,
      item.invalid_frames,
      item.total_bits,

      measuredBER(item) === null
        ? '—'
        : fixed(measuredBER(item)),

      fixed(item.evm, 3)
    ];

    for (const value of columns) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.appendChild(cell);
    }

    tbody.appendChild(row);
  }

  drawAll();
}

// CONSULTA DEL MONITOR

async function fetchData() {
  if (!configured) {
    setState('offline', 'Falta la configuración pública de Supabase.');
    return;
  }

  if (requesting) return;
  requesting = true;

  try {
    const response = await fetch(endpoint, {
      headers: {
        'apikey': cfg.publishableKey
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw Error('Respuesta inesperada');
    }

    records = data;

    const newestTime = records.length
      ? Date.parse(records[0].created_at)
      : 0;

    const fresh =
      records.length > 0 &&
      Number.isFinite(newestTime) &&
      Math.abs(Date.now() - newestTime) <= cfg.staleAfterMs;

    setState(
      fresh ? 'online' : 'offline',
      !records.length
        ? 'Aún no hay mediciones almacenadas.'
        : fresh
          ? 'En línea · medición sincronizada'
          : 'Última medición guardada · sin actualizaciones recientes'
    );

    render();

  } catch (error) {
    setState(
      'offline',
      `No se pudo actualizar Supabase (${error.message}). Se conservan los últimos datos cargados.`
    );

  } finally {
    requesting = false;
  }
}

// BASE DE DIBUJO

function canvas(id) {
  const c = $(id);
  if (!c) return null;

  const ctx = c.getContext('2d');
  if (!ctx) return null;

  const w = c.width;
  const h = c.height;
  const x0 = 58;
  const y0 = 27;
  const pw = w - 84;
  const ph = h - 77;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#101e34';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#29465f';
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i++) {
    const x = x0 + pw * i / 4;
    const y = y0 + ph * i / 4;

    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + ph);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + pw, y);
    ctx.stroke();
  }

  return {ctx, w, h, x0, y0, pw, ph};
}

function placeholder(g, text) {
  if (!g) return;

  g.ctx.fillStyle = '#91b0cd';
  g.ctx.font = '15px system-ui';
  g.ctx.textAlign = 'center';
  g.ctx.fillText(text, g.w / 2, g.h / 2);
  g.ctx.textAlign = 'left';
}

// CONSTELACION RECIBIDA

function drawQAM() {
  const g = canvas('qam');
  if (!g) return;

  const p = records[0]?.points;

  if (!Array.isArray(p) || p.length < 2) {
    placeholder(g, 'Esperando puntos I/Q');
    return;
  }

  const {ctx} = g;
  const norm = Math.sqrt(10);
  const scale = 1.65;

  ctx.strokeStyle = '#4e7391';
  ctx.beginPath();

  ctx.moveTo(g.x0 + g.pw / 2, g.y0);
  ctx.lineTo(g.x0 + g.pw / 2, g.y0 + g.ph);

  ctx.moveTo(g.x0, g.y0 + g.ph / 2);
  ctx.lineTo(g.x0 + g.pw, g.y0 + g.ph / 2);

  ctx.stroke();

  for (const i of [-3, -1, 1, 3]) {
    for (const q of [-3, -1, 1, 3]) {
      const x =
        g.x0 + g.pw * (i / norm + scale) / (2 * scale);

      const y =
        g.y0 + g.ph * (scale - q / norm) / (2 * scale);

      ctx.strokeStyle = '#45677f';
      ctx.strokeRect(x - 5, y - 5, 10, 10);
    }
  }

  for (const pt of p) {
    if (!Array.isArray(pt) || pt.length < 2) continue;

    const i = Number(pt[0]);
    const q = Number(pt[1]);

    if (!Number.isFinite(i) || !Number.isFinite(q)) continue;

    const x =
      g.x0 + g.pw * (i + scale) / (2 * scale);

    const y =
      g.y0 + g.ph * (scale - q) / (2 * scale);

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);

    ctx.fillStyle = '#36d2ee';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#36d2ee';
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// FORMA DE ONDA

function drawWave() {
  const g = canvas('wave');
  if (!g) return;

  const p = records[0]?.waveform;

  if (!Array.isArray(p) || p.length < 2) {
    placeholder(g, 'Esperando muestras OFDM');
    return;
  }

  const {ctx} = g;

  const abs = Math.max(
    .001,
    ...p.map(v => Math.abs(safeNumber(v)))
  );

  ctx.beginPath();

  p.forEach((value, i) => {
    const x = g.x0 + g.pw * i / (p.length - 1);

    const y =
      g.y0 + g.ph * (.5 - .44 * safeNumber(value) / abs);

    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });

  ctx.strokeStyle = '#38d7f2';
  ctx.lineWidth = 2.4;
  ctx.stroke();
}

// HISTORIAL DE BER

function drawHistory() {
  const g = canvas('history');
  if (!g) return;

  const a = records.slice().reverse();
  const vals = a.map(measuredBER);

  if (vals.length < 2) {
    placeholder(g, 'Aún no hay suficientes mediciones');
    return;
  }

  const max = Math.max(
    .001,
    ...vals.filter(v => v !== null)
  );

  const {ctx} = g;

  ctx.beginPath();

  vals.forEach((v, i) => {
    const x = g.x0 + g.pw * i / (vals.length - 1);

    const y =
      g.y0 + g.ph * (1 - (v || 0) / max);

    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#36d2ee';
  ctx.stroke();

  ctx.fillStyle = '#aac7dc';
  ctx.font = '13px system-ui';

  ctx.fillText(
    'BER máx. ' + max.toFixed(4),
    g.x0,
    g.y0 - 9
  );
}

// HISTORIAL AWGN INDEPENDIENTE

async function fetchHistory(force = false) {
  if (!configured || historyRequesting) return;

  if (
    !force &&
    historyLoaded &&
    Date.now() - historyLastFetch < 120000
  ) {
    return;
  }

  historyRequesting = true;

  const status = $('results-data-status');

  if (status) {
    status.className = 'results-status';
    status.textContent = 'Consultando mediciones AWGN históricas...';
  }

  try {
    const collected = [];
    const limit = 1000;
    const maxPages = 12;

    historyTruncated = false;

    for (let page = 0; page < maxPages; page++) {
      const url =
        `${root}/rest/v1/ofdm_measurements?` +
        `select=id,created_at,scenario,total_bits,bit_errors,evm` +
        `&scenario=like.AWGN*` +
        `&order=id.desc` +
        `&limit=${limit}` +
        `&offset=${page * limit}`;

      const response = await fetch(url, {
        headers: {
          'apikey': cfg.publishableKey
        },
        cache: 'no-store'
      });

      if (!response.ok) {
        throw Error(`HTTP ${response.status}`);
      }

      const batch = await response.json();

      if (!Array.isArray(batch)) {
        throw Error('Formato de datos no válido');
      }

      collected.push(...batch);

      if (batch.length < limit) break;

      if (page === maxPages - 1) {
        historyTruncated = true;
      }
    }

    awgnRecords = collected;
    historyLoaded = true;
    historyLastFetch = Date.now();

    const entries = awgnSeries();

    if (status) {
      status.className =
        'results-status ' + (entries.length ? 'good' : 'warn');

      status.textContent = entries.length
        ? `${entries.length} escenarios AWGN encontrados · ${collected.length.toLocaleString('es-PE')} registros analizados${historyTruncated ? ' · Historial parcial (límite de consulta)' : ''}`
        : 'No hay mediciones AWGN registradas todavía; el historial reciente sigue disponible.';
    }

    drawAll();

  } catch (error) {
    if (status) {
      status.className = 'results-status warn';
      status.textContent =
        `No se pudo consultar el historial AWGN: ${error.message}. Reintenta con Actualizar.`;
    }

    drawAll();

  } finally {
    historyRequesting = false;
  }
}

// SELECCION DEL REGISTRO MAS COMPLETO

function awgnSeries() {
  const buckets = new Map();

  for (const r of awgnRecords) {
    const s = decodeScenario(r.scenario);

    if (
      s.family !== 'AWGN' ||
      !['CSI', 'LS'].includes(s.mode) ||
      s.ebn0 === null ||
      measuredBER(r) === null
    ) {
      continue;
    }

    const key = `${s.mode}-${s.ebn0}`;
    const prev = buckets.get(key);

    if (
      !prev ||
      Number(r.total_bits) > Number(prev.total_bits)
    ) {
      buckets.set(key, {
        ...r,
        mode: s.mode,
        ebn0: s.ebn0
      });
    }
  }

  return [...buckets.values()].sort(
    (a, b) =>
      a.ebn0 - b.ebn0 ||
      a.mode.localeCompare(b.mode)
  );
}

// BER TEORICA APROXIMADA

function erfcApprox(x) {
  const t = 1 / (1 + .3275911 * x);

  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t)
      + 1.421413741) * t - .284496736) * t
      + .254829592) * t *
    Math.exp(-x * x);

  return 1 - y;
}

function berTheory(db) {
  return .375 * erfcApprox(
    Math.sqrt(.4 * Math.pow(10, db / 10))
  );
}

// MENSAJE COMPACTO SI FALTAN DATOS

function chartEmpty(canvasId, emptyId, message, empty) {
  const c = $(canvasId);
  const e = $(emptyId);

  if (c) c.classList.toggle('is-hidden', empty);

  if (e) {
    e.hidden = !empty;
    if (message) e.textContent = message;
  }
}

// CURVAS BER Y EVM

function drawSeries(id, isBER) {
  const data = awgnSeries();

  const xs = [...new Set(data.map(x => x.ebn0))]
    .sort((a, b) => a - b);

  const emptyId = isBER ? 'ber-empty' : 'evm-empty';

  const missing = xs.length === 0;

  chartEmpty(
    id,
    emptyId,
    historyRequesting
      ? 'Consultando el historial AWGN...'
      : 'Aún no hay registros AWGN disponibles para esta gráfica.',
    missing
  );

  if (missing) return;

  const g = canvas(id);
  if (!g) return;

  const ctx = g.ctx;
  const minX = xs.length === 1 ? xs[0] - 1 : xs[0];
  const maxX = xs.length === 1 ? xs[0] + 1 : xs[xs.length - 1];

  const values = data.map(
    d => isBER ? measuredBER(d) : safeNumber(d.evm)
  );

  const positive = values.filter(v => v > 0);

  // BER=0 no se puede representar en un eje logaritmico.
  const floor = isBER ? 1e-6 : 0;

  const maxY = isBER
    ? Math.max(.25, ...positive, berTheory(minX))
    : Math.max(10, ...values) * 1.12;

  const xPos = v =>
    g.x0 + g.pw * (v - minX) / (maxX - minX);

  const norm = v => isBER
    ? (
        Math.log10(Math.max(v, floor)) -
        Math.log10(floor)
      ) / (
        Math.log10(maxY) -
        Math.log10(floor)
      )
    : v / maxY;

  const yPos = v =>
    g.y0 + g.ph *
    (1 - Math.max(0, Math.min(1, norm(v))));

  ctx.fillStyle = '#a6c9e0';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'left';

  ctx.fillText(
    isBER ? 'BER (log)' : 'EVM (%)',
    g.x0,
    g.y0 - 11
  );

  ctx.fillText(
    'Eb/N0 (dB)',
    g.x0 + g.pw - 82,
    g.y0 + g.ph + 39
  );

  const labels = xs.length <= 8
    ? xs
    : xs.filter((_, i) => i % 2 === 0);

  for (const x of labels) {
    ctx.textAlign = 'center';

    ctx.fillText(
      String(x),
      xPos(x),
      g.y0 + g.ph + 19
    );
  }

  ctx.textAlign = 'right';

  for (let k = 0; k <= 4; k++) {
    const ratio = k / 4;

    const v = isBER
      ? Math.pow(
          10,
          Math.log10(maxY) +
          (Math.log10(floor) - Math.log10(maxY)) * ratio
        )
      : maxY * (1 - ratio);

    ctx.fillText(
      isBER ? v.toExponential(0) : v.toFixed(0),
      g.x0 - 9,
      g.y0 + g.ph * ratio + 4
    );
  }

  ctx.textAlign = 'left';

  function drawPoints(pts, color, dashed = false, drawDots = true) {
    if (!pts.length) return;

    ctx.beginPath();

    pts.forEach((p, i) => {
      const x = xPos(p.x);
      const y = yPos(p.y);

      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });

    ctx.strokeStyle = color;
    ctx.lineWidth = dashed ? 1.7 : 3;
    ctx.setLineDash(dashed ? [6, 6] : []);

    if (pts.length > 1) ctx.stroke();

    ctx.setLineDash([]);

    if (drawDots) {
      for (const p of pts) {
        ctx.beginPath();

        ctx.arc(
          xPos(p.x),
          yPos(p.y),
          4.5,
          0,
          Math.PI * 2
        );

        ctx.fillStyle = color;
        ctx.fill();
      }
    }
  }

  if (isBER) {
    const count = Math.max(
      2,
      (maxX - minX) * 8 + 1
    );

    const theory = Array.from(
      {length: count},
      (_, i) => {
        const x =
          minX + (maxX - minX) * i / (count - 1);

        return {
          x,
          y: berTheory(x)
        };
      }
    );

    drawPoints(
      theory,
      '#94b0c5',
      true,
      false
    );
  }

  for (const [mode, color] of [
    ['CSI', '#36d2ee'],
    ['LS', '#bb9aff']
  ]) {
    const pts = data
      .filter(d => d.mode === mode)
      .map(d => ({
        x: d.ebn0,
        y: isBER
          ? measuredBER(d)
          : safeNumber(d.evm)
      }));

    drawPoints(pts, color);
  }
}

// INTERPRETACION Y CONTADORES

function drawResultsSummary() {
  const el = $('results-summary');

  const data = awgnSeries();
  const levels = new Set(data.map(d => d.ebn0));

  if ($('awgn-count')) {
    $('awgn-count').textContent =
      data.length ? String(data.length) : '0';
  }

  if ($('ebn0-count')) {
    $('ebn0-count').textContent = String(levels.size);
  }

  if ($('tested-count')) {
    $('tested-count').textContent = fmtInt(
      data.reduce(
        (sum, d) => sum + safeNumber(d.total_bits),
        0
      )
    );
  }

  if (!el) return;

  if (!data.length) {
    el.textContent =
      'Todavía no se encontraron escenarios AWGN en la base consultada. El historial reciente permanece visible y las curvas aparecerán cuando se publiquen mediciones.';
    return;
  }

  const csi = data.filter(d => d.mode === 'CSI');
  const ls = data.filter(d => d.mode === 'LS');

  const shared = csi
    .map(d => d.ebn0)
    .filter(db => ls.some(d => d.ebn0 === db))
    .sort((a, b) => a - b);

  if (!shared.length) {
    el.textContent =
      `Hay ${data.length} escenarios AWGN medidos en ${levels.size} niveles de Eb/N0. Para contrastar CSI y LS/ZF directamente, ambos modos deben tener mediciones con el mismo Eb/N0.`;
    return;
  }

  const db = shared[shared.length - 1];
  const a = csi.find(d => d.ebn0 === db);
  const b = ls.find(d => d.ebn0 === db);

  const ba = measuredBER(a);
  const bb = measuredBER(b);

  const observation =
    bb > ba
      ? 'La estimación LS/ZF presentó una BER mayor que la CSI perfecta en ese nivel.'
      : bb < ba
        ? 'La BER medida con LS/ZF fue menor en ese registro; comprueba la dispersión estadística.'
        : 'Las dos BER coincidieron en ese nivel.';

  el.textContent =
    `A ${db} dB, BER con CSI perfecta: ${fixed(ba)}; ` +
    `con LS/ZF: ${fixed(bb)}. ${observation} ` +
    'Comparación de mediciones digitales, no de la capa física Wi-Fi.';
}

// TABLA DE BITS EVALUADOS

function renderScenarioBits() {
  const tbody = $('scenario-bits-body');
  if (!tbody) return;

  tbody.replaceChildren();

  const data = awgnSeries();
  const count = $('bits-scenario-count');

  if (count) {
    count.textContent = data.length
      ? `${data.length} mediciones seleccionadas`
      : 'Sin mediciones';
  }

  if (!data.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');

    td.colSpan = 7;
    td.textContent = historyRequesting
      ? 'Consultando datos AWGN...'
      : 'Aún no hay mediciones AWGN para comparar.';

    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const d of data) {
    const tr = document.createElement('tr');

    const vals = [
      `${d.ebn0} dB`,
      d.mode === 'CSI'
        ? 'CSI perfecta'
        : 'Estimación LS / ZF',

      safeNumber(d.total_bits) / 768,
      fmtInt(d.total_bits),
      fmtInt(d.bit_errors),
      fixed(measuredBER(d)),
      fixed(d.evm, 2)
    ];

    vals.forEach((value, i) => {
      const td = document.createElement('td');
      td.textContent = String(value);

      if (i === 1) {
        td.className =
          `method ${d.mode.toLowerCase()}`;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  }
}

// EXPORTACION PNG

function exportChart(canvasId, title) {
  const source = $(canvasId);
  if (!source) return;

  if (
    source.classList.contains('is-hidden') ||
    (
      (canvasId === 'ber-compare' ||
       canvasId === 'evm-compare') &&
      !awgnSeries().length
    )
  ) {
    alert('No hay mediciones suficientes para exportar este gráfico.');
    return;
  }

  if (canvasId === 'history' && records.length < 2) {
    alert('Aún no hay historial suficiente para exportar.');
    return;
  }

  const pad = 36;
  const header = 104;
  const extra = canvasId === 'history' ? 0 : 46;

  const exportCanvas = document.createElement('canvas');

  exportCanvas.width =
    source.width + pad * 2;

  exportCanvas.height =
    source.height + header + pad + extra;

  const ctx = exportCanvas.getContext('2d');

  ctx.fillStyle = '#101f35';
  ctx.fillRect(
    0, 0,
    exportCanvas.width,
    exportCanvas.height
  );

  ctx.fillStyle = '#edf6ff';
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText(title, pad, 47);

  ctx.font = '15px Arial, sans-serif';
  ctx.fillStyle = '#a9c8e1';

  ctx.fillText(
    'Trabajo final · Teoría de Comunicaciones II · UNP',
    pad,
    77
  );

  ctx.drawImage(
    source,
    pad,
    header,
    source.width,
    source.height
  );

  if (extra) {
    const y = header + source.height + 25;

    const labels = [
      [0, 'CSI perfecta', '#36d2ee'],
      [1, 'LS / ZF', '#bb9aff'],
      [2, '16-QAM teórica aprox. (solo BER)', '#94b0c5']
    ];

    for (const [i, label, color] of labels) {
      if (canvasId === 'evm-compare' && i === 2) continue;

      const x = pad + i * 265;

      ctx.fillStyle = color;
      ctx.fillRect(x, y - 8, 23, 4);

      ctx.fillStyle = '#d7e8f5';
      ctx.font = '14px Arial, sans-serif';
      ctx.fillText(label, x + 32, y);
    }
  }

  exportCanvas.toBlob(blob => {
    if (!blob) {
      alert('No se pudo generar el PNG.');
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download =
      `OFDM_UNP_${canvasId.replaceAll('-', '_')}.png`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      3000
    );
  }, 'image/png');
}

// ACTUALIZAR TODOS LOS GRAFICOS

function drawAll() {
  drawQAM();
  drawWave();
  drawHistory();

  drawSeries('ber-compare', true);
  drawSeries('evm-compare', false);

  drawResultsSummary();
  renderScenarioBits();
}

// EXPORTACION CSV

function csv() {
  const all = [
    ...new Map(
      [...awgnRecords, ...records].map(
        r => [String(r.id), r]
      )
    ).values()
  ].sort((a, b) => Number(b.id) - Number(a.id));

  if (!all.length) {
    alert('No hay registros para exportar.');
    return;
  }

  const header = [
    'fecha_utc',
    'trama',
    'validas',
    'invalidas',
    'bits_evaluados',
    'bits_erroneos',
    'ber',
    'evm_porcentaje',
    'escenario'
  ];

  const rows = all.map(r =>
    [
      r.created_at,
      r.seq,
      r.valid_frames,
      r.invalid_frames,
      r.total_bits,
      r.bit_errors,
      measuredBER(r) ?? '',
      r.evm,
      r.scenario || ''
    ]
    .map(x =>
      '"' +
      String(x ?? '').replaceAll('"', '""') +
      '"'
    )
    .join(',')
  );

  const blob = new Blob(
    [[header.join(','), ...rows].join('\r\n')],
    {type: 'text/csv;charset=utf-8'}
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'OFDM_UNP_mediciones.csv';
  link.click();

  setTimeout(
    () => URL.revokeObjectURL(url),
    1500
  );
}

// CONSTELACION DE PORTADA

function createHomeConstellation() {
  const el = $('home-points');
  if (!el) return;

  for (const x of [12.5, 37.5, 62.5, 87.5]) {
    for (const y of [12.5, 37.5, 62.5, 87.5]) {
      const point = document.createElement('span');

      point.className = 'home-point';
      point.style.left = x + '%';
      point.style.top = y + '%';

      el.appendChild(point);
    }
  }
}

// INICIALIZACION

$('refresh').addEventListener('click', () => {
  fetchData();
  fetchHistory(true);
});

$('csv').addEventListener('click', csv);

document.querySelectorAll('.chart-export').forEach(button => {
  button.addEventListener('click', () => {
    exportChart(
      button.dataset.export,
      button.dataset.title || 'Resultado OFDM'
    );
  });
});

createHomeConstellation();
navigate();

if (configured) {
  fetchData();
  fetchHistory();
} else {
  setState('offline', 'Sin configuración de Supabase.');
}

setInterval(
  fetchData,
  Math.max(4000, cfg.refreshMs || 5000)
);

setInterval(
  () => fetchHistory(),
  120000
);
