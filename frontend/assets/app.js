const el = (id) => document.getElementById(id);
const baseUrlInput = el('baseUrl');
const errorBox = el('errorBox');
const statsCard = el('statsCard');
const chartCard = el('chartCard');
const tableCard = el('tableCard');
const sourceBadge = el('sourceBadge');
const sourceDot = el('sourceDot');
const sourceText = el('sourceText');

let lastResponse = null;
let chart = null;

function animateCard(card) {
  if (!card) return;
  gsap.fromTo(card, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" });
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  gsap.fromTo(errorBox, { opacity: 0 }, { opacity: 1, duration: 0.3 });
}
function hideError() { errorBox.classList.add('hidden'); }

async function api(path, opts = {}) {
  const base = baseUrlInput.value.trim().replace(/\/$/, '');
  const url = base + path;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error || j.message || JSON.stringify(j); } catch {}
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  return res.json();
}

function renderStats(stats) {
  if (!stats) return;
  el('statMean').textContent  = Number(stats.mean ?? 0).toFixed(3);
  el('statStd').textContent   = Number(stats.std ?? stats.std_dev ?? 0).toFixed(3);
  el('statMin').textContent   = stats.min ?? '—';
  el('statMax').textContent   = stats.max ?? '—';
  const range = (stats.max !== undefined && stats.min !== undefined) ? (stats.max - stats.min) : '—';
  el('statRange').textContent = range;
  statsCard.classList.remove('hidden');
  animateCard(statsCard);
}

function renderTable(numbers, numBits) {
  const tbody = el('numbersBody');
  tbody.innerHTML = '';
  numbers.forEach((n, i) => {
    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-700/40 transition";
    tr.innerHTML = `
      <td class="py-2 pr-6">${i + 1}</td>
      <td class="py-2 pr-6 font-medium">${n}</td>
      <td class="py-2 pr-6 font-mono">${Number(n).toString(2).padStart(Number(numBits || 1), '0')}</td>`;
    tbody.appendChild(tr);
  });
  tableCard.classList.remove('hidden');
  animateCard(tableCard);
}

function renderHistogram(numbers, maxValue) {
  const labels = Array.from({ length: maxValue + 1 }, (_, i) => i);
  const counts = new Array(maxValue + 1).fill(0);
  numbers.forEach(n => { if (n >= 0 && n < counts.length) counts[n]++; });
  const ctx = document.getElementById('histogram').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Frequency', data: counts, backgroundColor: '#6366f1' }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 20 } } } }
  });
  chartCard.classList.remove('hidden');
  animateCard(chartCard);
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ------------ UI actions ------------ */
el('genBtn').addEventListener('click', async () => {
  hideError();
  const num_bits = Number(el('numBits').value);
  const num_samples = Number(el('numSamples').value);
  if (!(num_bits >= 1 && num_bits <= 16)) return showError('num_bits must be 1–16');
  if (!(num_samples >= 1 && num_samples <= 1000)) return showError('num_samples must be 1–1000');

  try {
    const data = await api('/generate', { method: 'POST', body: JSON.stringify({ num_bits, num_samples }) });
    lastResponse = data;

    // backend shape (authoritative)
    const bits = Number(data.num_bits ?? num_bits);
    const maxValue = (1 << bits) - 1;
    const numbers = Array.isArray(data.numbers) ? data.numbers : [];
    const stats = data.statistics ?? null;

    // source badge
    if (data.source) {
      sourceBadge.classList.remove('hidden');
      sourceText.textContent = `Source: ${data.source === 'ANU' ? 'ANU QRNG' : 'Qiskit Simulator'}`;
      sourceDot.className = "inline-block h-2.5 w-2.5 rounded-full " + (data.source === 'ANU' ? "bg-emerald-400" : "bg-amber-400");
    } else {
      sourceBadge.classList.add('hidden');
    }

    renderStats(stats);
    renderTable(numbers, bits);
    renderHistogram(numbers, maxValue);
  } catch (e) {
    showError(e.message);
  }
});

el('clearBtn').addEventListener('click', () => {
  hideError();
  statsCard.classList.add('hidden');
  chartCard.classList.add('hidden');
  tableCard.classList.add('hidden');
  sourceBadge.classList.add('hidden');
  el('numbersBody').innerHTML = '';
  if (chart) chart.destroy();
  lastResponse = null;
});

el('downloadJson').addEventListener('click', () => {
  if (!lastResponse) return;
  download('qrng_response.json', JSON.stringify(lastResponse, null, 2));
});

el('downloadCsv').addEventListener('click', () => {
  if (!lastResponse) return;
  const numbers = lastResponse.numbers || [];
  const bits = Number(lastResponse.num_bits ?? Number(el('numBits').value));
  const rows = ['index,decimal,binary'];
  numbers.forEach((n, i) => rows.push(`${i + 1},${n},${Number(n).toString(2).padStart(bits, '0')}`));
  download('qrng_numbers.csv', rows.join('\n'));
});

el('copyCurl').addEventListener('click', () => {
  const base = baseUrlInput.value.trim().replace(/\/$/, '');
  const num_bits = Number(el('numBits').value);
  const num_samples = Number(el('numSamples').value);
  const curl = `curl -s -X POST \\\n  -H "Content-Type: application/json" \\\n  -d '{"num_bits": ${num_bits}, "num_samples": ${num_samples}}' \\\n  "${base}/generate"`;
  navigator.clipboard.writeText(curl).then(() => {
    const btn = el('copyCurl');
    const old = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = old), 1000);
  });
});

el('pingBtn').addEventListener('click', async () => {
  hideError();
  const indicator = el('pingStatus');
  indicator.classList.remove('hidden');
  indicator.textContent = 'Pinging…';
  try {
    const j = await api('/');
    const desc = j.message || j.description || 'OK';
    indicator.textContent = `Connected ✓ — ${desc}`;
  } catch (e) {
    indicator.textContent = 'Failed ✗ — ' + e.message;
  }
});

el('openInfo').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    // your backend exposes "/" and "/generate"; show "/" info
    const j = await api('/');
    el('infoContent').textContent = JSON.stringify(j, null, 2);
  } catch (err) {
    el('infoContent').textContent = 'Error loading /: ' + err.message;
  }
  el('infoModal').showModal();
  gsap.fromTo("#infoModal", { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4, ease: "power2.out" });
});
el('closeInfo').addEventListener('click', () => el('infoModal').close());

el('toggleTheme').addEventListener('click', () => {
  document.documentElement.classList.toggle("dark");
  document.body.classList.toggle("bg-slate-50");
  document.body.classList.toggle("text-slate-800");
});
