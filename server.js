const express = require('express');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_PATH = path.join(DATA_DIR, 'bookings.json');

// Ensure data directory exists (important on Render)
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── helpers ──────────────────────────────────────────────────────────────────

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // Environment variables override config.json (used on Render)
  if (process.env.SMTP_USER)       cfg.smtp.user           = process.env.SMTP_USER;
  if (process.env.SMTP_PASS)       cfg.smtp.pass           = process.env.SMTP_PASS;
  if (process.env.SMTP_HOST)       cfg.smtp.host           = process.env.SMTP_HOST;
  if (process.env.ADMIN_EMAIL)     cfg.admin.email         = process.env.ADMIN_EMAIL;
  if (process.env.ADMIN_PASSWORD)  cfg.admin.password      = process.env.ADMIN_PASSWORD;
  return cfg;
}
function loadBookings() {
  try { return JSON.parse(fs.readFileSync(BOOKINGS_PATH, 'utf8')); }
  catch { return []; }
}
function saveBookings(b) {
  fs.writeFileSync(BOOKINGS_PATH, JSON.stringify(b, null, 2));
}

const FREE_STATUSES = ['rejected', 'declined', 'cancelled'];

function isSlotTaken(bookings, date, time) {
  return bookings.some(b => b.date === date && b.time === time && !FREE_STATUSES.includes(b.status));
}

function createTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.pass }
  });
}

async function sendEmail(cfg, to, subject, html) {
  try {
    await createTransport(cfg).sendMail({
      from: `"Nails by Sophie" <${cfg.smtp.user}>`, to, subject, html
    });
  } catch (e) { console.warn('Email failed:', e.message); }
}

function fmtDT(date, time) {
  const d = new Date(date + 'T00:00:00');
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h = ((time + 11) % 12) + 1;
  const ap = time < 12 ? 'AM' : 'PM';
  return `${days[d.getDay()]} ${mons[d.getMonth()]} ${d.getDate()} at ${h}:00 ${ap}`;
}

function servicesList(services) {
  return Array.isArray(services) ? services.join(', ') : String(services || '');
}

const ADMIN_LINK = `<a href="http://nailsbysophie.critterlabs.io" style="display:inline-block;margin-top:14px;background:#FF5DA2;color:#fff;padding:10px 22px;border-radius:999px;text-decoration:none;font-weight:700">Open Admin ↗</a>`;

// ── GET /api/availability ─────────────────────────────────────────────────────

app.get('/api/availability', (req, res) => {
  const cfg = loadConfig();
  const bookings = loadBookings();
  const avail = cfg.business.availability;
  const now = Date.now();
  const result = [];
  const today = new Date(); today.setHours(0,0,0,0);

  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dow = String(d.getDay());
    if (!avail[dow]) continue;
    const dateStr = d.toISOString().split('T')[0];
    const slots = avail[dow].map(hour => {
      const slotTs = new Date(d); slotTs.setHours(hour, 0, 0, 0);
      const past = slotTs.getTime() < now;
      return { time: hour, available: !past && !isSlotTaken(bookings, dateStr, hour) };
    });
    result.push({ date: dateStr, slots });
  }
  res.json(result);
});

// ── POST /api/bookings — create ───────────────────────────────────────────────

app.post('/api/bookings', async (req, res) => {
  const { name, phone, email, services, date, time, total } = req.body;
  if (!name || !email || !services?.length || !date || time == null)
    return res.status(400).json({ error: 'Missing required fields' });

  const cfg = loadConfig();
  const bookings = loadBookings();
  if (isSlotTaken(bookings, date, time))
    return res.status(409).json({ error: 'Time slot already taken' });

  const booking = {
    id: uuidv4(), name, phone, email, services, date, time, total,
    status: 'pending', messages: [], proposedSlots: [],
    createdAt: new Date().toISOString()
  };
  bookings.push(booking);
  saveBookings(bookings);

  await sendEmail(cfg, cfg.admin.email, `📅 New booking from ${name}`,
    `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="color:#FF5DA2">New booking request 💅</h2>
      <p><b>Name:</b> ${name}</p><p><b>Phone:</b> ${phone||'—'}</p>
      <p><b>Email:</b> ${email}</p><p><b>Services:</b> ${servicesList(services)}</p>
      <p><b>Total:</b> ₪${total}</p><p><b>When:</b> ${fmtDT(date,time)}</p>
      ${ADMIN_LINK}
    </div>`);

  res.status(201).json({ id: booking.id });
});

