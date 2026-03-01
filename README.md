# StockMD - Negotiated Transaction Report

StockMD is a web-based dashboard application built to track, visualize, and analyze negotiated stock market transactions (Put-Through transactions vs. Total Match Volume) from the Vietnam stock market (HOSE, HNX, UPCOM). 

## Features

*   **Market Overview Dashboard**: Top 50 active stocks, total match volume/value, and exchange distribution.
*   **Single Stock Analysis**: Detailed breakdown of daily trading volumes, match volume vs. total stock volume, and implied pricing.
*   **Automated Background Data Fetching**:
    *   Schedules configured via `.env` (default: `11:35` and `15:00`).
    *   Built-in exponential backoff and retry mechanism for SSI data feeds to handle API instability.
    *   Daily data overwrite/update logic to ensure no data is missed at the end of the trading day.

## Data Sources & Fetching Workflow

The application fetches raw market data from public endpoints provided by SSI (iboard-query).

**SSI Endpoints Used:**
1. **Trading Date Check**: `https://iboard-query.ssi.com.vn/stock/AAA` (To extract `tradingDate`).
2. **Put-Through Data (Thỏa Thuận)**:
   - HNX: `https://iboard-query.ssi.com.vn/le-table/all-pt/hnx`
   - HOSE: `https://iboard-query.ssi.com.vn/le-table/all-pt/hose`
   - UPCOM: `https://iboard-query.ssi.com.vn/le-table/all-pt/upcom`
3. **Total Volume Data (Khớp lệnh & Tổng)**:
   - HNX: `https://iboard-query.ssi.com.vn/stock/exchange/hnx`
   - HOSE: `https://iboard-query.ssi.com.vn/stock/exchange/hose`
   - UPCOM: `https://iboard-query.ssi.com.vn/stock/exchange/upcom`
4. **Symbol Dictionary Updates**: `https://iboard-query.ssi.com.vn/stock/{symbol}`.

**Fetching Workflow (Data Pipeline):**
1. **Validate Trading Date**: An initial request determines if the ongoing date is a valid trading date from the SSI API. If closed, the fetching job halts.
2. **Fetch Put-Through Data**: Call the 3 endpoints (HNX, HOSE, UPCOM) for negotiated transactions.
3. **Fetch Total Volume Data**: Call the other 3 endpoints (HNX, HOSE, UPCOM) to verify the aggregate stock volumes of the active symbols encountered in step #2.
4. **Data Merging**: Left-join Put-Through data with Total Volume data based on the stock symbol.
5. **Database Storage**: Store merged records into MySQL. If records already exist for the current transaction date, they are updated (Overwritten).
6. **Master Symbols Synchronization**: Scrape underlying details (Exchange, Company Name VN, Reference/Match Price) for newly tracked symbols and add them into the master symbol table.

*Note: All external HTTP requests include an exponential backoff capability, starting with a base delay of 30 seconds and running up to 3 times.*

*   **Floating Search**: Quick search overlay to quickly navigate to specific stock ticker data anytime.
*   **Excel Data Export**: Download filtered queries directly in Excel format using `pandas` `openpyxl`.
*   **Responsive UI**: Built with Bootstrap 5, Chart.js, and DataTables for an interactive experience.

## Technology Stack

*   **Backend**: Python, FastAPI, SQLAlchemy, APScheduler, Pandas
*   **Frontend**: HTML, JavaScript (jQuery), Bootstrap 5, Chart.js, DataTables, Select2, Flatpickr
*   **Database**: MySQL (PyMySQL)

## Installation & Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/hoanv9/StockMD.git
   cd StockMD
   ```

2. **Set up Python Virtual Environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # on Windows use: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Environment Variables**
   Rename `.env.example` to `.env` and adjust the configuration:
   ```env
   DATABASE_URL=mysql+pymysql://root:password@localhost:3306/stock_db
   
   # Comma-separated list for background scheduler (HH:MM format)
   FETCH_SCHEDULES=11:35,15:00
   
   # Retry logic for SSI API calls
   FETCH_RETRY_COUNT=3
   FETCH_RETRY_DELAY_SECONDS=30
   ```

5. **Start the Application**
   ```bash
   uvicorn app.main:app --reload
   ```

## Background Scheduler Notes

The APScheduler runs within the FastAPI instance. 
Logs for data extraction and schedule activities are printed to console and additionally written to `app.log` in UTF-8. 
To manually trigger a data extraction outside of the schedule, use the "Fetch Latest Data" button accessible via the application's sidebar.

## License

MIT License
