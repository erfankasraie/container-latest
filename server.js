

const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const bcrypt = require("bcrypt");
const session = require("express-session");

const app = express();
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    secret: "mySecretKey",
    resave: false,
    saveUninitialized: false,
  })
);

// مسیر دیتابیس‌ها
function getCompanyDb(company) {
  const dbPath = path.join(__dirname, "data", "companies", `${company}.db`);
  const db = new sqlite3.Database(dbPath);

  // فعالسازی کلید خارجی
  db.run("PRAGMA foreign_keys = ON");

  // جدول کاربران
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // جدول کانتینرها (با created_by)
  db.run(`CREATE TABLE IF NOT EXISTS containers (
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
  )`);

  return db;
}

// middleware چک لاگین
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect("/login");
  next();
}

// صفحه ثبت‌نام شرکت جدید
app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { company, username, password } = req.body;
  const db = getCompanyDb(company);

  db.get(`SELECT * FROM users WHERE role = 'owner'`, async (err, existingOwner) => {
    if (err) return res.send("خطا در بررسی مالک: " + err.message);

    if (existingOwner) {
      return res.send("مالک (owner) قبلاً برای این شرکت ثبت شده است.");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'owner')`,
      [username, passwordHash],
      function (err) {
        if (err) return res.send("خطا در ثبت‌نام: " + err.message);

        req.session.userId = this.lastID;
        req.session.company = company;
        req.session.username = username;
        req.session.role = "owner";
        res.redirect("/");
      }
    );
  });
});

// صفحه لاگین
app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", (req, res) => {
  const { company, username, password } = req.body;
  const db = getCompanyDb(company);

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, user) => {
      if (!user) return res.send("کاربر یافت نشد");

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.send("رمز عبور اشتباه است");

      req.session.userId = user.id;
      req.session.company = company;
      req.session.username = user.username;
      req.session.role = user.role;
      res.redirect("/");
    }
  );
});

// صفحه اصلی
app.get("/", requireLogin, (req, res) => {
  const db = getCompanyDb(req.session.company);
  db.all(
    `SELECT c.*, u.username AS created_by_user
     FROM containers c
     LEFT JOIN users u ON c.created_by = u.id`,
    (err, rows) => {
      res.render("index", {
        containers: rows,
        username: req.session.username,
        company: req.session.company,
      });
    }
  );
});
// مدیریت کاربران - فقط owner
app.get("/users", requireLogin, (req, res) => {
  if (req.session.role !== "owner") return res.status(403).send("فقط مدیر دسترسی دارد");

  const db = getCompanyDb(req.session.company);
  db.all("SELECT id, username, role, created_at FROM users", (err, users) => {
    res.render("users", { users });
  });
});

// افزودن کاربر جدید (توسط owner)
app.post("/users/add", requireLogin, (req, res) => {
  if (req.session.role !== "owner") return res.status(403).send("فقط مدیر دسترسی دارد");

  const { username, password } = req.body;
  const db = getCompanyDb(req.session.company);
  bcrypt.hash(password, 10, (err, hash) => {
    db.run(
      "INSERT INTO users (username, password_hash, role) VALUES (?,?,?)",
      [username, hash, "user"],
      (err) => {
        if (err) return res.send("خطا: " + err.message);
        res.redirect("/users");
      }
    );
  });
});

// افزودن ردیف جدید
app.post("/add", requireLogin, (req, res) => {
  const {
    owner,
    entry_date,
    entry_driver_name,
    entry_phone,
    exit_date,
    exit_driver_name,
    exit_phone,
    type,
    container_no,
  } = req.body;

  const db = getCompanyDb(req.session.company);
  db.run(
    `INSERT INTO containers (
      owner, entry_date, driver_name, entry_phone, 
      exit_date, exit_driver_name, exit_phone, 
      type, container_no, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      owner,
      entry_date,
      entry_driver_name,
      entry_phone,
      exit_date,
      exit_driver_name,
      exit_phone,
      type,
      container_no,
      req.session.userId, // 👈 ذخیره‌ی یوزر ثبت‌کننده
    ],
    () => res.redirect("/")
  );
});

// تولید PDF
app.get("/invoice/:id", requireLogin, (req, res) => {
  const id = req.params.id;
  const db = getCompanyDb(req.session.company);

  db.get("SELECT * FROM containers WHERE id = ?", [id], (err, row) => {
    if (!row) return res.send("یافت نشد");

    const doc = new PDFDocument({ size: "A4", margin: 50 });

    // فونت فارسی
    const fontPath = path.join(__dirname, "public", "fonts", "Vazir.ttf");
    doc.registerFont("Vazir", fontPath);
    doc.font("Vazir");

    res.setHeader("Content-disposition", `attachment; filename=factor-${id}.pdf`);
    res.setHeader("Content-type", "application/pdf");

    doc.pipe(res);

    doc.fontSize(18).text(req.session.company, { align: "center" });
    doc.moveDown().fontSize(14).text("فاکتور ورود/خروج کانتینر", { align: "center" });
    doc.moveDown();

    const info = [
      ["صاحب کالا", row.owner],
      ["تاریخ ورود", row.entry_date],
      ["راننده ورود", row.driver_name],
      ["شماره موبایل ورود", row.entry_phone],
      ["تاریخ خروج", row.exit_date],
      ["راننده خروج", row.exit_driver_name],
      ["شماره موبایل خروج", row.exit_phone],
      ["نوع کانتینر", row.type],
      ["شماره کانتینر", row.container_no],
    ];

    info.forEach(([label, value]) => {
      doc.rect(50, doc.y, 200, 25).stroke().text(label, 55, doc.y + 5);
      doc.rect(250, doc.y, 300, 25).stroke().text(value || "-", 255, doc.y + 5);
      doc.moveDown(1.2);
    });

    doc.end();
  });
});
// خروج
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000/");
});
