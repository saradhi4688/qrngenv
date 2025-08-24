# backend/Dockerfile

# Use official lightweight Python
FROM python:3.11-slim

WORKDIR /app

# Copy requirements from repo root
COPY requirements.txt /app/requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy backend code
COPY backend/ /app/

# Run with Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
