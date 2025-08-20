PRAGMA foreign_keys = ON;

-- جدول کاربران
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TEXT DEFAULT (datetime('now'))
);

-- جدول کانتینرها (با created_by)
CREATE TABLE IF NOT EXISTS containers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT,
  entry_date TEXT,
  driver_name TEXT,
  entry_phone TEXT,
  exit_date TEXT,
  exit_driver_name TEXT,
  exit_phone TEXT,
  type TEXT,
  container_no TEXT,
  created_by INTEGER,
  FOREIGN KEY(created_by) REFERENCES users(id)
);