// ── GET /api/bookings/:id — single booking (public) ──────────────────────────

app.get('/api/bookings/:id', (req, res) => {
  const b = loadBookings().find(b => b.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json(b);
});

// ── GET /api/bookings — all bookings (admin) ──────────────────────────────────

app.get('/api/bookings', (req, res) => {
  const cfg = loadConfig();
  if (req.query.adminKey !== cfg.admin.password)
    return res.status(401).json({ error: 'Unauthorized' });
  res.json(loadBookings());
});

// ── PATCH /api/bookings/:id/approve (admin) ───────────────────────────────────

app.patch('/api/bookings/:id/approve', async (req, res) => {
  const cfg = loadConfig();
  if (req.body.adminKey !== cfg.admin.password)
    return res.status(401).json({ error: 'Unauthorized' });
  const bookings = loadBookings();
  const b = bookings.find(b => b.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });

  b.status = 'approved'; b.approvedAt = new Date().toISOString();
  saveBookings(bookings);

  await sendEmail(cfg, b.email, `✅ Confirmed – Nails by Sophie`,
    `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="color:#FF5DA2">You're booked! 💅</h2>
      <p>Hi ${b.name}, your appointment is confirmed.</p>
      <div style="background:#fff0f8;border-radius:14px;padding:16px;margin:16px 0">
        <p><b>Services:</b> ${servicesList(b.services)}</p>
        <p><b>When:</b> ${fmtDT(b.date,b.time)}</p>
        <p><b>Total:</b> ₪${b.total}</p>
      </div>
      <p>See you soon! 💗 — Sophie</p>
    </div>`);

  res.json(b);
});

// ── PATCH /api/bookings/:id/reject — decline (admin) ─────────────────────────

app.patch('/api/bookings/:id/reject', async (req, res) => {
  const cfg = loadConfig();
  if (req.body.adminKey !== cfg.admin.password)
    return res.status(401).json({ error: 'Unauthorized' });
  const bookings = loadBookings();
  const b = bookings.find(b => b.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });

  b.status = 'declined'; b.declinedAt = new Date().toISOString();
  saveBookings(bookings);

  await sendEmail(cfg, b.email, `About your booking – Nails by Sophie`,
    `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="color:#FF5DA2">Booking update</h2>
      <p>Hi ${b.name}, Sophie is unfortunately not available for ${fmtDT(b.date,b.time)}.</p>
      <p>Please visit the site to pick a different time. Sorry for any inconvenience! 💗 — Sophie</p>
    </div>`);

  res.json(b);
});

// ── PATCH /api/bookings/:id/propose — suggest times (admin) ──────────────────

app.patch('/api/bookings/:id/propose', async (req, res) => {
  const cfg = loadConfig();
  if (req.body.adminKey !== cfg.admin.password)
    return res.status(401).json({ error: 'Unauthorized' });
  const { proposedSlots } = req.body;
  if (!proposedSlots?.length)
    return res.status(400).json({ error: 'No slots provided' });

  const bookings = loadBookings();
  const b = bookings.find(b => b.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });

  b.status = 'proposed'; b.proposedSlots = proposedSlots;
  b.proposedAt = new Date().toISOString();
  saveBookings(bookings);

  const slotLines = proposedSlots.map(s => `<li>${fmtDT(s.date, s.time)}</li>`).join('');
  await sendEmail(cfg, b.email, `Sophie suggested new times – Nails by Sophie`,
    `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="color:#FF5DA2">New times suggested 💅</h2>
      <p>Hi ${b.name}, Sophie has some alternative options for you:</p>
      <ul>${slotLines}</ul>
      <p>Visit the site to pick one: <a href="http://nailsbysophie.critterlabs.io">nailsbysophie.critterlabs.io</a></p>
      <p>💗 — Sophie</p>
    </div>`);

  res.json(b);
});

