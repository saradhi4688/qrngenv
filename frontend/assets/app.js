// frontend-v2.0-sync.js
// Sync'ed to backend v2.0-alpha: supports /generate, /health, /export/json, /export/csv
const API_BASE_URL = 'https://qrngenvbackend.onrender.com'; // <-- change if needed (no trailing slash)

let distributionChart = null;
let lastResponse = null;

const MAX_SAMPLES = 5000;
const MAX_BITS = 16;
const BUCKET_THRESHOLD_BITS = 12;

const el = (id) => document.getElementById(id);

// Small toast utility
function showToast(msg, type = 'info', ms = 3000) {
  const t = document.createElement('div');
  t.className = `toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ---------------- Backend calls ----------------
async function generateRandomNumbers(numBits, numSamples) {
  const payload = { num_bits: parseInt(numBits, 10), num_samples: parseInt(numSamples, 10) };
  const res = await fetch(`${API_BASE_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Server ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchHealth() {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) throw new Error(`Health check failed ${res.status}`);
  return res.json();
}

async function fetchExportJson() {
  const res = await fetch(`${API_BASE_URL}/export/json`);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Export JSON failed ${res.status}: ${txt}`);
  }
  return res.blob();
}

async function fetchExportCsv() {
  const res = await fetch(`${API_BASE_URL}/export/csv`);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Export CSV failed ${res.status}: ${txt}`);
  }
  return res.blob();
}

// ---------------- Formatting & UI ----------------
function formatNumber(number, numBits) {
  const n = Number(number);
  const maxValue = Math.pow(2, numBits) - 1;
  const width = maxValue.toString().length;
  return String(n).padStart(width, '0');
}

/* Replace your existing updateStatistics, updateMeta and the generation success handling
   with the code below. This is defensive and logs the raw response. */

function updateStatistics(statsCandidate = {}) {
  // Accept multiple shapes: data.statistics, data.stats, or a top-level statsCandidate
  const s = statsCandidate || {};
  // If the API put statistics under "statistics" or "stats" or nested in meta, handle all:
  const statsObj = s.statistics ?? s.stats ?? s;

  const mean = Number(statsObj.mean ?? statsObj?.mean ?? 0);
  const std  = Number(statsObj.std  ?? statsObj?.std  ?? 0);
  const min  = statsObj.min  ?? statsObj?.min ?? 0;
  const max  = statsObj.max  ?? statsObj?.max ?? 0;

  if (el('meanValue')) el('meanValue').textContent = Number.isFinite(mean) ? mean.toFixed(2) : '—';
  if (el('stdValue'))  el('stdValue').textContent  = Number.isFinite(std)  ? std.toFixed(2)  : '—';
  if (el('minValue'))  el('minValue').textContent  = (min !== undefined && min !== null) ? String(min) : '—';
  if (el('maxValue'))  el('maxValue').textContent  = (max !== undefined && max !== null) ? String(max) : '—';
}

function updateMetaFromResponse(data = {}) {
  // data may have meta fields at top-level or inside data.meta
  const meta = data.meta ?? {};
  // top-level fallbacks
  const versionVal = data.version ?? meta.version ?? null;
  const timestampVal = data.timestamp ?? meta.timestamp ?? null;
  const sourceVal = data.source ?? meta.source ?? null;
  const entropyVal = data.entropy ?? meta.entropy ?? data.stats?.entropy ?? data.statistics?.entropy ?? null;

  if (el('metaVersion')) el('metaVersion').textContent = versionVal ? String(versionVal) : '—';
  if (el('metaTime')) el('metaTime').textContent = timestampVal ? String(timestampVal) : '—';
  if (el('entropyValue')) el('entropyValue').textContent = (entropyVal !== null && entropyVal !== undefined) ? Number(entropyVal).toFixed ? Number(entropyVal).toFixed(4) : String(entropyVal) : '—';
  if (sourceVal) updateSourceIndicator(sourceVal);
}

/* In your generate handler, after you get "data" from the backend,
   replace the existing "success" part with this block.
   It logs the raw response and calls the robust updaters above. */

try {
  showSkeletons();
  const data = await generateRandomNumbers(bits, samples);

  // ALWAYS log the raw response for debugging
  console.log('QRNG /generate response:', data);

  if (data.status !== 'success') {
    // If backend responds with an error shape
    throw new Error(data.message || JSON.stringify(data));
  }

  // Save for exports / copy
  lastResponse = data;

  // stats can be in data.stats or data.statistics; pass through both possibilities
  const statsCandidate = data.stats ?? data.statistics ?? data;

  // Update stats display robustly
  updateStatistics(statsCandidate);

  // Update meta fields (entropy, version, timestamp, source)
  updateMetaFromResponse(data);

  // Render table and chart
  renderTable(data.numbers || [], bits);
  renderDistributionGraph(data.numbers || [], bits);

  // Optional: show toast
  showToast(`Generated ${data.num_samples ?? (data.numbers?.length ?? 'N/A')} samples (${data.source ?? 'unknown'})`, 'success', 1500);

} catch (err) {
  console.error(err);
  showToast(err.message || 'Generation failed', 'error', 3500);
  const resultDisplay = el('resultDisplay');
  if (resultDisplay) {
    resultDisplay.innerHTML = `<div class="text-center py-8 text-red-300">${err.message || 'Generation failed'}</div>`;
  }
} finally {
  genBtn.disabled = false;
  genBtn.innerHTML = oldHtml;
}


