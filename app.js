
'use strict';

// Configuracion publica para GitHub Pages.
// NUNCA colocar secretos aqui.
const cfg = {
  supabaseUrl: 'https://kevmpcrsfpotltqpxnvd.supabase.co',
  publishableKey: 'sb_publishable_dWczetPbr7EdiW477R5v2g_gtbLt-KV',
  refreshMs: 5000,
  staleAfterMs: 30000,
  limit: 300
};

const $ = id => document.getElementById(id);

const configured = Boolean(
  cfg.supabaseUrl && cfg.publishableKey
);

const root = String(cfg.supabaseUrl || '')
  .replace(/\/$/, '');

const endpoint =
  `${root}/rest/v1/ofdm_measurements` +
  `?select=id,created_at,seq,valid_frames,invalid_frames,bit_errors,total_bits,evm,points,waveform,scenario` +
  `&order=id.desc&limit=${cfg.limit}`;

let records = [];
let requesting = false;

const pageNames = {
  inicio: 'Inicio',
  arquitectura: 'Arquitectura',
  monitor: 'Monitor en vivo',
  resultados: 'Resultados',
  proyecto: 'Acerca del proyecto'
};

// ==========================================
// NAVEGACION
// ==========================================

function navigate() {
  const raw = (location.hash || '#inicio').slice(1);

  const page = document.querySelector(
    `.page[data-page="${raw}"]`
  ) ? raw : 'inicio';

  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle(
      'active',
      el.dataset.page === page
    );
  });

  document.querySelectorAll('nav a').forEach(el => {
    el.classList.toggle(
      'active',
      el.dataset.page === page
    );
  });

  $('crumb').textContent = pageNames[page];

  drawAll();
}

window.addEventListener('hashchange', navigate);

// ==========================================
// ESTADO DE CONEXION
// ==========================================

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
    'pill ' + (
      state === 'online' ? '' : 'offline'
    );

  $('sidebar-mode').textContent =
    state === 'online'
      ? 'Mediciones sincronizadas'
      : 'Último registro disponible';

  $('side-light').classList.toggle(
    'dim',
    state !== 'online'
  );
}

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================

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
    ? safeNumber(item.bit_errors) /
      Number(item.total_bits)
    : null;
}

// Escenarios como:
// AWGN_CSI_04DB
// AWGN_LS_06DB
// MULTI_LS_20DB
function decodeScenario(text) {
  const s = String(text || 'SIN_ESCENARIO')
    .toUpperCase();

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

// ==========================================
// MOSTRAR MEDICIONES
// ==========================================

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

  $('evm').textContent =
    fixed(d.evm, 2) + ' %';

  $('time').textContent =
    new Date(d.created_at)
      .toLocaleTimeString('es-PE');

  $('scenario').textContent =
    scenario.name.replaceAll('_', ' · ');

  $('ebn0').textContent =
    scenario.ebn0 === null
      ? 'No aplica'
      : `${scenario.ebn0} dB`;

  $('qam-tag').textContent =
    Array.isArray(d.points) &&
    d.points.length >= 16
      ? 'EN LÍNEA'
      : 'SIN DATOS';

  $('wave-tag').textContent =
    Array.isArray(d.waveform) &&
    d.waveform.length > 1
      ? 'SEÑAL ACTUAL'
      : 'SIN DATOS';

  // Tabla sin inyectar HTML desde Supabase.
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

// ==========================================
// CONSULTAR SUPABASE
// ==========================================

async function fetchData() {
  if (!configured) {
    setState(
      'offline',
      'Falta la configuración pública de Supabase.'
    );
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
      Math.abs(Date.now() - newestTime) <=
        cfg.staleAfterMs;

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

// ==========================================
// BASE PARA DIBUJAR GRAFICOS
// ==========================================

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

  return {
    ctx,
    w,
    h,
    x0,
    y0,
    pw,
    ph
  };
}

function placeholder(g, text) {
  if (!g) return;

  g.ctx.fillStyle = '#91b0cd';
  g.ctx.font = '15px system-ui';
  g.ctx.textAlign = 'center';

  g.ctx.fillText(
    text,
    g.w / 2,
    g.h / 2
  );

  g.ctx.textAlign = 'left';
}

// ==========================================
// CONSTELACION 16-QAM RECIBIDA
// ==========================================

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

  ctx.moveTo(
    g.x0 + g.pw / 2,
    g.y0
  );

  ctx.lineTo(
    g.x0 + g.pw / 2,
    g.y0 + g.ph
  );

  ctx.moveTo(
    g.x0,
    g.y0 + g.ph / 2
  );

  ctx.lineTo(
    g.x0 + g.pw,
    g.y0 + g.ph / 2
  );

  ctx.stroke();

  // Los 16 puntos ideales
  for (const i of [-3, -1, 1, 3]) {
    for (const q of [-3, -1, 1, 3]) {
      const x = g.x0 +
        g.pw * (i / norm + scale) / (2 * scale);

      const y = g.y0 +
        g.ph * (scale - q / norm) / (2 * scale);

      ctx.strokeStyle = '#45677f';
      ctx.strokeRect(x - 5, y - 5, 10, 10);
    }
  }

  // Los puntos recibidos
  for (const pt of p) {
    if (!Array.isArray(pt) || pt.length < 2) {
      continue;
    }

    const i = Number(pt[0]);
    const q = Number(pt[1]);

    if (!Number.isFinite(i) ||
        !Number.isFinite(q)) {
      continue;
    }

    const x = g.x0 +
      g.pw * (i + scale) / (2 * scale);

    const y = g.y0 +
      g.ph * (scale - q) / (2 * scale);

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);

    ctx.fillStyle = '#36d2ee';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#36d2ee';

    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// ==========================================
// FORMA DE ONDA OFDM
// ==========================================

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
    const x = g.x0 +
      g.pw * i / (p.length - 1);

    const y = g.y0 +
      g.ph * (
        .5 - .44 * safeNumber(value) / abs
      );

    if (i) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
    }
  });

  ctx.strokeStyle = '#38d7f2';
  ctx.lineWidth = 2.4;
  ctx.stroke();
}

