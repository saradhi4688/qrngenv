class QuantumRNG {
    constructor() {
        this.generateBtn = document.getElementById('generate-btn');
        this.loadingDiv = document.getElementById('loading');
        this.resultsContainer = document.getElementById('results-container');
        this.statsContainer = document.getElementById('stats-container');
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        this.generateBtn.addEventListener('click', () => this.generateQuantumNumbers());
    }

    async generateQuantumNumbers() {
        const numBits = parseInt(document.getElementById('num-bits').value);
        const numSamples = parseInt(document.getElementById('num-samples').value);
        const outputFormat = document.getElementById('output-format').value;

        // Show loading state
        this.showLoading();

        try {
            // Simulate quantum circuit execution
            const results = await this.simulateQuantumCircuit(numBits, numSamples);
            
            // Display results
            this.displayResults(results, outputFormat);
            this.calculateStatistics(results);
            
        } catch (error) {
            console.error('Error generating quantum numbers:', error);
            this.displayError('Failed to generate quantum numbers');
        } finally {
            this.hideLoading();
        }
    }

    async simulateQuantumCircuit(numBits, numSamples) {
        // Simulate quantum random number generation
        return new Promise((resolve) => {
            setTimeout(() => {
                const results = [];
                const maxValue = Math.pow(2, numBits) - 1;
                
                for (let i = 0; i < numSamples; i++) {
                    // Simulate quantum measurement: each bit has 50% probability
                    let quantumNumber = 0;
                    for (let bit = 0; bit < numBits; bit++) {
                        if (Math.random() < 0.5) {
                            quantumNumber |= (1 << bit);
                        }
                    }
                    results.push(quantumNumber);
                }
                
                resolve(results);
            }, 1500); // Simulate processing time
        });
    }

    displayResults(results, format) {
        let output = '';
        
        results.forEach((number, index) => {
            let formattedNumber;
            
            switch (format) {
                case 'binary':
                    const numBits = parseInt(document.getElementById('num-bits').value);
                    formattedNumber = number.toString(2).padStart(numBits, '0');
                    break;
                case 'hex':
                    formattedNumber = '0x' + number.toString(16).toUpperCase();
                    break;
                default:
                    formattedNumber = number.toString();
            }
            
            output += `<span class="number-result">${formattedNumber}</span>`;
            
            if ((index + 1) % 5 === 0) {
                output += '\n';
            }
        });

        this.resultsContainer.innerHTML = output || '<p class="placeholder">No results generated</p>';
    }

    calculateStatistics(results) {
        if (results.length === 0) return;

        const mean = results.reduce((sum, num) => sum + num, 0) / results.length;
        const min = Math.min(...results);
        const max = Math.max(...results);
        const range = max - min;

        document.getElementById('stat-mean').textContent = mean.toFixed(2);
        document.getElementById('stat-min').textContent = min;
        document.getElementById('stat-max').textContent = max;
        document.getElementById('stat-range').textContent = range;

        this.statsContainer.classList.remove('hidden');
    }

    displayError(message) {
        this.resultsContainer.innerHTML = `<p style="color: var(--secondary-color);">Error: ${message}</p>`;
    }

    showLoading() {
        this.generateBtn.disabled = true;
        this.loadingDiv.classList.remove('hidden');
    }

    hideLoading() {
        this.generateBtn.disabled = false;
        this.loadingDiv.classList.add('hidden');
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new QuantumRNG();
});

// Add some quantum-themed animations
function addQuantumParticles() {
    const container = document.getElementById('quantum-bg');
    
    for (let i = 0; i < 50; i++) {
        const particle = document.createElement('div');
        particle.style.position = 'absolute';
        particle.style.width = Math.random() * 3 + 1 + 'px';
        particle.style.height = particle.style.width;
        particle.style.background = Math.random() > 0.5 ? '#00d4ff' : '#8338ec';
        particle.style.borderRadius = '50%';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.top = Math.random() * 100 + '%';
        particle.style.opacity = Math.random() * 0.5 + 0.1;
        particle.style.animation = `float ${Math.random() * 10 + 5}s infinite ease-in-out`;
        
        container.appendChild(particle);
    }
}

// CSS animation for particles
const style = document.createElement('style');
style.textContent = `
    @keyframes float {
        0%, 100% { transform: translateY(0px) rotate(0deg); }
        50% { transform: translateY(-20px) rotate(180deg); }
    }
`;
document.head.appendChild(style);

// Add particles when page loads
document.addEventListener('DOMContentLoaded', addQuantumParticles);
