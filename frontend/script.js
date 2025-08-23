const el = (id) => document.getElementById(id);
const baseUrlInput = el('baseUrl');
const errorBox = el('errorBox');
const statsCard = el('statsCard');
const chartCard = el('chartCard');
const tableCard = el('tableCard');
const loadingOverlay = el('loadingOverlay');

let lastResponse = null;
let chart = null;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}

function showLoading() {
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

async function api(path, opts = {}) {
  const base = baseUrlInput.value.trim().replace(/\/$/, '');
  const url = base + path;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || JSON.stringify(j); } catch {}
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  return res.json();
}

function renderStats(stats, source) {
  el('statMean').textContent = Number(stats.mean).toFixed(3);
  el('statStd').textContent  = Number(stats.std).toFixed(3);
  el('statMin').textContent  = stats.min;
  el('statMax').textContent  = stats.max;
  el('statRange').textContent= stats.range;

  statsCard.classList.remove('hidden');
  el('statsCard').querySelector("h2").textContent = `📊 Statistics (${source})`; // show ANU/Qiskit
}

function renderTable(numbers, numBits) {
  const tbody = el('numbersBody');
  const rows = numbers.map((n, i) => `
    <tr class="hover:bg-slate-700/40 transition">
      <td class="py-2 pr-6">${i+1}</td>
      <td class="py-2 pr-6 font-medium">${n}</td>
      <td class="py-2 pr-6 font-mono">${Number(n).toString(2).padStart(numBits, '0')}</td>
    </tr>
  `).join('');
  tbody.innerHTML = rows;

  tableCard.classList.remove('hidden');
}

function renderHistogram(numbers, maxValue) {
  const labels = Array.from({length: maxValue + 1}, (_, i) => i);
  const counts = new Array(maxValue + 1).fill(0);
  numbers.forEach(n => counts[n]++);
  const ctx = document.getElementById('histogram').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Frequency', data: counts, backgroundColor: '#6366f1' }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 20 } } } }
  });
  chartCard.classList.remove('hidden');
}

el('genBtn').addEventListener('click', async () => {
  hideError();
  const num_bits = Number(el('numBits').value);
  const num_samples = Number(el('numSamples').value);

  if (!(num_bits >= 1 && num_bits <= 16)) return showError('num_bits must be 1–16');
  if (!(num_samples >= 1 && num_samples <= 1000)) return showError('num_samples must be 1–1000');

  showLoading();
  el('genBtn').disabled = true;
  el('clearBtn').disabled = true;

  try {
    const data = await api('/generate', { method: 'POST', body: JSON.stringify({ num_bits, num_samples }) });
    lastResponse = data;
    renderStats(data.statistics, data.source);
    renderTable(data.numbers, data.parameters.num_bits);
    renderHistogram(data.numbers, data.parameters.max_value);
  } catch (e) {
    showError(e.message);
  } finally {
    hideLoading();
    el('genBtn').disabled = false;
    el('clearBtn').disabled = false;
  }
});

el('clearBtn').addEventListener('click', () => {
  hideError();
  statsCard.classList.add('hidden');
  chartCard.classList.add('hidden');
  tableCard.classList.add('hidden');
  el('numbersBody').innerHTML = '';
  if (chart) chart.destroy();
  lastResponse = null;
});