// ==========================================
// HISTORIAL BER
// ==========================================

function drawHistory() {
  const g = canvas('history');

  if (!g) return;

  const a = records.slice().reverse();
  const vals = a.map(measuredBER);

  if (vals.length < 2) {
    placeholder(
      g,
      'Aún no hay suficientes mediciones'
    );
    return;
  }

  const max = Math.max(
    .001,
    ...vals.filter(v => v !== null)
  );

  const {ctx} = g;

  ctx.beginPath();

  vals.forEach((v, i) => {
    const x = g.x0 +
      g.pw * i / (vals.length - 1);

    const y = g.y0 +
      g.ph * (1 - (v || 0) / max);

    if (i) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
    }
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

// ==========================================
// AGRUPAR RESULTADOS AWGN
// ==========================================

// Selecciona la medicion con más bits
// para cada combinacion de modo y Eb/N0.
function awgnSeries() {
  const buckets = new Map();

  for (const r of records) {
    const s = decodeScenario(r.scenario);

    if (
      s.family !== 'AWGN' ||
      !['CSI', 'LS'].includes(s.mode) ||
      s.ebn0 === null ||
      measuredBER(r) === null
    ) {
      continue;
    }

    const key = s.mode + '-' + s.ebn0;
    const previous = buckets.get(key);

    if (
      !previous ||
      Number(r.total_bits) >
        Number(previous.total_bits)
    ) {
      buckets.set(key, {
        ...r,
        mode: s.mode,
        ebn0: s.ebn0
      });
    }
  }

  return [...buckets.values()];
}

// ==========================================
// BER TEORICA APROXIMADA 16-QAM
// ==========================================

function erfcApprox(x) {
  const t = 1 / (1 + .3275911 * x);

  const y = 1 -
    (((((1.061405429 * t - 1.453152027) * t)
      + 1.421413741) * t - .284496736) * t
      + .254829592) * t *
      Math.exp(-x * x);

  return 1 - y;
}

function berTheory(db) {
  return .375 * erfcApprox(
    Math.sqrt(
      .4 * Math.pow(10, db / 10)
    )
  );
}

// ==========================================
// GRAFICAS BER / EVM VS EB/N0
// ==========================================

function drawSeries(id, yField, isBER) {
  const g = canvas(id);

  if (!g) return;

  const data = awgnSeries();

  if (!data.length) {
    placeholder(
      g,
      'Sin mediciones AWGN suficientes en el historial'
    );
    return;
  }

  const xs = [
    ...new Set(data.map(x => x.ebn0))
  ].sort((a, b) => a - b);

  if (xs.length < 2) {
    placeholder(
      g,
      'Se requieren al menos dos valores de Eb/N0'
    );
    return;
  }

  const minX = xs[0];
  const maxX = xs[xs.length - 1];

  const values = data.map(d =>
    isBER
      ? measuredBER(d)
      : safeNumber(d.evm)
  );

  const positives = values.filter(v => v > 0);

  const minY = isBER
    ? Math.min(
        .00001,
        ...positives,
        berTheory(maxX)
      )
    : 0;

  const maxY = isBER
    ? Math.max(
        .2,
        ...positives,
        berTheory(minX)
      )
    : Math.max(10, ...values) * 1.12;

  const yTransform = value =>
    isBER
      ? (
          Math.log10(Math.max(value, minY)) -
          Math.log10(minY)
        ) / (
          Math.log10(maxY) -
          Math.log10(minY)
        )
      : value / maxY;

  const xPos = value =>
    g.x0 +
    g.pw * (value - minX) / (maxX - minX);

  const yPos = value =>
    g.y0 +
    g.ph * (1 - yTransform(value));

  const {ctx} = g;

  ctx.fillStyle = '#b0cbe0';
  ctx.font = '13px system-ui';

  ctx.fillText(
    isBER
      ? 'BER (escala log)'
      : 'EVM (%)',
    g.x0,
    g.y0 - 8
  );

  ctx.fillText(
    'Eb/N0 (dB)',
    g.x0 + g.pw - 83,
    g.y0 + g.ph + 38
  );

  for (const x of xs) {
    ctx.fillText(
      String(x),
      xPos(x) - 5,
      g.y0 + g.ph + 19
    );
  }

  for (let k = 0; k <= 4; k++) {
    const ratio = k / 4;

    const v = isBER
      ? Math.pow(
          10,
          Math.log10(maxY) +
          (Math.log10(minY) - Math.log10(maxY)) *
          ratio
        )
      : maxY * (1 - ratio);

    ctx.fillText(
      isBER
        ? v.toExponential(0)
        : v.toFixed(0),
      5,
      g.y0 + g.ph * ratio + 4
    );
  }

  const lines = [
    {mode: 'CSI', color: '#36d2ee'},
    {mode: 'LS', color: '#bb9aff'}
  ];

  for (const line of lines) {
    const pts = data
      .filter(d => d.mode === line.mode)
      .sort((a, b) => a.ebn0 - b.ebn0);

    if (!pts.length) continue;

    ctx.beginPath();

    pts.forEach((p, i) => {
      const x = xPos(p.ebn0);

      const y = yPos(
        isBER
          ? measuredBER(p)
          : safeNumber(p.evm)
      );

      if (i) {
        ctx.lineTo(x, y);
      } else {
        ctx.moveTo(x, y);
      }
    });

    ctx.strokeStyle = line.color;
    ctx.lineWidth = 3;
    ctx.stroke();

    for (const p of pts) {
      ctx.beginPath();

      ctx.arc(
        xPos(p.ebn0),
        yPos(
          isBER
            ? measuredBER(p)
            : safeNumber(p.evm)
        ),
        4.5,
        0,
        7
      );

      ctx.fillStyle = line.color;
      ctx.fill();
    }
  }

  // Curva teorica solo para BER
  if (isBER) {
    ctx.beginPath();

    xs.forEach((x, i) => {
      const y = yPos(berTheory(x));

      if (i) {
        ctx.lineTo(xPos(x), y);
      } else {
        ctx.moveTo(xPos(x), y);
      }
    });

    ctx.strokeStyle = '#9ab4c8';
    ctx.lineWidth = 1.7;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ==========================================
// INTERPRETACION DE RESULTADOS
// ==========================================

function drawResultsSummary() {
  const el = $('results-summary');

  if (!el) return;

  const data = awgnSeries();

  const csi = data.filter(
    d => d.mode === 'CSI'
  );

  const ls = data.filter(
    d => d.mode === 'LS'
  );

  if (!data.length) {
    el.textContent =
      'Todavía no hay registros AWGN suficientes en el historial consultado.';
    return;
  }

  const shared = csi
    .map(d => d.ebn0)
    .filter(db =>
      ls.some(d => d.ebn0 === db)
    );

  if (shared.length) {
    const ordered = shared.sort((a, b) => a - b);
    const db = ordered[ordered.length - 1];

    const a = csi.find(d => d.ebn0 === db);
    const b = ls.find(d => d.ebn0 === db);

    el.textContent =
      `A ${db} dB: BER con CSI perfecta = ` +
      `${fixed(measuredBER(a))}; ` +
      `BER con estimación LS/ZF = ` +
      `${fixed(measuredBER(b))}. ` +
      `La comparación utiliza registros disponibles para ese Eb/N0.`;

  } else {
    el.textContent =
      `Hay ${data.length} combinaciones AWGN disponibles. ` +
      `Se necesitan escenarios CSI y LS con el mismo Eb/N0 ` +
      `para compararlos directamente.`;
  }
}

// ==========================================
// ACTUALIZAR TODOS LOS GRAFICOS
// ==========================================

function drawAll() {
  drawQAM();
  drawWave();
  drawHistory();

  drawSeries(
    'ber-compare',
    'ber',
    true
  );

  drawSeries(
    'evm-compare',
    'evm',
    false
  );

  drawResultsSummary();
}

// ==========================================
// EXPORTAR CSV
// ==========================================

function csv() {
  if (!records.length) {
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

  const rows = records.map(r => [
    r.created_at,
    r.seq,
    r.valid_frames,
    r.invalid_frames,
    r.total_bits,
    r.bit_errors,
    measuredBER(r) ?? '',
    r.evm,
    r.scenario || ''
  ].map(x =>
    '"' +
    String(x ?? '').replaceAll('"', '""') +
    '"'
  ).join(','));

  const blob = new Blob(
    [[header.join(','), ...rows].join('\r\n')],
    {type: 'text/csv;charset=utf-8'}
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'OFDM_UNP_mediciones.csv';
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ==========================================
// CONSTELACION IDEAL DE LA PORTADA
// ==========================================

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

// ==========================================
// INICIALIZACION
// ==========================================

$('refresh').addEventListener('click', fetchData);
$('csv').addEventListener('click', csv);

createHomeConstellation();
navigate();

if (configured) {
  fetchData();
} else {
  setState(
    'offline',
    'Sin configuración de Supabase.'
  );
}

setInterval(
  fetchData,
  Math.max(4000, cfg.refreshMs || 5000)
);
