// Backend API configuration
const API_BASE_URL = 'https://qrngenvbackend.onrender.com/';

// Global variables
let distributionChart = null;
let lastResponse = null;

// Helper function to get elements by ID (returns null if not found)
const el = (id) => document.getElementById(id);

// Safety & limits
const MAX_SAMPLES = 5000;
const MAX_BITS = 16; // change this if you want to allow more, but charts/histograms will explode quickly

// Generate random numbers from backend
async function generateRandomNumbers(numBits, numSamples) {
    try {
        const payload = {
            num_bits: parseInt(numBits, 10),
            num_samples: parseInt(numSamples, 10)
        };

        const response = await fetch(`${API_BASE_URL}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`HTTP ${response.status} ${text}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error generating numbers:', error);
        throw new Error('Failed to generate random numbers. Please ensure the backend server is running.');
    }
}

// Format numbers based on bit size for better display (decimal padded)
function formatNumber(number, numBits) {
    const n = Number(number);
    const maxValue = Math.pow(2, numBits) - 1;
    const width = maxValue.toString().length;
    return String(n).padStart(width, '0');
}

// Update statistics display
function updateStatistics(stats = {}) {
    const meanEl = el('meanValue');
    const stdEl = el('stdValue');
    const minEl = el('minValue');
    const maxEl = el('maxValue');

    if (meanEl) meanEl.textContent = (stats.mean ?? 0).toFixed(2);
    if (stdEl) stdEl.textContent = (stats.std ?? 0).toFixed(2);
    if (minEl) minEl.textContent = String(stats.min ?? 0);
    if (maxEl) maxEl.textContent = String(stats.max ?? 0);
}

// Update source indicator
function updateSourceIndicator(source) {
    const indicator = el('sourceIndicator');
    if (!indicator) return;
    indicator.textContent = source === 'ANU' ? 'ANU Quantum Source' : 'Qiskit Simulator';
    indicator.className = `source-badge ${source === 'ANU' ? 'source-anu' : 'source-simulator'} transition-opacity duration-300`;
    indicator.style.opacity = '1';
}

// Render distribution graph
function renderDistributionGraph(numbers = [], numBits) {
    const canvas = el('distributionChart');
    if (!canvas) {
        console.warn('No canvas with id "distributionChart" found. Skipping chart render.');
        return;
    }

    const bits = parseInt(numBits, 10);
    if (isNaN(bits) || bits < 1) return;

    // If bits is large, don't create a bar for every possible value (too many bars).
    // Use bucketed histogram if bits > 12 (4096 bars).
    const rawNumbers = numbers.map(x => Number(x));
    const maxValue = (1 << bits) - 1;

    let labels = [];
    let counts = [];

    if (bits <= 12 && maxValue <= 4096) {
        // full frequency for small bit-sizes
        counts = new Array(maxValue + 1).fill(0);
        rawNumbers.forEach(n => {
            if (Number.isFinite(n) && n >= 0 && n <= maxValue) counts[n]++;
        });
        labels = Array.from({ length: maxValue + 1 }, (_, i) => String(i));
    } else {
        // bucketed histogram (e.g., 256 buckets)
        const BUCKETS = 256;
        counts = new Array(BUCKETS).fill(0);
        rawNumbers.forEach(n => {
            if (!Number.isFinite(n)) return;
            const idx = Math.floor((n / maxValue) * (BUCKETS - 1));
            counts[Math.max(0, Math.min(BUCKETS - 1, idx))]++;
        });
        // generate labels as ranges
        labels = counts.map((_, i) => {
            const from = Math.round((i / BUCKETS) * maxValue);
            const to = Math.round(((i + 1) / BUCKETS) * maxValue);
            return `${from}–${to}`;
        });
    }

    // Destroy previous chart if it exists
    try {
        if (distributionChart) {
            distributionChart.destroy();
            distributionChart = null;
        }
    } catch (err) {
        console.warn('Error destroying previous chart:', err);
    }

    const ctx = canvas.getContext('2d');
    distributionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Frequency',
                data: counts,
                backgroundColor: 'rgba(99, 102, 241, 0.6)',
                borderColor: 'rgba(99, 102, 241, 1)',
                borderWidth: 1,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: 'Generated Numbers' },
                    ticks: { autoSkip: true, maxTicksLimit: 20 },
                },
                y: {
                    title: { display: true, text: 'Frequency' },
                    ticks: {}
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {}
            },
            animation: { duration: 600 }
        }
    });
}

