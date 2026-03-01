#!/bin/bash

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Run uvicorn in the background with nohup
# Logs will be saved to app.log
nohup python -m uvicorn app.main:app --host 0.0.0.0 --port 8002 > app.log 2>&1 &

echo "Application started in background on port 8002."
echo "Logs are being written to app.log"
echo "PID: $!"
