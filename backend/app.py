# app.py (updated)
from flask import Flask, request, jsonify, Response, g, send_from_directory
from flask_cors import CORS
import time, math, logging, io, csv, json, datetime, threading, os
import requests
from requests.adapters import HTTPAdapter, Retry
import numpy as np
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator
from pymongo import MongoClient
import bcrypt
import jwt
from bson import ObjectId
from dotenv import load_dotenv
from functools import wraps

# Load environment variables
load_dotenv()

# Environment configuration
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/qrngdb")
JWT_SECRET = os.environ.get("JWT_SECRET", "change_this_now")
JWT_EXP_SECONDS = int(os.environ.get("JWT_EXP_SECONDS", 7*24*3600))

# ANU QRNG config: read API key from environment
ANU_BASE = os.environ.get("ANU_BASE", "https://api.quantumnumbers.anu.edu.au")
ANU_API_KEY = os.environ.get("ANU_API_KEY", "")

MAX_BITS = 16
MAX_SAMPLES = 5000

# Set the static folder to the 'frontend' directory, assuming it's a sibling of the 'backend' folder
app = Flask(__name__, static_folder='../frontend')
app.config["DEBUG"] = True

# CORS configuration - allow all origins for development
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Requests session with retries
session = requests.Session()
retries = Retry(total=3, backoff_factor=0.6, status_forcelist=(500,502,503,504))
session.mount("https://", HTTPAdapter(max_retries=retries))

# If you want to set a non-sensitive header globally (not the API key), you can:
# session.headers.update({"Accept": "application/json"})

# Thread safety
lock = threading.Lock()
last_generation = {"numbers": [], "meta": {}}

# Database connection
try:
    client = MongoClient(MONGO_URI)
    db = client.get_database("qrngdb")
    users_col = db['users']
    saves_col = db['saves']
    logger.info("Database connected successfully")
except Exception as e:
    logger.error(f"Database connection failed: {e}")
    # Continue — the app can run without DB for dev, but some endpoints will fail.

# Utility functions (unchanged)
def format_number(number, format_type, bits=8):
    num = int(number)
    if format_type == 'binary':
        return format(num, f'0{bits}b')
    elif format_type == 'hexadecimal':
        hex_digits = math.ceil(bits / 4)
        return format(num, f'0{hex_digits}X')
    else:
        return str(num)

def format_number_array(numbers, format_type, bits=8):
    if not numbers:
        return []
    return [format_number(num, format_type, bits) for num in numbers]

def get_format_info(format_type, bits=8):
    max_val = (1 << bits) - 1
    format_info = {
        'decimal': {
            'name': 'Decimal',
            'example': f'0-{max_val}',
            'description': 'Standard decimal numbers'
        },
        'binary': {
            'name': 'Binary',
            'example': f'{"0" * bits}-{"1" * bits}',
            'description': 'Binary representation with leading zeros'
        },
        'hexadecimal': {
            'name': 'Hexadecimal',
            'example': f'00-{format(max_val, f"0{math.ceil(bits/4)}X")}',
            'description': 'Hexadecimal with uppercase letters'
        }
    }
    return format_info.get(format_type, format_info['decimal'])

@app.errorhandler(Exception)
def handle_exception(e):
    logger.error("Unhandled exception", exc_info=True)
    return jsonify({
        "status": "error",
        "message": "Internal Server Error",
        "error_code": "INTERNAL_ERROR"
    }), 500

# Auth helpers (unchanged)
def hash_password(pw):
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt())

def verify_password(pw, hashed):
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed)
    except:
        return False

def create_jwt(payload, exp_seconds=JWT_EXP_SECONDS):
    now_ts = int(time.time())
    payload2 = payload.copy()
    payload2.update({"iat": now_ts, "exp": now_ts + int(exp_seconds)})
    token = jwt.encode(payload2, JWT_SECRET, algorithm="HS256")
    return token if isinstance(token, str) else token.decode("utf-8")

def decode_jwt(token):
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except Exception as e:
        logger.debug(f"JWT decode failed: {e}")
        return None