// Render table with numbers
function renderTable(numbers = [], numBits) {
    const container = el('resultDisplay');
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'space-y-2';

    numbers.forEach((n, i) => {
        const row = document.createElement('div');
        row.className = 'text-sm font-mono bg-gray-800/30 px-3 py-2 rounded-lg hover:bg-gray-800/50 transition-colors flex justify-between';
        const decimal = String(n);
        const binary = Number(n).toString(2).padStart(parseInt(numBits, 10), '0');
        row.innerHTML = `
            <span class="text-gray-400">${i + 1}.</span>
            <span class="text-blue-300">${decimal}</span>
            <span class="text-green-300">${binary}</span>
        `;
        wrapper.appendChild(row);
    });

    container.innerHTML = '';
    container.appendChild(wrapper);
}

// Download utilities
function download(filename, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Helper: show a transient message (keeps single param API)
function showError(msg) {
    const errorBox = document.createElement('div');
    errorBox.className = 'fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
    errorBox.textContent = msg;
    document.body.appendChild(errorBox);

    setTimeout(() => {
        errorBox.remove();
    }, 3000);
}

// Main generation handler
function initGenerateHandler() {
    const genBtn = el('generateBtn');
    if (!genBtn) return;

    genBtn.addEventListener('click', async () => {
        const numBitsEl = el('numBits');
        const numSamplesEl = el('numSamples');
        if (!numBitsEl || !numSamplesEl) {
            showError('Missing input elements');
            return;
        }

        let numBits = parseInt(numBitsEl.value, 10);
        let numSamples = parseInt(numSamplesEl.value, 10);

        if (isNaN(numBits) || isNaN(numSamples)) {
            showError('Please enter valid numeric values.');
            return;
        }

        // enforce limits
        if (numBits < 1) numBits = 1;
        if (numBits > MAX_BITS) {
            showError(`numBits too large for safe visualization. Max allowed is ${MAX_BITS}.`);
            return;
        }
        if (numSamples < 1 || numSamples > MAX_SAMPLES) {
            showError(`Quantity must be between 1 and ${MAX_SAMPLES}`);
            return;
        }

        // Show loading state
        genBtn.disabled = true;
        const originalInner = genBtn.innerHTML;
        genBtn.innerHTML = `
            <span class="flex items-center justify-center">
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V4a8 8 0 00-8 8z"></path>
                </svg>
                Quantum Processing...
            </span>
        `;

        try {
            const startTime = performance.now();
            const result = await generateRandomNumbers(numBits, numSamples);
            const endTime = performance.now();

            lastResponse = result;

            // Update source indicator
            updateSourceIndicator(result.source);

            // Ensure numbers are numeric array
            const numbers = (result.numbers || []).map(x => Number(x));
            // Display formatted decimal strings in table but pass raw numbers to distribution
            const formattedNumbers = numbers.map(n => formatNumber(n, numBits));
            renderTable(numbers, numBits); // we render raw numbers (renderTable will convert)
            updateStatistics(result.statistics || {});
            renderDistributionGraph(numbers, numBits);

            console.log(`Generation completed in ${Math.round(endTime - startTime)}ms using ${result.source}`);
        } catch (err) {
            console.error('Generation error:', err);
            showError(err.message || 'Generation failed.');
            el('resultDisplay').innerHTML = `
                <div class="text-center py-8 text-red-300">
                    <svg class="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01M4.282 16.5L12 4l7.718 12.5C19.946 19.5 18.985 21.167 17.216 21.167H6.784c-1.77 0-2.73-1.666-1.732-2.667z"></path>
                    </svg>
                    <p>${err.message}</p>
                    <p class="text-sm mt-2 text-gray-400">Make sure the backend server is running on port 5000</p>
                </div>
            `;
        } finally {
            genBtn.disabled = false;
            genBtn.innerHTML = originalInner;
        }
    });
}

// Copy results functionality
function initCopyBtn() {
    const copyBtn = el('copyBtn');
    if (!copyBtn) return;

    copyBtn.addEventListener('click', () => {
        if (!lastResponse || !lastResponse.numbers) {
            showError('No results to copy');
            return;
        }

        const bits = parseInt(el('numBits')?.value || '1', 10);
        const numbers = lastResponse.numbers.map(n => formatNumber(n, bits));
        const text = numbers.join('\n');

        navigator.clipboard.writeText(text).then(() => {
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = `<span class="flex items-center justify-center">Copied!</span>`;
            setTimeout(() => copyBtn.innerHTML = originalText, 1500);
        }).catch(err => {
            console.error('Failed to copy:', err);
            showError('Failed to copy results to clipboard');
        });
    });
}

// Download JSON
function initDownloadJson() {
    const btn = el('downloadJson');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (!lastResponse) { showError('No data to download'); return; }
        download('qrng_response.json', JSON.stringify(lastResponse, null, 2));
    });
}

