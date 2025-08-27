#!/bin/sh
set -e

# Default MONGO_URI if not supplied via .env
: "${MONGO_URI:=mongodb://mroot:mrootpass@mongo:27017/qrngdb?authSource=admin}"

echo "Waiting for MongoDB at ${MONGO_URI} ..."

# Use pymongo (already installed) to ping the server
python - <<PY
import os, time
from pymongo import MongoClient
uri = os.environ.get("MONGO_URI", "${MONGO_URI}")
for i in range(60):
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=2000)
        client.admin.command('ping')
        print("Mongo reachable")
        break
    except Exception as e:
        print("Waiting for mongo... attempt", i+1, "->", str(e))
        time.sleep(2)
else:
    print("Warning: Mongo did not respond after timeout; continuing startup (may fail).")
PY

echo "Starting backend with gunicorn..."
exec gunicorn --bind 0.0.0.0:5000 app:app --workers 2 --timeout 120
