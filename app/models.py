from sqlalchemy import Column, Integer, String, Float, Date, DateTime
from .database import Base

class StockData(Base):
    __tablename__ = "stock_data"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, index=True)
    stock_symbol = Column(String(20), index=True)
    exchange = Column(String(10))
    match_vol = Column(Float, default=0.0) # From Put Through
    match_val = Column(Float, default=0.0) # From Put Through
    stock_vol = Column(Float, default=0.0) # From Total Vol

class DataFetchStatus(Base):
    __tablename__ = "data_fetch_status"

    id = Column(Integer, primary_key=True, index=True)
    trading_date = Column(String(8), unique=True, index=True) # YYYYMMDD
    last_get = Column(DateTime)
    status = Column(String(20)) # SUCCESS, FAILED, IN_PROGRESS

class Symbol(Base):
    __tablename__ = "symbol"

    id = Column(Integer, primary_key=True, index=True)
    stock_symbol = Column(String(20), unique=True, index=True)
    exchange = Column(String(10))
    company_name_vi = Column(String(255))
    price = Column(Float)
