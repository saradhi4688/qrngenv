# app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import time
import math
import logging

import requests
from requests.adapters import HTTPAdapter, Retry

import numpy as np

# Qiskit imports for fallback
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

app = Flask(__name__)
CORS(app)
logging.basicConfig(level=logging.INFO)

ANU_BASE = "https://qrng.anu.edu.au/API/jsonI.php"

# requests Session with retries/backoff
session = requests.Session()
retries = Retry(total=3, backoff_factor=0.6, status_forcelist=(500, 502, 503, 504))
session.mount("https://", HTTPAdapter(max_retries=retries))


def fetch_anu_uints(count: int, unit_bits: int, timeout: float = 8.0):
    """
    Fetch `count` integers from ANU QRNG in chunks.
    unit_bits must be 8 or 16. Returns a list of ints.
    Raises on non-200 or if ANU reports success=false.
    """
    assert unit_bits in (8, 16)
    unit_type = "uint8" if unit_bits == 8 else "uint16"

    out = []
    remaining = count
    # ANU allows reasonable lengths; fetch in smaller chunks to be polite
    while remaining > 0:
        chunk = min(remaining, 1024)
        params = {"length": chunk, "type": unit_type}
        resp = session.get(ANU_BASE, params=params, timeout=timeout)
        resp.raise_for_status()
        j = resp.json()
        if not j.get("success", False):
            raise RuntimeError("ANU returned success=false")
        data = j.get("data", [])
        out.extend(data)
        remaining -= len(data)
        # small polite pause
        time.sleep(0.02)
    return out


def generate_from_anu(num_bits: int, num_samples: int):
    """
    Use ANU + rejection-sampling to produce `num_samples` integers in [0, 2^num_bits - 1].
    """
    if not (1 <= num_bits <= 16):
        raise ValueError("num_bits must be 1..16")
    wanted = num_samples
    result = []
    unit_bits = 8 if num_bits <= 8 else 16
    M = 1 << unit_bits               # 256 or 65536
    m = 1 << num_bits                # target range size
    limit = M - (M % m)              # accept only values < limit

    # heuristic batch fetch size (a bit larger than needed to cover rejections)
    fetch_size = max(256, math.ceil(wanted * (M / m) * 1.1))

    while len(result) < wanted:
        batch = fetch_anu_uints(fetch_size, unit_bits)
        for r in batch:
            if r < limit:
                result.append(r % m)
                if len(result) >= wanted:
                    break
        # if still below wanted, loop to fetch more
    return result


def generate_local_qiskit(num_bits: int, num_samples: int):
    """
    Fallback: generate using Qiskit Aer simulator in a single batched run (shots=num_samples).
    Returns a list of decimals (0..2^num_bits-1).
    """
    if not (1 <= num_bits <= 16):
        raise ValueError("num_bits must be 1..16")

    backend = AerSimulator()
    qc = QuantumCircuit(num_bits, num_bits)
    qc.h(range(num_bits))
    qc.measure(range(num_bits), range(num_bits))

    # transpile & run with shots=num_samples to get many samples at once
    tqc = transpile(qc, backend)
    job = backend.run(tqc, shots=num_samples)
    result = job.result()
    counts = result.get_counts()

    numbers = []
    for bitstring, freq in counts.items():
        # qiskit returns bitstrings MSB..LSB (e.g. "0101")
        numbers.extend([int(bitstring, 2)] * freq)
    # ensure length exactly num_samples
    return numbers[:num_samples]


@app.route("/")
def home():
    return jsonify({
        "message": "Quantum RNG API (ANU primary, Qiskit fallback)",
        "endpoints": {
            "/generate (POST)": "{ num_bits, num_samples }"
        }
    })


@app.route("/generate", methods=["POST"])
def generate_endpoint():
    """
    POST JSON body: { "num_bits": int, "num_samples": int }
    Returns JSON with 'source' = "ANU" or "SIMULATOR" and the generated numbers.
    """
    data = request.get_json(force=True)
    num_bits = int(data.get("num_bits", 8))
    num_samples = int(data.get("num_samples", 10))

    if not (1 <= num_bits <= 16):
        return jsonify({"status": "error", "message": "num_bits must be 1..16"}), 400
    if not (1 <= num_samples <= 5000):
        return jsonify({"status": "error", "message": "num_samples must be 1..5000"}), 400

    # Try ANU first
    try:
        numbers = generate_from_anu(num_bits, num_samples)
        source = "ANU"
    except Exception as e:
        logging.warning("ANU fetch failed: %s. Falling back to Qiskit Aer simulator.", e)
        try:
            numbers = generate_local_qiskit(num_bits, num_samples)
            source = "SIMULATOR"
        except Exception as e2:
            logging.error("Simulator fallback failed: %s", e2)
            return jsonify({"status": "error", "message": "Both ANU and simulator generation failed."}), 500

    # stats
    arr = np.array(numbers) if numbers else np.array([])
    stats = {
        "mean": float(arr.mean()) if arr.size else None,
        "std": float(arr.std()) if arr.size else None,
        "min": int(arr.min()) if arr.size else None,
        "max": int(arr.max()) if arr.size else None,
    }

    return jsonify({
        "status": "success",
        "source": source,
        "num_bits": num_bits,
        "num_samples": num_samples,
        "numbers": numbers,
        "statistics": stats
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)