def auth_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth or not auth.startswith("Bearer "):
            return jsonify({
                "status":"error",
                "message":"Missing Authorization header",
                "error_code":"MISSING_AUTH"
            }), 401

        token = auth.split(" ",1)[1].strip()
        payload = decode_jwt(token)
        if not payload:
            return jsonify({
                "status":"error",
                "message":"Invalid or expired token",
                "error_code":"INVALID_TOKEN"
            }), 401

        user_id_raw = payload.get("user_id")
        try:
            if not user_id_raw:
                raise ValueError("no user_id in token")
            user_id = ObjectId(user_id_raw) if not isinstance(user_id_raw, ObjectId) else user_id_raw
        except Exception as ex:
            logger.debug(f"Invalid user_id in token: {user_id_raw}")
            return jsonify({
                "status":"error",
                "message":"Invalid user id",
                "error_code":"INVALID_USER_ID"
            }), 401

        user = users_col.find_one({"_id": user_id})
        if not user:
            return jsonify({
                "status":"error",
                "message":"User not found",
                "error_code":"USER_NOT_FOUND"
            }), 401

        g.current_user = user
        return f(*args, **kwargs)
    return wrapper

# Utility helpers
def to_native(x):
    if isinstance(x, np.generic): 
        return x.item()
    if isinstance(x, np.ndarray): 
        return x.tolist()
    return x

def now_iso():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat()+"Z"

def compute_basic_stats(numbers):
    if not numbers:
        return {"mean":None,"std":None,"min":None,"max":None,"count":0}
    arr = np.array(numbers, dtype=np.int64)
    if arr.size == 0:
        return {"mean":None,"std":None,"min":None,"max":None,"count":0}
    return {
        "mean": float(arr.mean()),
        "std": float(arr.std()),
        "min": int(arr.min()),
        "max": int(arr.max()),
        "count": int(arr.size)
    }

def compute_entropy(numbers):
    if not numbers:
        return 0.0
    vals, counts = np.unique(np.array(numbers, dtype=np.int64), return_counts=True)
    probs = counts / counts.sum()
    return float(-(probs * np.log2(probs)).sum())

# ANU QRNG Functions
def fetch_anu_uints(count: int, unit_bits: int, timeout: float = 8.0):
    """
    Fetch random integers from ANU QRNG.
    Uses ANU_API_KEY from environment if present.
    """
    assert unit_bits in (8, 16), "unit_bits must be 8 or 16"
    unit_type = "uint8" if unit_bits == 8 else "uint16"
    out = []
    remaining = int(count)

    logger.info(f"Fetching {count} {unit_type} values from ANU")

    # Build request-level headers (do not log keys)
    req_headers = {}
    if ANU_API_KEY:
        req_headers["Authorization"] = f"Bearer {ANU_API_KEY}"
        req_headers["X-API-KEY"] = ANU_API_KEY
    else:
        logger.debug("ANU_API_KEY not configured; requests to ANU will be unauthenticated (may be rejected).")

    while remaining > 0:
        chunk = min(remaining, 1024)
        params = {"length": chunk, "type": unit_type}

        try:
            resp = session.get(ANU_BASE, params=params, headers=req_headers, timeout=timeout)
            if resp.status_code in (401, 403):
                raise RuntimeError(f"ANU API authentication failed (HTTP {resp.status_code}). Check ANU_API_KEY configuration.")
            resp.raise_for_status()
            j = resp.json()

            if isinstance(j, dict) and j.get("success") is False:
                raise RuntimeError(f"ANU returned success=false: {j}")

            if isinstance(j, dict) and "data" in j:
                data = j.get("data", [])
            elif isinstance(j, list):
                data = j
            else:
                data = j.get("data") if isinstance(j, dict) else []

            if not data:
                raise RuntimeError(f"ANU returned empty data or unexpected payload: {j}")

            out.extend([int(x) for x in data])
            remaining -= len(data)
            if remaining > 0:
                time.sleep(0.02)

        except Exception as e:
            logger.error(f"ANU fetch failed: {e}")
            raise

    logger.info(f"Successfully fetched {len(out)} values from ANU")
    return out

def generate_from_anu(num_bits: int, num_samples: int):
    if not (1 <= num_bits <= MAX_BITS):
        raise ValueError(f"num_bits must be 1..{MAX_BITS}")

    wanted = int(num_samples)
    result = []
    unit_bits = 8 if num_bits <= 8 else 16
    max_val = (1 << num_bits) - 1

    fetch_count = max(wanted * 2, 100)

    while len(result) < wanted:
        raw_nums = fetch_anu_uints(fetch_count, unit_bits)
        filtered = [n for n in raw_nums if n <= max_val]
        result.extend(filtered)

        if len(result) >= wanted:
            break

        fetch_count = min(fetch_count * 2, 5000)

    return result[:wanted]

