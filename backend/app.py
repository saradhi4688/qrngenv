# app.py — Quantum RNG v2.0-stable
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import time
import math
import logging
import io
import csv
import json
import datetime
import threading

import requests
from requests.adapters import HTTPAdapter, Retry

import numpy as np

# Qiskit imports for fallback (kept as before)
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

app = Flask(__name__)
CORS(app)
logging.basicConfig(level=logging.INFO)

# Version / Build
VERSION = "2.0-stable"
BUILD = "stable"

# ANU QRNG endpoint
ANU_BASE = "https://qrng.anu.edu.au/API/jsonI.php"

# requests Session with retries/backoff
session = requests.Session()
retries = Retry(total=3, backoff_factor=0.6, status_forcelist=(500, 502, 503, 504))
session.mount("https://", HTTPAdapter(max_retries=retries))

# Limits / safety
MAX_BITS = 16
MAX_SAMPLES = 5000

# Thread-safety for last_generation
lock = threading.Lock()

# Cache last generation
# structure:
# last_generation = {
#   "numbers": [...],
#   "meta": { "num_bits":..., "num_samples":..., "stats": {...}, "entropy": ..., "timestamp": ..., "version": VERSION, "build":BUILD }
# }
last_generation = {"numbers": [], "meta": {}}


# ---------------- Utility helpers ----------------
def to_native(x):
    """Convert numpy scalar or arrays to native Python types for JSON."""
    if isinstance(x, np.generic):
        return x.item()
    if isinstance(x, np.ndarray):
        return x.tolist()
    return x


def now_iso():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def compute_basic_stats(numbers):
    """Return dict with mean/std/min/max/count as native Python floats/ints or None."""
    arr = np.array(numbers, dtype=np.int64) if numbers else np.array([], dtype=np.int64)
    if arr.size == 0:
        return {"mean": None, "std": None, "min": None, "max": None, "count": 0}
    mean = float(arr.mean())
    std = float(arr.std())
    mn = int(arr.min())
    mx = int(arr.max())
    cnt = int(arr.size)
    return {"mean": mean, "std": std, "min": mn, "max": mx, "count": cnt}


def compute_entropy(numbers):
    """Shannon entropy (bits) — returns float."""
    if not numbers:
        return 0.0
    vals, counts = np.unique(np.array(numbers, dtype=np.int64), return_counts=True)
    probs = counts / counts.sum()
    # Protect against tiny numerical issues
    ent = float(-(probs * np.log2(probs)).sum())
    return ent


# ---------------- QRNG fetchers ----------------
def fetch_anu_uints(count: int, unit_bits: int, timeout: float = 8.0):
    """
    Fetch `count` integers from ANU QRNG in chunks. unit_bits must be 8 or 16.
    Returns Python list of ints.
    Raises on non-200 or if ANU returns success=false.
    """
    assert unit_bits in (8, 16)
    unit_type = "uint8" if unit_bits == 8 else "uint16"

    out = []
    remaining = int(count)
    # polite batching
    while remaining > 0:
        chunk = min(remaining, 1024)
        params = {"length": chunk, "type": unit_type}
        resp = session.get(ANU_BASE, params=params, timeout=timeout)
        resp.raise_for_status()
        j = resp.json()
        if not j.get("success", False):
            raise RuntimeError("ANU returned success=false")
        data = j.get("data", [])
        out.extend([int(x) for x in data])
        remaining -= len(data)
        time.sleep(0.02)
    return out


def generate_from_anu(num_bits: int, num_samples: int):
    """
    Use ANU + rejection-sampling to produce num_samples integers in [0, 2^num_bits - 1].
    """
    if not (1 <= num_bits <= MAX_BITS):
        raise ValueError("num_bits must be 1..{}".format(MAX_BITS))
    wanted = int(num_samples)
    result = []
    unit_bits = 8 if num_bits <= 8 else 16
    M = 1 << unit_bits
    m = 1 << num_bits
    limit = M - (M % m)
    # fetch a bit more to cover rejections
    fetch_size = max(256, math.ceil(wanted * (M / m) * 1.1))

    while len(result) < wanted:
        batch = fetch_anu_uints(fetch_size, unit_bits)
        for r in batch:
            if r < limit:
                result.append(int(r % m))
                if len(result) >= wanted:
                    break
    return result


def generate_local_qiskit(num_bits: int, num_samples: int):
    """
    Use Qiskit Aer simulator to generate samples (shots=num_samples).
    Returns list of ints.
    """
    if not (1 <= num_bits <= MAX_BITS):
        raise ValueError("num_bits must be 1..{}".format(MAX_BITS))
    backend = AerSimulator()
    qc = QuantumCircuit(num_bits, num_bits)
    qc.h(range(num_bits))
    qc.measure(range(num_bits), range(num_bits))
    tqc = transpile(qc, backend)
    job = backend.run(tqc, shots=num_samples)
    counts = job.result().get_counts()

    numbers = []
    for bitstring, freq in counts.items():
        # bitstring is MSB..LSB
        numbers.extend([int(bitstring, 2)] * int(freq))
    return numbers[:num_samples]


# ---------------- Endpoints ----------------
@app.route("/")
def home():
    return jsonify({
        "message": "Quantum RNG API (ANU primary, Qiskit fallback)",
        "version": VERSION,
        "build": BUILD,
        "endpoints": {
            "/generate (POST)": "{ num_bits, num_samples }",
            "/health": "check status of ANU and Simulator",
            "/export/csv": "download last generated numbers as CSV",
            "/export/json": "download last generated numbers as JSON",
            "/tests": "run randomness tests"
        }
    })


