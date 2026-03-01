@echo off
echo Starting Stock Data Web App...
echo Open http://127.0.0.1:8002 in your browser after the server starts.
python -m uvicorn app.main:app --reload --port 8002
pause
