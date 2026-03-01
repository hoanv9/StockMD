import requests
from app.database import SessionLocal
from app.models import Symbol, StockData
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("app.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

def manual_update_symbols():
    db = SessionLocal()
    try:
        # 1. Get all unique symbols from StockData history
        # If StockData is empty, we can't do much unless we have a list source.
        # Assuming StockData has some data from previous runs.
        logger.info("Fetching unique symbols from StockData history...")
        unique_symbols = db.query(StockData.stock_symbol).distinct().all()
        unique_symbols = [s[0] for s in unique_symbols]
        
        if not unique_symbols:
            logger.warning("No symbols found in StockData table. Cannot populate Symbol table.")
            return

        logger.info(f"Found {len(unique_symbols)} symbols. Starting update...")

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }

        count = 0
        for sym in unique_symbols:
            try:
                if not sym:
                    continue
                
                url = f"https://iboard-query.ssi.com.vn/stock/{sym}"
                response = requests.get(url, headers=headers)
                
                if response.status_code == 200:
                    data = response.json()
                    item = data.get('data', data)
                    
                    if item:
                        existing_sym = db.query(Symbol).filter(Symbol.stock_symbol == sym).first()
                        
                        exchange = item.get('exchange')
                        company_name = item.get('companyNameVi')
                        
                        # Get price: try matchedPrice first, if 0 or None, use refPrice
                        price = float(item.get('matchedPrice', 0) or 0)
                        if price == 0:
                            price = float(item.get('refPrice', 0) or 0)
                        
                        if existing_sym:
                            existing_sym.exchange = exchange
                            existing_sym.company_name_vi = company_name
                            existing_sym.price = price
                            logger.info(f"Updated {sym}")
                        else:
                            new_sym = Symbol(
                                stock_symbol=sym,
                                exchange=exchange,
                                company_name_vi=company_name,
                                price=price
                            )
                            db.add(new_sym)
                            logger.info(f"Inserted {sym}")
                        
                        db.commit()
                        count += 1
            except Exception as e:
                logger.error(f"Error processing {sym}: {e}")
        
        logger.info(f"Completed. Processed {count}/{len(unique_symbols)} symbols.")

    except Exception as e:
        logger.error(f"Fatal error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    manual_update_symbols()
