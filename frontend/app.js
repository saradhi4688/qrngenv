const API_BASE_URL = 'http://127.0.0.1:5000';
const TOKEN_KEY = 'qrng_token';
let lastResponse = null;
let isGuestMode = false;

/* ---------- Page flow management ---------- */
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on the main application page
    if (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/')) {
        // Check if user came from login or has a valid token
        const token = getAuthToken();
        const isGuest = localStorage.getItem('qrng_guest_mode') === 'true';
        
        if (!token && !isGuest) { // FIXED: &amp;&amp; to &&
            // Redirect to intro page if not logged in or guest
            window.location.href = 'intro.html';
            return;
        }
        
        if (isGuest) {
            isGuestMode = true;
            console.log('Running in guest mode');
        }
    }
});

/* ---------- DOM helpers ---------- */
const el = id => document.getElementById(id);

const safeText = (id, txt) => {
    const e = el(id);
    if(e) {
        e.textContent = txt;
        console.log(`Updated ${id}: ${txt}`);
    } else {
        console.warn(`Element ${id} not found`);
    }
};

// IMPROVED: Better DOM element handling
function safeGetElement(id, required = false) {
    const element = document.getElementById(id);
    if (!element && required) {
        console.error(`Critical: Required element '${id}' not found`);
        showToast(`UI Error: Missing ${id} element`, 'error');
    } else if (!element) {
        console.warn(`Optional element '${id}' not found`);
    }
    return element;
}

/* ---------- Number formatting functions ---------- */
function formatNumber(num, format, bits = 8) {
    const number = parseInt(num);
    switch(format) {
        case 'binary':
            return number.toString(2).padStart(bits, '0');
        case 'hexadecimal':
            const hexDigits = Math.ceil(bits / 4);
            return number.toString(16).toUpperCase().padStart(hexDigits, '0');
        case 'decimal':
        default:
            return number.toString();
    }
}

function formatNumberArray(numbers, format, bits = 8) {
    if (!Array.isArray(numbers)) return [];
    return numbers.map(num => formatNumber(num, format, bits));
}

function getFormatDisplayName(format) {
    const names = {
        'decimal': 'Decimal',
        'binary': 'Binary',
        'hexadecimal': 'Hexadecimal'
    };
    return names[format] || 'Decimal';
}

/* ---------- Toast notifications ---------- */
function showToast(msg, type='info', ms=4000){
    console.log(`Toast: ${type} - ${msg}`);
    // Remove existing toasts
    document.querySelectorAll('.qrng-toast').forEach(t => t.remove());
    
    const t = document.createElement('div');
    t.className = 'qrng-toast ' + type;
    t.textContent = msg;
    
    const colors = {
        error: '#dc2626',
        success: '#16a34a',
        info: '#2563eb',
        warning: '#d97706'
    };
    
    Object.assign(t.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        padding: '12px 16px',
        background: colors[type] || colors.info,
        color: '#fff',
        borderRadius: '8px',
        zIndex: 10000,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        fontSize: '14px',
        maxWidth: '300px',
        wordWrap: 'break-word'
    });
    
    document.body.appendChild(t);
    setTimeout(() => {
        if (t.parentNode) t.remove();
    }, ms);
}

/* ---------- Auth helpers ---------- */
function getAuthToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function setAuthToken(t) {
    if (t) {
        localStorage.setItem(TOKEN_KEY, t);
        console.log('Token saved');
    } else {
        localStorage.removeItem(TOKEN_KEY);
        console.log('Token removed');
    }
}

function getAuthHeaders() {
    const tok = getAuthToken();
    return tok ? { "Authorization": "Bearer " + tok } : {};
}

/* ---------- IMPROVED Network functions with better error handling ---------- */
async function apiPost(path, body={}, withAuth=false){
    console.log(`API POST ${path}:`, body);
    let headers = { "Content-Type": "application/json" };
    if (withAuth) headers = { ...headers, ...getAuthHeaders() };
    
    try {
        const res = await fetch(API_BASE_URL + path, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            timeout: 10000 // IMPROVED: Add timeout
        });
        
        const txt = await res.text();
        console.log(`API Response (${res.status}):`, txt.substring(0, 200) + (txt.length > 200 ? '...' : '')); // FIXED: &gt; to >
        
        try {
            const json = JSON.parse(txt);
            if (!res.ok) throw new Error(json.message || json.error || txt || `HTTP ${res.status}`);
            return json;
        } catch(e) {
            if (!res.ok) throw new Error(txt || e.message);
            throw e;
        }
    } catch(err) {
        console.error(`API POST ${path} failed:`, err);
        // IMPROVED: Better error messages
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
            throw new Error('Cannot connect to server. Is the backend running?');
        }
        throw err;
    }
}

