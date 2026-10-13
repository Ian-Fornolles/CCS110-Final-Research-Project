require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const DB_CONFIG = {
  host: 'localhost',
  port: 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: 'computerRentaldb',
  dateStrings: true,        // return DATETIME as 'YYYY-MM-DD HH:MM:SS' strings
  waitForConnections: true,
  connectionLimit: 10
};
const PORT = 3000;
const TABLES = {
  customers:   ['customer_id', 'customer_name', 'contact_number', 'email', 'age'],
  computers:   ['computer_id', 'computer_type', 'hourly_rate', 'computer_status'],
  staff:       ['staff_id', 'staff_name', 'contact_number', 'email'],
  sessions:    ['session_id', 'customer_id', 'computer_id', 'start_time', 'end_time', 'hours_used'],
  billing:     ['bill_id', 'session_id', 'staff_id', 'hours_used', 'hourly_rate', 'total_amount', 'payment_method', 'payment_status'],
  reservation: ['reservation_id', 'reservation_date', 'customer_id', 'computer_id', 'start_time', 'end_time', 'reservation_status']
};

const pool = mysql.createPool(DB_CONFIG);
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));   // serves public/index.html
app.get('/api/data', async (req, res) => {
  try {
    const data = {};
    for (const table of Object.keys(TABLES)) {
      const [rows] = await pool.query(`SELECT * FROM ${table}`);
      data[table] = rows;
    }
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/data', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const table of Object.keys(TABLES).reverse()) {
      await conn.query(`DELETE FROM ${table}`);
    }
    for (const [table, cols] of Object.entries(TABLES)) {
      const rows = req.body[table];
      if (!Array.isArray(rows) || !rows.length) continue;
      const values = rows.map(r => cols.map(c => r[c] ?? null));
      await conn.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ?`, [values]);
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.listen(PORT, () => console.log(`UNITY running at http://localhost:${PORT}`));
