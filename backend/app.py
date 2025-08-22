from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit_aer import Aer

app = Flask(__name__)
CORS(app)  # allow frontend to call backend


# --- QRNG using Qiskit ---
def generate_qrng(num_bits=8, num_samples=10):
    numbers = []
    backend = Aer.get_backend("aer_simulator")

    for _ in range(num_samples):
        # Quantum circuit with num_bits qubits
        qc = QuantumCircuit(num_bits, num_bits)
        qc.h(range(num_bits))        # put all qubits in superposition
        qc.measure(range(num_bits), range(num_bits))

        # transpile for the backend
        tqc = transpile(qc, backend)
        result = backend.run(tqc, shots=1).result()
        counts = result.get_counts()

        # outcome is a binary string (e.g. '1010')
        bitstring = list(counts.keys())[0]
        decimal = int(bitstring, 2)
        numbers.append(decimal)

    return numbers, 2**num_bits - 1


@app.route("/")
def home():
    return jsonify({
        "message": "Quantum RNG API (Qiskit powered)",
        "endpoints": {
            "/generate": "POST { num_bits, num_samples }",
            "/info": "GET"
        }
    })


@app.route("/info")
def info():
    return jsonify({
        "library": "qiskit",
        "backend": "aer_simulator",
        "description": "Generates random numbers using superposition + measurement"
    })


@app.route("/generate", methods=["POST"])
def generate():
    data = request.get_json(force=True)
    num_bits = int(data.get("num_bits", 8))
    num_samples = int(data.get("num_samples", 10))

    if not (1 <= num_bits <= 16):
        return jsonify({"error": "num_bits must be between 1 and 16"}), 400
    if not (1 <= num_samples <= 1000):
        return jsonify({"error": "num_samples must be between 1 and 1000"}), 400

    numbers, max_value = generate_qrng(num_bits, num_samples)

    # basic stats
    arr = np.array(numbers)
    stats = {
        "mean": float(np.mean(arr)),
        "std": float(np.std(arr)),
        "min": int(np.min(arr)),
        "max": int(np.max(arr)),
        "range": int(np.max(arr) - np.min(arr))
    }

    return jsonify({
        "parameters": {
            "num_bits": num_bits,
            "num_samples": num_samples,
            "max_value": max_value
        },
        "numbers": numbers,
        "statistics": stats
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)


