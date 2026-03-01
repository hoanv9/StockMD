# Database Setup & Import Instructions

## 1. Create Database
Log in to your MySQL server and run the following command to create the database:

```sql
CREATE DATABASE stock_data_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 2. Import Database (if you have a .sql backup)
If you have a backup file (e.g., `backup.sql`), use the following command to import it:

**Command Line:**
```bash
mysql -u [username] -p stock_data_db < backup.sql
```
*Replace `[username]` with your MySQL username (e.g., `root`).*

## 3. Configure Application
Ensure your `.env` file is updated with the correct database credentials:

```ini
DATABASE_URL=mysql+pymysql://[username]:[password]@[host]:[port]/stock_data_db
```

## 4. Verify Tables
After starting the application, the tables will be automatically created if they don't exist (via SQLAlchemy). You can verify this by logging into MySQL and running:

```sql
USE stock_data_db;
SHOW TABLES;
DESCRIBE stock_data;
```