def generate_local_qiskit(num_bits: int, num_samples: int):
    if not (1 <= num_bits <= MAX_BITS):
        raise ValueError(f"num_bits must be 1..{MAX_BITS}")

    logger.info(f"Generating {num_samples} samples with {num_bits} bits using Qiskit")
    backend = AerSimulator()
    qc = QuantumCircuit(num_bits, num_bits)
    qc.h(range(num_bits))
    qc.measure(range(num_bits), range(num_bits))

    tqc = transpile(qc, backend)
    job = backend.run(tqc, shots=num_samples)
    counts = job.result().get_counts()

    numbers = []
    for bitstring, freq in counts.items():
        numbers.extend([int(bitstring, 2)] * int(freq))

    logger.info(f"Generated {len(numbers)} numbers using Qiskit")
    return numbers[:num_samples]

@app.route("/")
def serve_intro():
    return send_from_directory(app.static_folder, 'intro.html')

@app.route("/<path:path>")
def serve_static_files(path):
    """Serve any static file from the root directory."""
    return send_from_directory(app.static_folder, path)

@app.route("/favicon.ico")
def favicon():
    """
    Handles requests for favicon.ico to prevent 404 errors in the logs.
    A blank icon is returned.
    """
    return "", 204

@app.route("/health")
def health():
    anu_ok = False
    anu_msg = None
    if not ANU_API_KEY:
        anu_msg = "ANU_API_KEY not configured"
    else:
        try:
            test = fetch_anu_uints(1, 8, timeout=5.0)
            anu_ok = bool(test)
        except Exception as e:
            logger.debug(f"ANU health check failed: {e}")
            anu_msg = str(e)

    return jsonify({
        "status": "ok",
        "version": "2.2-format-support",
        "build": "stable-with-formats",
        "anu": anu_ok,
        "anu_message": anu_msg,
        "simulator": True,
        "formats_supported": ["decimal", "binary", "hexadecimal"],
        "timestamp": now_iso()
    })

@app.route("/generate", methods=["POST"])
def generate_endpoint():
    global last_generation

    try:
        data = request.get_json(force=True) or {}
    except Exception as e:
        logger.error(f"Invalid JSON in request: {e}")
        return jsonify({
            "status": "error",
            "error_code": "INVALID_JSON",
            "message": "Invalid JSON body"
        }), 400

    num_bits = data.get("num_bits", data.get("numBits", 8))
    num_samples = data.get("num_samples", data.get("numSamples", 10))
    format_type = (data.get("format", "decimal") or "decimal").lower()

    try:
        num_bits = int(num_bits)
        num_samples = int(num_samples)
    except (ValueError, TypeError):
        return jsonify({
            "status": "error",
            "error_code": "INVALID_PARAMS",
            "message": "num_bits and num_samples must be integers"
        }), 400

    if format_type not in ['decimal', 'binary', 'hexadecimal']:
        format_type = 'decimal'

    if not (1 <= num_bits <= MAX_BITS):
        return jsonify({
            "status": "error",
            "error_code": "INVALID_PARAMS",
            "message": f"num_bits must be 1..{MAX_BITS}"
        }), 400

    if not (1 <= num_samples <= MAX_SAMPLES):
        return jsonify({
            "status": "error",
            "error_code": "INVALID_PARAMS",
            "message": f"num_samples must be 1..{MAX_SAMPLES}"
        }), 400

    logger.info(f"Generating {num_samples} samples with {num_bits} bits in {format_type} format")
    numbers = []
    source = None

    try:
        numbers = generate_from_anu(num_bits, num_samples)
        source = "ANU"
        logger.info(f"Successfully generated {len(numbers)} numbers from ANU")
    except Exception as e:
        logger.warning(f"ANU failed: {e}. Falling back to simulator.")
        try:
            numbers = generate_local_qiskit(num_bits, num_samples)
            source = "SIMULATOR"
            logger.info(f"Successfully generated {len(numbers)} numbers from simulator")
        except Exception as e2:
            logger.error(f"Simulator also failed: {e2}")
            return jsonify({
                "status": "error",
                "error_code": "SOURCE_FAILURE",
                "message": "Both ANU QRNG and simulator failed."
            }), 500

    stats = compute_basic_stats(numbers)
    entropy = compute_entropy(numbers)
    timestamp = now_iso()
    formatted_numbers = format_number_array(numbers, format_type, num_bits)
    format_info = get_format_info(format_type, num_bits)

    meta = {
        "source": source,
        "num_bits": num_bits,
        "num_samples": num_samples,
        "format": format_type,
        "format_info": format_info,
        "stats": stats,
        "entropy": entropy,
        "timestamp": timestamp,
        "version": "2.2-format-support",
        "build": "stable-with-formats"
    }

    with lock:
        last_generation = {
            "numbers": [int(x) for x in numbers],
            "meta": meta
        }

    response = {
        "status": "success",
        "source": source,
        "num_bits": num_bits,
        "num_samples": num_samples,
        "actual_count": len(numbers),
        "format": format_type,
        "format_info": format_info,
        "stats": stats,
        "entropy": entropy,
        "timestamp": timestamp,
        "version": "2.2-format-support",
        "build": "stable-with-formats",
        "meta": meta,
        "numbers": [int(x) for x in numbers],
        "formatted_numbers": formatted_numbers
    }

    logger.info(f"Generation completed: {len(numbers)} numbers from {source} in {format_type} format")
    return jsonify(json.loads(json.dumps(response, default=to_native)))

