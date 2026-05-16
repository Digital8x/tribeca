const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const UAParser = require('ua-parser-js');
const emailValidator = require('email-validator');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const { google } = require('googleapis');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const JWT_SECRET = 'tribeca-everett-secret-' + Date.now();

// MySQL Configuration
const dbConfig = {
  host: 'localhost', // Assuming localhost for cPanel
  user: 'a1679hju_tribeca',
  password: 'ArjunEswar',
  database: 'a1679hju_tribeca'
};

let pool;

// Initialize Database
async function initDB() {
  try {
    pool = mysql.createPool(dbConfig);
    const connection = await pool.getConnection();
    console.log('Connected to MySQL database');
    
    await connection.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(100),
        source VARCHAR(100),
        configuration VARCHAR(100),
        device VARCHAR(100),
        browser VARCHAR(100),
        ip VARCHAR(45),
        city VARCHAR(100),
        country VARCHAR(100),
        status VARCHAR(20) DEFAULT 'New',
        notes TEXT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    connection.release();
  } catch (err) {
    console.error('Database initialization failed:', err.message);
  }
}

initDB();

// Ensure data directory (for config)
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    admin: { username: 'admin', password: bcrypt.hashSync('admin123', 10) },
    smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: '', to: '' },
    sheets: { enabled: false, spreadsheetId: '', range: 'Sheet1!A1', credentials: {} }
  }, null, 2));
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(__dirname));

// Helpers
function getConfig() { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
function saveConfig(cfg) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); }

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }
}

// Device Parsing
function getDeviceLabel(ua) {
  const parser = new UAParser(ua);
  const device = parser.getDevice();
  const os = parser.getOS();
  
  if (device.type === 'mobile') {
    if (os.name === 'Android') return 'Android Mobile';
    if (os.name === 'iOS') return 'iPhone (iOS)';
    return 'Mobile';
  }
  if (device.type === 'tablet') {
    if (os.name === 'Android') return 'Android Tablet';
    if (os.name === 'iOS') return 'iPad / Tablet (iOS)';
    return 'Tablet';
  }
  if (os.name === 'Windows') return 'Windows Desktop';
  if (os.name === 'Mac OS') return 'Mac Desktop';
  return 'Desktop';
}

// Browser Parsing
function getBrowserLabel(ua) {
  const parser = new UAParser(ua);
  const browser = parser.getBrowser();
  const known = ['Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung Internet', 'Opera'];
  if (known.includes(browser.name)) return browser.name;
  return 'Other';
}

// Google Sheets Helper
async function appendToSheet(lead) {
  const config = getConfig();
  if (!config.sheets || !config.sheets.enabled || !config.sheets.credentials || !config.sheets.spreadsheetId) return;

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: config.sheets.credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const spreadsheetId = config.sheets.spreadsheetId;
    const mapping = config.sheets.mapping || {};

    // 1. If mapping exists, use it. If not, fallback to auto-detecting headers.
    if (Object.keys(mapping).length > 0 && Object.values(mapping).some(v => v)) {
      // Find the maximum column letter used (e.g. 'H' -> 7)
      const colToIdx = (col) => {
        let res = 0;
        for (let i = 0; i < col.length; i++) res = res * 26 + col.charCodeAt(i) - 64;
        return res - 1;
      };

      const maxIdx = Math.max(...Object.values(mapping).filter(v => v).map(colToIdx));
      const row = new Array(maxIdx + 1).fill('');

      if (mapping.id) row[colToIdx(mapping.id)] = lead.id;
      if (mapping.name) row[colToIdx(mapping.name)] = lead.name;
      if (mapping.phone) row[colToIdx(mapping.phone)] = lead.phone;
      if (mapping.email) row[colToIdx(mapping.email)] = lead.email;
      if (mapping.source) row[colToIdx(mapping.source)] = lead.source;
      if (mapping.configuration) row[colToIdx(mapping.configuration)] = lead.configuration;
      if (mapping.location) row[colToIdx(mapping.location)] = `${lead.city}, ${lead.country}`;
      if (mapping.date) row[colToIdx(mapping.date)] = new Date(lead.date).toLocaleString('en-IN');

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: config.sheets.range || 'Sheet1!A1',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [row] },
      });
      return;
    }

    // FALLBACK: Smart Header Auto-Detection (if no manual mapping)
    const sheets = google.sheets({ version: 'v4', auth });
    const range = config.sheets.range || 'Sheet1!A1:Z1';
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const headers = response.data.values ? response.data.values[0] : [];

    if (headers.length === 0) {
      // If sheet is empty, use default order
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            lead.id, lead.name, lead.phone, lead.email, lead.source, lead.configuration,
            lead.device, lead.browser, lead.ip, lead.city, lead.country, lead.status, lead.date
          ]],
        },
      });
      return;
    }

    // 2. Map lead data to headers
    const row = headers.map(header => {
      const h = header.toLowerCase().trim();
      if (h.includes('id')) return lead.id;
      if (h.includes('name')) return lead.name;
      if (h.includes('phone') || h.includes('mobile') || h.includes('contact')) return lead.phone;
      if (h.includes('email')) return lead.email;
      if (h.includes('source')) return lead.source;
      if (h.includes('config') || h.includes('flat') || h.includes('type')) return lead.configuration;
      if (h.includes('device')) return lead.device;
      if (h.includes('browser')) return lead.browser;
      if (h.includes('ip')) return lead.ip;
      if (h.includes('city')) return lead.city;
      if (h.includes('country')) return lead.country;
      if (h.includes('status')) return lead.status;
      if (h.includes('date') || h.includes('time')) return new Date(lead.date).toLocaleString('en-IN');
      return '';
    });

    // 3. Append the mapped row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: config.sheets.range || 'Sheet1!A1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] },
    });
  } catch (err) {
    console.error('Google Sheets error:', err.message);
  }
}

