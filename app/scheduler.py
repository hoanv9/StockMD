import requests
import pandas as pd
from datetime import date, datetime
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session
from .database import SessionLocal, engine, Base
from .models import StockData, DataFetchStatus, Symbol
import logging
import os
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),                        # In ra console
        logging.FileHandler("app.log", encoding="utf-8"),  # Ghi ra file
    ],
)
logger = logging.getLogger(__name__)

# Create tables if they don't exist
Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def _get_retry_config():
    """Đọc cấu hình retry từ .env"""
    retry_count = int(os.getenv("FETCH_RETRY_COUNT", 3))
    retry_delay = int(os.getenv("FETCH_RETRY_DELAY_SECONDS", 30))
    return retry_count, retry_delay


def _get_schedules():
    """
    Đọc danh sách khung giờ từ env FETCH_SCHEDULES (định dạng HH:MM, phân cách bằng dấu phẩy).
    Ví dụ: FETCH_SCHEDULES=11:35,15:00
    Fallback: FETCH_HOUR + FETCH_MINUTE (backward compatible).
    """
    raw = os.getenv("FETCH_SCHEDULES", "").strip()
    if raw:
        schedules = []
        for entry in raw.split(","):
            parts = entry.strip().split(":")
            if len(parts) == 2:
                try:
                    schedules.append((int(parts[0]), int(parts[1])))
                except ValueError:
                    logger.warning(f"Bỏ qua lịch không hợp lệ: '{entry}'")
        if schedules:
            return schedules
    # Backward-compatible fallback
    hour = int(os.getenv("FETCH_HOUR", 15))
    minute = int(os.getenv("FETCH_MINUTE", 0))
    return [(hour, minute)]


# ---------------------------------------------------------------------------
# Retry wrapper
# ---------------------------------------------------------------------------

def _request_with_retry(url: str, headers: dict, retry_count: int, retry_delay: int):
    """
    GET request với retry + exponential backoff.
    Trả về Response object hoặc raise Exception sau khi hết retry.
    """
    last_exc = None
    for attempt in range(1, retry_count + 1):
        try:
            response = requests.get(url, headers=headers, timeout=20)
            response.raise_for_status()
            return response
        except Exception as e:
            last_exc = e
            wait = retry_delay * (2 ** (attempt - 1))  # exponential backoff
            logger.warning(
                f"Lần thử {attempt}/{retry_count} thất bại cho {url}: {e}. "
                f"Thử lại sau {wait}s..."
            )
            if attempt < retry_count:
                time.sleep(wait)
    raise last_exc


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------

def check_trading_date(retry_count: int, retry_delay: int):
    url = "https://iboard-query.ssi.com.vn/stock/AAA"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    try:
        response = _request_with_retry(url, headers, retry_count, retry_delay)
        data = response.json()
        trading_date = data.get("tradingDate")
        if not trading_date and "data" in data:
            trading_date = data["data"].get("tradingDate")
        return trading_date
    except Exception as e:
        logger.error(f"Không thể lấy trading date sau {retry_count} lần thử: {e}")
        return None