@app.route("/export/csv")
def export_csv():
    with lock:
        numbers = last_generation.get("numbers", [])
        meta = last_generation.get("meta", {})

    if not numbers:
        return jsonify({
            "status": "error",
            "message": "No numbers to export"
        }), 400

    format_type = request.args.get('format', 'decimal')
    num_bits = meta.get('num_bits', 8)
    formatted_numbers = format_number_array(numbers, format_type, num_bits)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["index", "decimal", format_type])
    for i, (decimal_num, formatted_num) in enumerate(zip(numbers, formatted_numbers)):
        writer.writerow([i + 1, decimal_num, formatted_num])

    csv_content = output.getvalue()
    output.close()

    response = Response(
        csv_content,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=qrng_{format_type}_{now_iso().replace(':', '')}.csv"}
    )
    return response

@app.route("/export/json")
def export_json():
    with lock:
        data = last_generation.copy()

    if not data.get("numbers"):
        return jsonify({
            "status": "error",
            "message": "No numbers to export"
        }), 400

    num_bits = data.get("meta", {}).get("num_bits", 8)
    numbers = data.get("numbers", [])

    formatted_data = {
        **data,
        "all_formats": {
            "decimal": numbers,
            "binary": format_number_array(numbers, "binary", num_bits),
            "hexadecimal": format_number_array(numbers, "hexadecimal", num_bits)
        }
    }

    response = Response(
        json.dumps(formatted_data, indent=2, default=to_native),
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment; filename=qrng_all_formats_{now_iso().replace(':', '')}.json"}
    )
    return response

@app.route("/auth/signup", methods=["POST"])
def auth_signup():
    try:
        data = request.get_json(force=True)
        if not data:
            data = {}
    except:
        return jsonify({
            "status": "error",
            "message": "Invalid JSON"
        }), 400

    email = (data.get("email") or "").strip().lower()
    password = data.get("password", "")

    if not email or not password or len(password) < 6:
        return jsonify({
            "status": "error",
            "message": "email & password (>=6 chars) required"
        }), 400

    if users_col.find_one({"email": email}):
        return jsonify({
            "status": "error",
            "message": "Email already exists"
        }), 409

    pw_hash = hash_password(password)
    doc = {
        "email": email,
        "password_hash": pw_hash,
        "created_at": now_iso()
    }
    res = users_col.insert_one(doc)
    user_id = res.inserted_id

    token = create_jwt({"user_id": str(user_id), "email": email})

    return jsonify({
        "status": "success",
        "token": token,
        "user": {
            "email": email,
            "user_id": str(user_id)
        }
    })