// === PUBLIC API ===

// Submit lead
app.post('/api/leads', async (req, res) => {
  const { name, phone, email, source, config: cfg } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });

  // Basic Validation
  if (email && !emailValidator.validate(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const phoneNumber = parsePhoneNumberFromString(phone);
  if (!phoneNumber || !phoneNumber.isValid()) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  // Get IP and Location
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '8.8.8.8'; // Test fallback

  let geo = { country: 'Unknown', city: 'Unknown', proxy: false };
  try {
    const geoRes = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,city,proxy,hosting,query`);
    if (geoRes.data.status === 'success') {
      geo = geoRes.data;
      // Removed VPN/Proxy blocking as requested
    }
  } catch (err) {
    console.error('Geo lookup failed:', err.message);
  }

  const ua = req.headers['user-agent'] || '';
  const lead = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    name, phone, email: email || '',
    source: source || 'Website',
    configuration: cfg || '',
    device: getDeviceLabel(ua),
    browser: getBrowserLabel(ua),
    ip: ip,
    city: geo.city,
    country: geo.country,
    date: new Date().toISOString()
  };

  try {
    if (pool) {
      await pool.query(
        'INSERT INTO leads (id, name, phone, email, source, configuration, device, browser, ip, city, country, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [lead.id, lead.name, lead.phone, lead.email, lead.source, lead.configuration, lead.device, lead.browser, lead.ip, lead.city, lead.country, lead.date]
      );
    }
  } catch (err) {
    console.warn('⚠️ Database save failed (local test mode):', err.message);
  }

  // Always attempt integrations (Google Sheets & Email)
  try {
    appendToSheet({...lead, status: 'New'});

    const config = getConfig();
    if (config.smtp.host && config.smtp.user && config.smtp.to) {
       const transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: { user: config.smtp.user, pass: config.smtp.pass }
      });
      await transporter.sendMail({
        from: config.smtp.from || config.smtp.user,
        to: config.smtp.to,
        subject: `🏠 New Lead: ${lead.name} - Tribeca The Everett`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#f5f0e8;padding:30px;border:1px solid #C9A84C;">
            <h2 style="color:#C9A84C;border-bottom:1px solid #333;padding-bottom:15px;">🏠 New Lead Received</h2>
            <table style="width:100%;border-collapse:collapse;margin-top:15px;">
              <tr><td style="padding:10px;color:#a09a8c;width:120px;">Name</td><td style="padding:10px;color:#f5f0e8;font-weight:bold;">${lead.name}</td></tr>
              <tr><td style="padding:10px;color:#a09a8c;">Phone</td><td style="padding:10px;color:#f5f0e8;font-weight:bold;">${lead.phone}</td></tr>
              <tr><td style="padding:10px;color:#a09a8c;">Email</td><td style="padding:10px;color:#f5f0e8;">${lead.email || 'N/A'}</td></tr>
              <tr><td style="padding:10px;color:#a09a8c;">Location</td><td style="padding:10px;color:#f5f0e8;">${lead.city}, ${lead.country}</td></tr>
              <tr><td style="padding:10px;color:#a09a8c;">Source</td><td style="padding:10px;color:#C9A84C;">${lead.source}</td></tr>
              <tr><td style="padding:10px;color:#a09a8c;">Date</td><td style="padding:10px;color:#f5f0e8;">${new Date(lead.date).toLocaleString('en-IN')}</td></tr>
            </table>
          </div>`
      });
    }
    res.json({ success: true, message: 'Thank you! Our team will contact you shortly.' });
  } catch (err) {
    console.error('Integration error:', err.message);
    res.status(500).json({ error: 'Failed to send lead notifications.' });
  }
});