def fetch_data():
    logger.info("=== Bắt đầu job fetch dữ liệu ===")

    retry_count, retry_delay = _get_retry_config()
    logger.info(f"Cấu hình retry: {retry_count} lần, delay cơ bản {retry_delay}s")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    # 1. Kiểm tra ngày giao dịch
    api_trading_date = check_trading_date(retry_count, retry_delay)
    if not api_trading_date:
        logger.error("Không xác minh được ngày giao dịch. Dừng job.")
        return

    today = date.today()
    today_str = today.strftime("%Y%m%d")

    if api_trading_date != today_str:
        logger.info(
            f"Ngày giao dịch từ API ({api_trading_date}) khác ngày hôm nay ({today_str}). Bỏ qua."
        )
        return

    logger.info(f"Xác minh ngày giao dịch thành công: {api_trading_date}.")

    # 2. Cập nhật trạng thái IN_PROGRESS
    db = SessionLocal()
    try:
        status_record = db.query(DataFetchStatus).filter(
            DataFetchStatus.trading_date == api_trading_date
        ).first()

        if not status_record:
            status_record = DataFetchStatus(
                trading_date=api_trading_date, status="IN_PROGRESS", last_get=datetime.now()
            )
            db.add(status_record)
        else:
            status_record.status = "IN_PROGRESS"
            status_record.last_get = datetime.now()

        db.commit()
    except Exception as e:
        logger.error(f"Lỗi cập nhật trạng thái: {e}")
        db.close()
        return

    # 3. Fetch Put-Through Data (với retry)
    pt_urls = {
        "hnx": "https://iboard-query.ssi.com.vn/le-table/all-pt/hnx",
        "hose": "https://iboard-query.ssi.com.vn/le-table/all-pt/hose",
        "upcom": "https://iboard-query.ssi.com.vn/le-table/all-pt/upcom",
    }

    pt_data_list = []
    failed_pt_exchanges = []
    for exchange, url in pt_urls.items():
        try:
            response = _request_with_retry(url, headers, retry_count, retry_delay)
            data = response.json().get("data", [])
            for item in data:
                pt_data_list.append(
                    {
                        "stockSymbol": item.get("stockSymbol"),
                        "exchange": exchange,
                        "vol": float(item.get("vol", 0)),
                        "val": float(item.get("val", 0)),
                    }
                )
            logger.info(f"PT {exchange}: lấy được {len(data)} records.")
        except Exception as e:
            logger.error(f"Lỗi fetch PT data cho {exchange} sau {retry_count} lần thử: {e}")
            failed_pt_exchanges.append(exchange)

    if failed_pt_exchanges:
        logger.warning(
            f"Không lấy được PT data cho các sàn: {failed_pt_exchanges}. "
            "Dữ liệu của các sàn này sẽ bị thiếu trong lần chạy này."
        )

    if not pt_data_list:
        logger.warning("Không có dữ liệu Put-Through nào. Dừng job.")
        try:
            status_record = db.query(DataFetchStatus).filter(
                DataFetchStatus.trading_date == api_trading_date
            ).first()
            if status_record:
                status_record.status = "NO_DATA"
                status_record.last_get = datetime.now()
            db.commit()
        except Exception:
            pass
        finally:
            db.close()
        return

    pt_df = pd.DataFrame(pt_data_list)
    pt_df = pt_df.groupby("stockSymbol").agg(
        {"exchange": "first", "vol": "sum", "val": "sum"}
    ).reset_index()
    pt_df.rename(columns={"vol": "match_vol", "val": "match_val"}, inplace=True)

    # 4. Fetch Total Volume Data (với retry)
    active_exchanges = set(pt_df["exchange"].unique()) if not pt_df.empty else set()
    logger.info(f"Sàn có trong PT data: {active_exchanges}")

    vol_urls = {
        "hnx": "https://iboard-query.ssi.com.vn/stock/exchange/hnx",
        "hose": "https://iboard-query.ssi.com.vn/stock/exchange/hose",
        "upcom": "https://iboard-query.ssi.com.vn/stock/exchange/upcom",
    }

    vol_data_list = []
    for exchange, url in vol_urls.items():
        if exchange not in active_exchanges:
            continue
        try:
            response = _request_with_retry(url, headers, retry_count, retry_delay)
            data = response.json().get("data", [])
            for item in data:
                vol_data_list.append(
                    {
                        "stockSymbol": item.get("stockSymbol"),
                        "stockVol": float(
                            item.get("stockVol", item.get("nmTotalTradedQty", 0))
                        ),
                    }
                )
            logger.info(f"Vol {exchange}: lấy được {len(data)} records.")
        except Exception as e:
            logger.error(f"Lỗi fetch Vol data cho {exchange} sau {retry_count} lần thử: {e}")

    if not vol_data_list:
        logger.warning("Không có dữ liệu Total Volume. Tiếp tục với vol = 0.")
        vol_df = pd.DataFrame(columns=["stockSymbol", "stock_vol"])
    else:
        vol_df = pd.DataFrame(vol_data_list)
        vol_df = vol_df.groupby("stockSymbol").agg({"stockVol": "sum"}).reset_index()
        vol_df.rename(columns={"stockVol": "stock_vol"}, inplace=True)

    # 5. Merge
    final_df = pd.merge(pt_df, vol_df, on="stockSymbol", how="left")
    final_df["match_vol"] = final_df["match_vol"].fillna(0)
    final_df["match_val"] = final_df["match_val"].fillna(0)
    final_df["stock_vol"] = final_df["stock_vol"].fillna(0)
    final_df["exchange"] = final_df["exchange"].fillna("unknown")

    # 6. Lưu vào DB
    try:
        for _, row in final_df.iterrows():
            existing = db.query(StockData).filter(
                StockData.date == today,
                StockData.stock_symbol == row["stockSymbol"],
            ).first()

            if existing:
                existing.match_vol = row["match_vol"]
                existing.match_val = row["match_val"]
                existing.stock_vol = row["stock_vol"]
            else:
                new_record = StockData(
                    date=today,
                    stock_symbol=row["stockSymbol"],
                    exchange=row["exchange"],
                    match_vol=row["match_vol"],
                    match_val=row["match_val"],
                    stock_vol=row["stock_vol"],
                )
                db.add(new_record)

        # Cập nhật trạng thái SUCCESS
        status_record = db.query(DataFetchStatus).filter(
            DataFetchStatus.trading_date == api_trading_date
        ).first()
        if status_record:
            status_record.status = "SUCCESS"
            status_record.last_get = datetime.now()

        db.commit()
        logger.info(f"Lưu thành công {len(final_df)} records cho ngày {today}.")

        # 7. Cập nhật Symbol Master
        unique_symbols = final_df["stockSymbol"].unique()
        logger.info(f"Cập nhật thông tin cho {len(unique_symbols)} mã...")

        for sym in unique_symbols:
            if not sym:
                continue
            try:
                url = f"https://iboard-query.ssi.com.vn/stock/{sym}"
                response = _request_with_retry(url, headers, retry_count, retry_delay)
                data = response.json()
                item = data.get("data", data)

                if item:
                    existing_sym = db.query(Symbol).filter(
                        Symbol.stock_symbol == sym
                    ).first()

                    exchange = item.get("exchange")
                    company_name = item.get("companyNameVi")
                    price = float(item.get("matchedPrice", 0) or 0)
                    if price == 0:
                        price = float(item.get("refPrice", 0) or 0)

                    if existing_sym:
                        existing_sym.exchange = exchange
                        existing_sym.company_name_vi = company_name
                        existing_sym.price = price
                    else:
                        db.add(
                            Symbol(
                                stock_symbol=sym,
                                exchange=exchange,
                                company_name_vi=company_name,
                                price=price,
                            )
                        )
                    db.commit()

            except Exception as e:
                logger.error(f"Lỗi cập nhật symbol {sym}: {e}")
                continue

        logger.info(f"Hoàn thành cập nhật {len(unique_symbols)} mã.")

    except Exception as e:
        logger.error(f"Lỗi lưu dữ liệu vào DB: {e}")
        db.rollback()
        try:
            status_record = db.query(DataFetchStatus).filter(
                DataFetchStatus.trading_date == api_trading_date
            ).first()
            if status_record:
                status_record.status = "FAILED"
                status_record.last_get = datetime.now()
            db.commit()
        except Exception:
            pass
    finally:
        db.close()

    logger.info("=== Kết thúc job fetch dữ liệu ===")


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------

scheduler = BackgroundScheduler()


def start_scheduler():
    """
    Khởi động scheduler với nhiều khung giờ cấu hình trong .env.
    Biến FETCH_SCHEDULES: danh sách HH:MM phân cách bằng dấu phẩy.
    Ví dụ: FETCH_SCHEDULES=11:35,15:00
    """
    schedules = _get_schedules()

    for hour, minute in schedules:
        scheduler.add_job(
            fetch_data,
            "cron",
            hour=hour,
            minute=minute,
            id=f"fetch_data_{hour:02d}{minute:02d}",
            replace_existing=True,
        )
        logger.info(f"Đã đăng ký job lúc {hour:02d}:{minute:02d} hàng ngày.")

    scheduler.start()
    logger.info(
        f"Scheduler khởi động. Tổng {len(schedules)} job(s): "
        + ", ".join(f"{h:02d}:{m:02d}" for h, m in schedules)
    )