function updateMeta(meta = {}) {
  if (el('metaVersion') && meta.version) el('metaVersion').textContent = String(meta.version);
  if (el('metaTime') && meta.timestamp) el('metaTime').textContent = String(meta.timestamp);
  if (el('sourceIndicator') && meta.source) updateSourceIndicator(meta.source);
}

function updateSourceIndicator(source) {
  const indicator = el('sourceIndicator');
  if (!indicator) return;
  indicator.textContent = source === 'ANU' ? 'ANU Quantum Source' : 'Qiskit Simulator';
  indicator.className = `source-badge ${source === 'ANU' ? 'source-anu' : 'source-simulator'} transition-opacity duration-300`;
  indicator.style.opacity = '1';
}

// ---------------- Charting ----------------
function renderDistributionGraph(numbers = [], numBits) {
  const canvas = el('distributionChart');
  if (!canvas) return;

  const bits = parseInt(numBits, 10);
  if (isNaN(bits) || bits < 1) return;

  const nums = numbers.map(x => Number(x)).filter(x => Number.isFinite(x));
  const maxValue = (1 << bits) - 1;
  let labels = [], counts = [];

  if (bits <= BUCKET_THRESHOLD_BITS && maxValue <= 4096) {
    counts = new Array(maxValue + 1).fill(0);
    nums.forEach(n => { if (n >= 0 && n <= maxValue) counts[n]++; });
    labels = counts.map((_, i) => String(i));
  } else {
    const BUCKETS = 256;
    counts = new Array(BUCKETS).fill(0);
    nums.forEach(n => {
      if (n < 0 || n > maxValue || !Number.isFinite(n)) return;
      const idx = Math.floor((n / maxValue) * (BUCKETS - 1));
      counts[Math.max(0, Math.min(BUCKETS - 1, idx))]++;
    });
    labels = counts.map((_, i) => {
      const from = Math.round((i / BUCKETS) * maxValue);
      const to = Math.round(((i + 1) / BUCKETS) * maxValue);
      return `${from}–${to}`;
    });
  }

  try { if (distributionChart) distributionChart.destroy(); } catch (e) { console.warn(e); }
  const ctx = canvas.getContext('2d');
  distributionChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Frequency', data: counts }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 20 } } },
      plugins: { legend: { display: false }, tooltip: {} },
      animation: { duration: 600 }
    }
  });
}