@app.route("/auth/login", methods=["POST"])
def auth_login():
    try:
        data = request.get_json(force=True)
        if not data:
            data = {}
    except:
        return jsonify({
            "status": "error",
            "message": "Invalid JSON"
        }), 400

    email = (data.get("email") or "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({
            "status": "error",
            "message": "email & password required"
        }), 400

    user = users_col.find_one({"email": email})
    if not user or not verify_password(password, user.get("password_hash", b"")):
        return jsonify({
            "status": "error",
            "message": "Invalid credentials"
        }), 401

    token = create_jwt({"user_id": str(user["_id"]), "email": user["email"]})

    return jsonify({
        "status": "success",
        "token": token,
        "user": {
            "email": user["email"],
            "user_id": str(user["_id"])
        }
    })

@app.route("/auth/me")
@auth_required
def auth_me():
    user = g.current_user
    return jsonify({
        "status": "success",
        "user": {
            "email": user["email"],
            "user_id": str(user["_id"]),
            "created_at": user.get("created_at")
        }
    })

@app.route("/save", methods=["POST"])
@auth_required
def save_generated():
    user = g.current_user
    try:
        payload = request.get_json(force=True)
        if not payload:
            payload = {}
    except:
        payload = {}

    numbers = payload.get("numbers")
    meta = payload.get("meta")
    name = payload.get("name", f"qrng_{now_iso()}")

    with lock:
        if numbers is None:
            numbers = last_generation.get("numbers", [])
        if meta is None:
            meta = last_generation.get("meta", {})

    if not numbers:
        return jsonify({
            "status": "error",
            "message": "No numbers to save"
        }), 400

    doc = {
        "user_id": user["_id"],
        "name": name,
        "num_items": len(numbers),
        "num_bits": meta.get("num_bits"),
        "num_samples": meta.get("num_samples"),
        "format_type": meta.get("format", "decimal"),
        "numbers": [int(x) for x in numbers],
        "meta": meta,
        "created_at": now_iso()
    }

    res = saves_col.insert_one(doc)

    return jsonify({
        "status": "success",
        "save_id": str(res.inserted_id),
        "name": name
    })

@app.route("/saves", methods=["GET"])
@auth_required
def list_saves():
    user = g.current_user
    cursor = saves_col.find({"user_id": user["_id"]}).sort("created_at", -1).limit(200)
    out = []
    for s in cursor:
        out.append({
            "save_id": str(s["_id"]),
            "name": s.get("name"),
            "created_at": s.get("created_at"),
            "num_items": s.get("num_items"),
            "num_bits": s.get("num_bits"),
            "num_samples": s.get("num_samples"),
            "format_type": s.get("format_type", "decimal"),
            "meta": s.get("meta", {})
        })
    return jsonify({
        "status": "success",
        "items": out
    })

@app.route("/saves/<save_id>", methods=["GET"])
@auth_required
def get_save(save_id):
    user = g.current_user
    try:
        s = saves_col.find_one({"_id": ObjectId(save_id), "user_id": user["_id"]})
        if not s:
            return jsonify({
                "status": "error",
                "message": "Save not found"
            }), 404
        s["_id"] = str(s["_id"])
        s["user_id"] = str(s["user_id"])
        return jsonify({
            "status": "success",
            "save": s
        })
    except:
        return jsonify({
            "status": "error",
            "message": "Invalid save ID"
        }), 400

@app.route("/saves/<save_id>", methods=["DELETE"])
@auth_required
def delete_save(save_id):
    user = g.current_user
    try:
        res = saves_col.delete_one({"_id": ObjectId(save_id), "user_id": user["_id"]})
        if res.deleted_count == 0:
            return jsonify({
                "status": "error",
                "message": "Save not found or access denied"
            }), 404
        logger.info(f"Save {save_id} deleted by user {user['email']}")
        return jsonify({
            "status": "success",
            "message": "Save deleted successfully"
        })
    except Exception as e:
        logger.error(f"Delete save failed: {e}")
        return jsonify({
            "status": "error",
            "message": "Invalid save ID"
        }), 400

@app.route("/metrics")
def metrics():
    with lock:
        count = len(last_generation.get("numbers", []))
        format_type = last_generation.get("meta", {}).get("format", "decimal")
    return jsonify({
        "status": "ok",
        "version": "2.2-format-support",
        "build": "stable-with-formats",
        "last_count": count,
        "last_format": format_type,
        "supported_formats": ["decimal", "binary", "hexadecimal"],
        "timestamp": now_iso()
    })

if __name__ == "__main__":
    logger.info("Starting Quantum RNG API with ANU API key support")
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
