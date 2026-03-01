from app.database import SessionLocal
from app.models import StockData
from app.scheduler import fetch_data

if __name__ == "__main__":
    print("Starting manual data fetch...")
    try:
        fetch_data()
        print("Fetch completed successfully.")
        
        db = SessionLocal()
        count = db.query(StockData).count()
        print(f"Total records in DB: {count}")
        db.close()
    except Exception as e:
        print(f"Fetch failed: {e}")