// Download CSV
function initDownloadCsv() {
    const btn = el('downloadCsv');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (!lastResponse || !lastResponse.numbers) { showError('No data to download'); return; }
        const bits = parseInt(el('numBits')?.value || '1', 10);
        const rows = ['index,decimal,binary'];
        lastResponse.numbers.forEach((n, i) => {
            const dec = Number(n);
            rows.push(`${i + 1},${dec},${dec.toString(2).padStart(bits, '0')}`);
        });
        download('qrng_numbers.csv', rows.join('\n'));
    });
}

// Copy curl command
function initCopyCurl() {
    const btn = el('copyCurl');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const numBits = el('numBits')?.value || '8';
        const numSamples = el('numSamples')?.value || '16';
        const curl = `curl -X POST ${API_BASE_URL}/generate \\\n  -H "Content-Type: application/json" \\\n  -d '{"num_bits": ${numBits}, "num_samples": ${numSamples}}'`;
        navigator.clipboard.writeText(curl).then(() => {
            const old = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => (btn.textContent = old), 1000);
        });
    });
}

// Ping server functionality
function initPingBtn() {
    const btn = el('pingBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        try {
            const response = await fetch(API_BASE_URL);
            if (response.ok) {
                showError('Server is running ✓'); // reusing showError for transient messages
            } else {
                showError('Server error: ' + response.status);
            }
        } catch (error) {
            showError('Server not reachable');
        }
    });
}

// Input validation (samples)
function initInputValidation() {
    const ns = el('numSamples');
    if (!ns) return;
    ns.addEventListener('input', function(e) {
        let value = parseInt(e.target.value, 10);
        if (isNaN(value) || value < 1) e.target.value = 1;
        if (value > MAX_SAMPLES) e.target.value = MAX_SAMPLES;
    });
}

// Theme toggle functionality
function initThemeToggle() {
    const tbtn = el('toggleTheme');
    if (!tbtn) return;
    tbtn.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
    });
}

// Initialize particles (safe: checks container)
function createParticles() {
    const container = document.querySelector('.fixed.inset-0');
    if (!container) return;
    for (let i = 0; i < 15; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.top = `${Math.random() * 100}%`;
        particle.style.animationDelay = `${Math.random() * 3}s`;
        particle.style.animationDuration = `${2 + Math.random() * 2}s`;
        container.appendChild(particle);
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    createParticles();
    initGenerateHandler();
    initCopyBtn();
    initDownloadJson();
    initDownloadCsv();
    initCopyCurl();
    initPingBtn();
    initInputValidation();
    initThemeToggle();
    console.log('Quantum RNG Interface Loaded');
});