// ── PATCH /api/bookings/:id/accept-proposed — client picks a slot ─────────────

app.patch('/api/bookings/:id/accept-proposed', async (req, res) => {
  const cfg = loadConfig();
  const { date, time } = req.body;
  const bookings = loadBookings();
  const b = bookings.find(b => b.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'proposed') return res.status(400).json({ error: 'Not in proposed state' });

  b.date = date; b.time = time; b.status = 'pending'; b.proposedSlots = [];
  saveBookings(bookings);

  await sendEmail(cfg, cfg.admin.email, `${b.name} picked a new time`,
    `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="color:#FF5DA2">${b.name} picked a new time 📅</h2>
      <p><b>New slot:</b> ${fmtDT(date, time)}</p>${ADMIN_LINK}
    </div>`);

  res.json(b);
});

// ── PATCH /api/bookings/:id/cancel — client cancels ──────────────────────────

app.patch('/api/bookings/:id/cancel', async (req, res) => {
  const cfg = loadConfig();
  const bookings = loadBookings();
  const b = bookings.find(b => b.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });

  b.status = 'cancelled'; b.cancelledAt = new Date().toISOString();
  saveBookings(bookings);

  await sendEmail(cfg, cfg.admin.email, `${b.name} cancelled their booking`,
    `<div style="font-family:sans-serif;max-width:520px">
      <h2 style="color:#FF5DA2">Booking cancelled</h2>
      <p>${b.name} declined all proposed times. Original slot: ${fmtDT(b.date, b.time)}.</p>
    </div>`);

  res.json(b);
});

// ── POST /api/bookings/:id/message — client or admin ─────────────────────────

app.post('/api/bookings/:id/message', async (req, res) => {
  const cfg = loadConfig();
  const { adminKey, message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message' });

  const bookings = loadBookings();
  const b = bookings.find(b => b.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });

  const isAdmin = adminKey === cfg.admin.password;
  const from = isAdmin ? 'sophie' : 'client';
  b.messages.push({ from, text: message, ts: new Date().toISOString() });
  saveBookings(bookings);

  if (isAdmin) {
    await sendEmail(cfg, b.email, `Message from Sophie – Nails by Sophie`,
      `<div style="font-family:sans-serif;max-width:520px">
        <h2 style="color:#FF5DA2">Message from Sophie 💅</h2>
        <p>Hi ${b.name},</p>
        <div style="background:#fff0f8;border-radius:14px;padding:16px">${message}</div>
        <p>💗 — Sophie</p>
      </div>`);
  } else {
    await sendEmail(cfg, cfg.admin.email, `Message from ${b.name}`,
      `<div style="font-family:sans-serif;max-width:520px">
        <h2 style="color:#FF5DA2">Message from ${b.name}</h2>
        <p><b>Appointment:</b> ${fmtDT(b.date, b.time)}</p>
        <div style="background:#e2f6fd;border-radius:14px;padding:16px">${message}</div>
        ${ADMIN_LINK}
      </div>`);
  }

  res.json({ ok: true, from });
});

// ── start ─────────────────────────────────────────────────────────────────────

const cfg = loadConfig();
const PORT = process.env.PORT || cfg.port || 3000;
app.listen(PORT, () => console.log(`💅 Nails by Sophie → http://localhost:${PORT}`));