@app.route("/health")
def health():
    anu_ok = False
    try:
        test = fetch_anu_uints(1, 8)
        anu_ok = bool(test)
    except Exception as e:
        logging.debug("ANU health check failed: %s", e)
    return jsonify({
        "status": "ok",
        "version": VERSION,
        "build": BUILD,
        "anu": anu_ok,
        "simulator": True,
        "timestamp": now_iso()
    })


@app.route("/generate", methods=["POST"])
def generate_endpoint():
    """
    POST JSON: { "num_bits": int, "num_samples": int }  (camelCase also supported)
    Returns:
    {
      "status":"success",
      "source":"ANU"|"SIMULATOR",
      "num_bits":.., "numBits":..,
      "num_samples":.., "numSamples":..,
      "stats":{...}, "statistics":{...},
      "entropy":.., "timestamp":.., "version":.., "build":..,
      "numbers": [...]
    }
    """
    global last_generation
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({"status": "error", "error_code": "INVALID_JSON", "message": "Invalid JSON body"}), 400

    # accept both num_bits and numBits
    num_bits = data.get("num_bits", data.get("numBits", 8))
    num_samples = data.get("num_samples", data.get("numSamples", 10))

    try:
        num_bits = int(num_bits)
        num_samples = int(num_samples)
    except Exception:
        return jsonify({"status": "error", "error_code": "INVALID_PARAMS", "message": "num_bits and num_samples must be integers"}), 400

    if not (1 <= num_bits <= MAX_BITS):
        return jsonify({"status": "error", "error_code": "INVALID_PARAMS", "message": f"num_bits must be 1..{MAX_BITS}"}), 400
    if not (1 <= num_samples <= MAX_SAMPLES):
        return jsonify({"status": "error", "error_code": "INVALID_PARAMS", "message": f"num_samples must be 1..{MAX_SAMPLES}"}), 400

    # Try ANU; if it fails, fall back to Qiskit
    numbers = []
    source = None
    try:
        numbers = generate_from_anu(num_bits, num_samples)
        source = "ANU"
    except Exception as e:
        logging.warning("ANU generation failed: %s. Falling back to simulator.", e)
        try:
            numbers = generate_local_qiskit(num_bits, num_samples)
            source = "SIMULATOR"
        except Exception as e2:
            logging.error("Simulator generation also failed: %s", e2)
            return jsonify({"status": "error", "error_code": "SOURCE_FAILURE", "message": "Both ANU QRNG and simulator generation failed."}), 500

    # compute stats and entropy once and cache
    stats = compute_basic_stats(numbers)
    ent = compute_entropy(numbers)
    timestamp = now_iso()

    meta = {
        "source": source,
        "num_bits": num_bits,
        "numBits": num_bits,
        "num_samples": num_samples,
        "numSamples": num_samples,
        "stats": stats,
        "statistics": stats,
        "entropy": ent,
        "timestamp": timestamp,
        "version": VERSION,
        "build": BUILD
    }

    with lock:
        last_generation = {"numbers": [int(x) for x in numbers], "meta": meta}

    # Compose response (backwards-compatible shape)
    response = {
        "status": "success",
        "source": source,
        "num_bits": num_bits,
        "numBits": num_bits,
        "num_samples": num_samples,
        "numSamples": num_samples,
        "stats": stats,
        "statistics": stats,
        "entropy": ent,
        "timestamp": timestamp,
        "version": VERSION,
        "build": BUILD,
        "meta": meta,
        "numbers": last_generation["numbers"]
    }

    # Ensure all values are native types
    return jsonify(json.loads(json.dumps(response, default=to_native)))


@app.route("/export/csv")
def export_csv():
    with lock:
        numbers = last_generation.get("numbers", [])
        meta = last_generation.get("meta", {})
    if not numbers:
        return jsonify({"status": "error", "error_code": "NO_DATA", "message": "No data generated yet"}), 400
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["index", "number"])
    for i, n in enumerate(numbers):
        writer.writerow([i + 1, int(n)])
    fname = f"qrng_{meta.get('timestamp', now_iso()).replace(':','').replace('-','')}.csv"
    return Response(output.getvalue(), mimetype="text/csv", headers={"Content-Disposition": f"attachment;filename={fname}"})


@app.route("/export/json")
def export_json():
    with lock:
        numbers = last_generation.get("numbers", [])
        meta = last_generation.get("meta", {})
    if not numbers:
        return jsonify({"status": "error", "error_code": "NO_DATA", "message": "No data generated yet"}), 400
    payload = {"numbers": numbers, "meta": meta}
    return Response(json.dumps(payload, default=to_native, indent=2), mimetype="application/json",
                    headers={"Content-Disposition": f"attachment;filename=qrng.json"})


@app.route("/tests")
def randomness_tests():
    with lock:
        numbers = last_generation.get("numbers", [])
    if not numbers:
        return jsonify({"status": "error", "error_code": "NO_DATA", "message": "No data generated yet"}), 400
    nums = list(map(int, numbers))
    ent = compute_entropy(nums)
    stats = compute_basic_stats(nums)
    unique_vals = len(set(nums))
    return jsonify({
        "status": "ok",
        "entropy": ent,
        "stats": stats,
        "unique_values": unique_vals,
        "timestamp": now_iso()
    })


# Optional: small metrics endpoint
@app.route("/metrics")
def metrics():
    with lock:
        count = len(last_generation.get("numbers", []))
    return jsonify({
        "status": "ok",
        "version": VERSION,
        "build": BUILD,
        "last_count": count,
        "timestamp": now_iso()
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