async function apiGet(path, withAuth=false){
    console.log(`API GET ${path}`);
    let headers = {};
    if (withAuth) headers = { ...getAuthHeaders() };
    
    try {
        const res = await fetch(API_BASE_URL + path, { 
            method: "GET", 
            headers,
            timeout: 10000 // IMPROVED: Add timeout
        });
        
        const txt = await res.text();
        console.log(`API Response (${res.status}):`, txt.substring(0, 200) + (txt.length > 200 ? '...' : '')); // FIXED: &gt; to >
        
        try {
            const json = JSON.parse(txt);
            if (!res.ok) throw new Error(json.message || json.error || txt || `HTTP ${res.status}`);
            return json;
        } catch(e) {
            if (!res.ok) throw new Error(txt || e.message);
            throw e;
        }
    } catch(err) {
        console.error(`API GET ${path} failed:`, err);
        // IMPROVED: Better error messages
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
            throw new Error('Cannot connect to server. Is the backend running?');
        }
        throw err;
    }
}

/* ---------- IMPROVED Generate handler with better error handling ---------- */
async function initGenerateHandler(){
    const btn = safeGetElement('generateBtn', true);
    if (!btn) return;

    console.log('Generate handler initialized');
    btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        console.log('Generate button clicked');
        
        // IMPROVED: Better auth check
        if (!getAuthToken() && !isGuestMode) {
            showToast('Please login or continue as guest to generate numbers', 'error');
            return;
        }

        // IMPROVED: Better element handling with fallbacks
        const numBitsEl = safeGetElement('numBits');
        const numSamplesEl = safeGetElement('numSamples');
        const formatEl = safeGetElement('numberFormat');
        
        let num_bits = numBitsEl ? parseInt(numBitsEl.value || 8, 10) : 8;
        let num_samples = numSamplesEl ? parseInt(numSamplesEl.value || 10, 10) : 10;
        let format = formatEl ? formatEl.value || 'decimal' : 'decimal';

        // IMPROVED: Better validation
        if (isNaN(num_bits) || num_bits < 1 || num_bits > 16) {
            showToast('Number of bits must be between 1 and 16', 'error');
            return;
        }
        if (isNaN(num_samples) || num_samples < 1 || num_samples > 5000) { // FIXED: &lt; to <
            showToast('Number of samples must be between 1 and 5000', 'error');
            return;
        }

        console.log(`Generating: ${num_bits} bits, ${num_samples} samples, format: ${format}`);

        btn.disabled = true;
        btn.textContent = 'Generating...';

        try {
            const res = await apiPost('/generate', {
                num_bits,
                num_samples,
                format
            }, false);
            
            console.log('Generation response:', res);
            lastResponse = res;
            renderGenerationResult(res, format, num_bits);
            
            const count = res.numbers ? res.numbers.length : 0;
            showToast(`Generated ${count} ${getFormatDisplayName(format).toLowerCase()} numbers from ${res.source || 'unknown'}`, 'success');
            
        } catch(err) {
            console.error('Generate error:', err);
            showToast('Generation failed: ' + (err.message || err), 'error', 6000);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Generate';
        }
    });
}

// IMPROVED: Initialize all handlers with better error handling
async function initializeApp() {
    try {
        await updateAuthUi();
        initGenerateHandler();
        initCopyBtn();
        initDownloadJson();
        initDownloadCsv();
        initPingBtn();
        initThemeToggle();
        initAccentPicker();
        initParticles();
        
        console.log('App initialized successfully');
    } catch (error) {
        console.error('App initialization failed:', error);
        showToast('App initialization failed. Please refresh the page.', 'error');
    }
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', initializeApp);

/* ---------- Rest of the functions with HTML entities fixed ---------- */
// [Continue with the rest of your functions, making sure to fix all &amp;, &lt;, &gt; entities]
