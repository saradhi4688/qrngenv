# Use a lightweight Python base
FROM python:3.11-slim

# Avoid Python writing .pyc files and enable buffered output (helps logging)
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install small system deps required by some Qiskit packages/builds
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      build-essential git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Workdir
WORKDIR /app

# Copy requirements first so Docker can cache dependency installation
COPY requirements.txt /app/requirements.txt

# Upgrade pip and install Python deps
RUN python -m pip install --upgrade pip
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy application code
COPY . /app

# Expose port used by Flask / Gunicorn
ENV PORT=5000
EXPOSE 5000

# Use Gunicorn for a simple production-ready server
# Adjust worker count (-w) for your CPU (4 is a reasonable default)
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "app:app"]
