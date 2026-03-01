from fastapi import FastAPI, Request, Depends, BackgroundTasks
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from .database import get_db
from .models import StockData, DataFetchStatus, Symbol
from .scheduler import start_scheduler, fetch_data
from datetime import date, datetime
from typing import Optional
import pandas as pd
import io

app = FastAPI()

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

@app.on_event("startup")
def on_startup():
    start_scheduler()

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})

@app.get("/stock/{symbol}", response_class=HTMLResponse)
async def read_stock(request: Request, symbol: str):
    return templates.TemplateResponse("stock.html", {"request": request, "symbol": symbol})

@app.get("/api/symbols")
def get_symbols(db: Session = Depends(get_db)):
    # Return full symbol details from Symbol table if available, else fallback to StockData
    # Ideally we should use Symbol table as master
    symbols = db.query(Symbol).all()
    if symbols:
        return [{"symbol": s.stock_symbol, "company_name": s.company_name_vi, "exchange": s.exchange} for s in symbols]
    
    # Fallback
    symbols = db.query(StockData.stock_symbol).distinct().order_by(StockData.stock_symbol).all()
    return [{"symbol": s[0], "company_name": "", "exchange": ""} for s in symbols]

@app.get("/api/available-dates")
def get_available_dates(db: Session = Depends(get_db)):
    # Get dates with SUCCESS status
    dates = db.query(DataFetchStatus.trading_date).filter(DataFetchStatus.status == "SUCCESS").order_by(DataFetchStatus.trading_date.desc()).all()
    # Convert YYYYMMDD to YYYY-MM-DD
    formatted_dates = []
    for d in dates:
        dt_str = d[0]
        if len(dt_str) == 8:
            formatted_dates.append(f"{dt_str[:4]}-{dt_str[4:6]}-{dt_str[6:]}")
    return formatted_dates

@app.get("/api/data")
def get_data(
    db: Session = Depends(get_db),
    symbol: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None
):
    query = db.query(StockData)
    
    if symbol:
        query = query.filter(StockData.stock_symbol == symbol)
    if from_date:
        query = query.filter(StockData.date >= from_date)
    if to_date:
        query = query.filter(StockData.date <= to_date)
        
    data = query.order_by(StockData.date.desc()).all()
    return data

@app.post("/api/trigger-job")
def trigger_job(background_tasks: BackgroundTasks):
    background_tasks.add_task(fetch_data)
    return {"message": "Job triggered in background"}

@app.get("/api/last-update")
def get_last_update(db: Session = Depends(get_db)):
    """Trả về thời điểm fetch dữ liệu thành công gần nhất."""
    record = (
        db.query(DataFetchStatus)
        .filter(DataFetchStatus.status == "SUCCESS")
        .order_by(DataFetchStatus.last_get.desc())
        .first()
    )
    if record and record.last_get:
        return {"last_update": record.last_get.strftime("%Y-%m-%d %H:%M:%S")}
    return {"last_update": None}


@app.get("/api/export")
def export_data(
    db: Session = Depends(get_db),
    symbol: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None
):
    query = db.query(StockData)
    
    if symbol:
        query = query.filter(StockData.stock_symbol == symbol)
    if from_date:
        query = query.filter(StockData.date >= from_date)
    if to_date:
        query = query.filter(StockData.date <= to_date)
        
    data = query.order_by(StockData.date.desc()).all()
    
    # Convert to DataFrame
    # Convert to DataFrame
    if not data:
        # Return empty excel with headers if no data
        df = pd.DataFrame(columns=['date', 'exchange', 'stock_symbol', 'match_vol', 'stock_vol'])
    else:
        df = pd.DataFrame([d.__dict__ for d in data])
        if "_sa_instance_state" in df.columns:
            df = df.drop(columns=["_sa_instance_state"])
        
        # Reorder columns as requested
        desired_columns = ['date', 'exchange', 'stock_symbol', 'match_vol', 'stock_vol']
        # Filter to ensure we only select columns that exist (in case of model changes), but strictly following request
        df = df[[c for c in desired_columns if c in df.columns]]

    # Create Excel file in memory
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='StockData')
    
    output.seek(0)
    
    filename = f"stock_data_{date.today()}.xlsx"
    if symbol:
        filename = f"stock_data_{symbol}_{date.today()}.xlsx"
        
    headers = {
        'Content-Disposition': f'attachment; filename="{filename}"'
    }
    return StreamingResponse(output, headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