// ---------------- Table ----------------
function renderTable(numbers = [], numBits) {
  const container = el('resultDisplay') || el('tableBody');
  if (!container) return;

  // If using 'resultDisplay' (div) show cards; if 'tableBody' show rows
  if (container.id === 'resultDisplay') {
    const wrapper = document.createElement('div');
    wrapper.className = 'space-y-2';
    numbers.forEach((n, i) => {
      const row = document.createElement('div');
      row.className = 'text-sm font-mono bg-gray-800/30 px-3 py-2 rounded-lg hover:bg-gray-800/50 transition-colors flex justify-between';
      const decimal = String(n);
      const binary = Number(n).toString(2).padStart(parseInt(numBits, 10), '0');
      row.innerHTML = `<span class="text-gray-400">${i+1}.</span><span class="text-blue-300">${decimal}</span><span class="text-green-300">${binary}</span>`;
      wrapper.appendChild(row);
    });
    container.innerHTML = '';
    container.appendChild(wrapper);
    return;
  }

  // otherwise we assume a <tbody id="tableBody">
  const tbody = container;
  tbody.innerHTML = '';
  numbers.forEach((n, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="border px-2 py-1">${i+1}</td><td class="border px-2 py-1">${n}</td>`;
    tbody.appendChild(tr);
  });
}

// ---------------- Downloads & Clipboard ----------------
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function initDownloadJson() {
  const btn = el('downloadJson');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      const blob = await fetchExportJson();
      downloadBlob(blob, 'qrng_export.json');
      showToast('JSON downloaded', 'success');
    } catch (e) {
      console.error(e);
      showToast(e.message || 'Failed to download JSON', 'error');
    }
  });
}

function initDownloadCsv() {
  const btn = el('downloadCsv');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      const blob = await fetchExportCsv();
      downloadBlob(blob, 'qrng_export.csv');
      showToast('CSV downloaded', 'success');
    } catch (e) {
      console.error(e);
      showToast(e.message || 'Failed to download CSV', 'error');
    }
  });
}

function initCopyBtn() {
  const copyBtn = el('copyBtn');
  if (!copyBtn) return;
  copyBtn.addEventListener('click', async () => {
    if (!lastResponse?.numbers || !lastResponse.numbers.length) {
      showToast('No results to copy', 'error');
      return;
    }
    try {
      const bits = parseInt(el('numBits')?.value || '8', 10);
      const text = lastResponse.numbers.map(n => formatNumber(Number(n), bits)).join('\n');
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard', 'success');
    } catch (e) {
      console.error(e);
      showToast('Copy failed', 'error');
    }
  });
}

// ---------------- Health / Ping ----------------
function initPingBtn() {
  const btn = el('pingBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      const info = await fetchHealth();
      showToast(`Server OK — ANU: ${info.anu ? 'UP' : 'DOWN'}`, 'success', 2500);
    } catch (e) {
      console.error(e);
      showToast('Server not reachable', 'error', 2500);
    }
  });
}

// ---------------- Theme & Accent ----------------
function initThemeToggle() {
  const tbtn = el('themeToggle') || el('darkToggle');
  if (!tbtn) return;
  tbtn.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
  });
}

function initAccentPicker() {
  const picker = el('accentPicker');
  if (!picker) return;
  picker.addEventListener('change', (ev) => {
    const color = ev.target.value;
    // replace classes on known elements (safe, minimal)
    document.querySelectorAll('.text-blue-300, .text-green-300, .text-purple-300').forEach(node => {
      node.classList.remove('text-blue-300','text-green-300','text-purple-300');
      node.classList.add(`text-${color}-300`);
    });
  });
}

// ---------------- Generate handler (with skeleton) ----------------
function showSkeletons() {
  const rd = el('resultDisplay');
  if (rd) rd.innerHTML = '<div class="skeleton" style="height:120px;border-radius:8px"></div>';
  const canvas = el('distributionChart');
  if (canvas) {
    // draw light grey overlay until chart is ready
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
  }
}

function initGenerateHandler() {
  const genBtn = el('generateBtn');
  if (!genBtn) return;

  genBtn.addEventListener('click', async () => {
    const numBitsEl = el('numBits');
    const numSamplesEl = el('numSamples');
    if (!numBitsEl || !numSamplesEl) return showToast('Missing inputs', 'error');

    let bits = parseInt(numBitsEl.value, 10);
    let samples = parseInt(numSamplesEl.value, 10);

    if (isNaN(bits) || isNaN(samples)) return showToast('Enter valid numbers', 'error');
    if (bits < 1) bits = 1;
    if (bits > MAX_BITS) return showToast(`numBits max ${MAX_BITS}`, 'error');
    if (samples < 1 || samples > MAX_SAMPLES) return showToast(`samples 1..${MAX_SAMPLES}`, 'error');

    genBtn.disabled = true;
    const origHtml = genBtn.innerHTML;
    genBtn.innerHTML = '<span class="flex items-center"><svg class="animate-spin mr-2 h-4 w-4" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity="0.25"/></svg> Quantum Processing...</span>';

    try {
      // show skeletons while waiting
      showSkeletons();

      const data = await generateRandomNumbers(bits, samples);
      if (data.status !== 'success') throw new Error(data.message || 'Generation error');

      lastResponse = data;

      // Backend v2.0 returns meta fields in top-level: stats OR statistics; entropy; timestamp; version
      const stats = data.stats ?? data.statistics ?? data;
      updateStatistics(stats);
      updateMeta({ version: data.version ?? data.meta?.version, timestamp: data.timestamp ?? data.meta?.timestamp, source: data.source ?? data.meta?.source });

      // render table and chart
      renderTable(data.numbers || [], bits);
      renderDistributionGraph(data.numbers || [], bits);

      // show entropy if returned separately
      if (el('entropyValue')) {
        const e = data.entropy ?? data.meta?.entropy ?? stats.entropy ?? null;
        el('entropyValue').textContent = e != null ? Number(e).toFixed(4) : '—';
      }

      showToast(`Generated ${data.num_samples ?? data.numbers?.length ?? 'N/A'} samples (${data.source})`, 'success', 1800);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Generation failed', 'error', 3500);
      // show friendly message in result area if present
      const resultDisplay = el('resultDisplay');
      if (resultDisplay) {
        resultDisplay.innerHTML = `<div class="text-center py-8 text-red-300">${err.message || 'Generation failed'}</div>`;
      }
    } finally {
      genBtn.disabled = false;
      genBtn.innerHTML = origHtml;
    }
  });
}

// ---------------- Init ----------------
function initAll() {
  initGenerateHandler();
  initCopyBtn();
  initDownloadJson();
  initDownloadCsv();
  initPingBtn();
  initThemeToggle();
  initAccentPicker();

  // Optionally create decorative particles if container exists
  const container = document.querySelector('.fixed.inset-0');
  if (container && container.children.length === 0) {
    for (let i = 0; i < 12; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = `${Math.random()*100}%`;
      particle.style.top = `${Math.random()*100}%`;
      particle.style.animationDelay = `${Math.random()*3}s`;
      particle.style.animationDuration = `${2 + Math.random()*2}s`;
      container.appendChild(particle);
    }
  }
  console.log('Frontend v2.0 JS initialized');
}

document.addEventListener('DOMContentLoaded', initAll);