// === ADMIN API ===

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const config = getConfig();
  if (username !== config.admin.username || !bcrypt.compareSync(password, config.admin.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
  res.cookie('token', token, { httpOnly: true, maxAge: 86400000 });
  res.json({ success: true, token });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/admin/check', authMiddleware, (req, res) => {
  res.json({ authenticated: true, user: req.user.username });
});

app.get('/api/admin/leads', authMiddleware, async (req, res) => {
  const { status, search, from, to } = req.query;
  let query = 'SELECT * FROM leads WHERE 1=1';
  let params = [];

  if (status && status !== 'all') {
    query += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    query += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (from) {
    query += ' AND date >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND date <= ?';
    params.push(to + ' 23:59:59');
  }

  query += ' ORDER BY date DESC';

  try {
    const [rows] = await pool.query(query, params);
    const [totalRows] = await pool.query('SELECT COUNT(*) as count FROM leads');
    res.json({ leads: rows, total: totalRows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/leads/:id', authMiddleware, async (req, res) => {
  let updates = [];
  let params = [];
  if (req.body.status) {
    updates.push('status = ?');
    params.push(req.body.status);
  }
  if (req.body.notes !== undefined) {
    updates.push('notes = ?');
    params.push(req.body.notes);
  }
  
  if (updates.length === 0) return res.json({ success: true });
  
  params.push(req.params.id);
  try {
    await pool.query(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/leads/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/leads/export/csv', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM leads ORDER BY date DESC');
    const header = 'ID,Name,Phone,Email,Source,Configuration,Device,Browser,IP,City,Country,Status,Date,Notes\n';
    const csv = rows.map(l =>
      `"${l.id}","${l.name}","${l.phone}","${l.email}","${l.source}","${l.configuration || ''}","${l.device}","${l.browser}","${l.ip}","${l.city}","${l.country}","${l.status}","${new Date(l.date).toLocaleString('en-IN')}","${(l.notes || '').replace(/"/g, '""')}"`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=tribeca-leads-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(header + csv);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/admin/smtp', authMiddleware, (req, res) => {
  const config = getConfig();
  res.json({ smtp: { ...config.smtp, pass: config.smtp.pass ? '••••••••' : '' } });
});

app.post('/api/admin/smtp', authMiddleware, (req, res) => {
  const config = getConfig();
  const { host, port, secure, user, pass, from, to } = req.body;
  config.smtp = { host, port: parseInt(port) || 587, secure: secure === true || secure === 'true', user, pass: pass === '••••••••' ? config.smtp.pass : pass, from, to };
  saveConfig(config);
  res.json({ success: true });
});

app.get('/api/admin/sheets', authMiddleware, (req, res) => {
  const config = getConfig();
  res.json({ sheets: config.sheets || { enabled: false } });
});

app.post('/api/admin/sheets', authMiddleware, (req, res) => {
  const config = getConfig();
  const { enabled, spreadsheetId, range, credentials, mapping } = req.body;
  config.sheets = { 
    enabled: enabled === true || enabled === 'true', 
    spreadsheetId, 
    range: range || 'Sheet1!A1', 
    credentials: typeof credentials === 'string' ? JSON.parse(credentials) : credentials,
    mapping: mapping || {}
  };
  saveConfig(config);
  res.json({ success: true });
});

app.post('/api/admin/password', authMiddleware, (req, res) => {
  const { current, newPassword } = req.body;
  const config = getConfig();
  if (!bcrypt.compareSync(current, config.admin.password)) return res.status(400).json({ error: 'Current password is incorrect' });
  config.admin.password = bcrypt.hashSync(newPassword, 10);
  saveConfig(config);
  res.json({ success: true });
});

app.get('/api/admin/stats', authMiddleware, async (req, res) => {
  try {
    const [totalRows] = await pool.query('SELECT COUNT(*) as count FROM leads');
    const today = new Date().toISOString().split('T')[0];
    const [todayRows] = await pool.query('SELECT COUNT(*) as count FROM leads WHERE date >= ?', [today]);
    
    const [statusRows] = await pool.query('SELECT status, COUNT(*) as count FROM leads GROUP BY status');
    const statusCounts = {};
    statusRows.forEach(row => { statusCounts[row.status] = row.count; });

    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const [dayRows] = await pool.query('SELECT COUNT(*) as count FROM leads WHERE date >= ? AND date <= ?', [ds, ds + ' 23:59:59']);
      last7.push({ date: ds, count: dayRows[0].count });
    }
    
    res.json({ total: totalRows[0].count, today: todayRows[0].count, statusCounts, last7 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });

app.listen(PORT, () => {
  console.log(`\n  ✨ Tribeca The Everett - Lead Generation Server`);
  console.log(`  🌐 Website:  http://localhost:${PORT}`);
  console.log(`  🔐 Admin:    http://localhost:${PORT}/admin`);
});
