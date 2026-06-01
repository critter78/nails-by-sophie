# 💅 Nails by Sophie – Booking System

A complete home-nail-business booking system with customer-facing booking page, admin dashboard, email notifications, and English/Hebrew support.

---

## Quick Start (Local)

```bash
# 1. Install dependencies
cd "Nails by Sophie"
npm install

# 2. Configure email (see below)
# 3. Start the server
npm start
# → http://localhost:3000
```

---

## Email Configuration (`config.json`)

Open `config.json` and fill in your email credentials:

```json
"smtp": {
  "host": "smtp.gmail.com",
  "port": 587,
  "secure": false,
  "user": "your.gmail@gmail.com",
  "pass": "your-app-password"
}
```

### Gmail Setup (recommended)
1. Go to Google Account → Security → 2-Step Verification (enable it)
2. Go to **App Passwords** → create one for "Mail"
3. Paste the 16-character password into `config.json`

Also update `admin.email` to the address where Sophie should receive booking alerts.

---

## Admin Panel

Visit: `http://yourdomain/admin`  
Default password: `sophie2026`  
**Change this in `config.json` → `admin.password`**

### What Sophie can do in the admin:
- See all pending / approved / rejected bookings
- **Approve** a booking → client gets a confirmation email automatically
- **Decline** a booking → optionally suggest an alternative date/time → client is emailed
- **Message** an approved client (e.g. reminders, address, prep tips)
- Switch to **Calendar view** to see all bookings on a monthly grid

---

## Deploying to `nailsbysophie.critterlabs.io`

### Option A – Any VPS (DigitalOcean, Linode, Hetzner)

```bash
# On your server
git clone <your-repo> nails-by-sophie
cd nails-by-sophie
npm install --production
npm install -g pm2
pm2 start server.js --name nails-by-sophie
pm2 save && pm2 startup
```

Then in Nginx:
```nginx
server {
    server_name nailsbysophie.critterlabs.io;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

Add SSL with: `sudo certbot --nginx -d nailsbysophie.critterlabs.io`

### Option B – Railway.app (easiest, free tier available)

1. Push this folder to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Set environment variable: `PORT=3000`
4. Add a custom domain: `nailsbysophie.critterlabs.io`
5. Add a CNAME record in your DNS: `nailsbysophie → your-railway-app.railway.app`

### Option C – Render.com (also free tier)

Same as Railway — connect GitHub, set PORT, add custom domain.

---

## Customizing Availability

Edit `config.json` → `business.availability`:
- Keys are day-of-week numbers (0=Sunday, 6=Saturday)
- `slots` is an array of times in `"HH:MM"` format
- Remove a day entirely to mark it as unavailable

---

## File Structure

```
Nails by Sophie/
├── server.js          ← Express server + API
├── config.json        ← Email, admin password, business hours
├── package.json
├── data/
│   └── bookings.json  ← All bookings (auto-created)
└── public/
    ├── index.html     ← Customer booking page
    └── admin.html     ← Sophie's admin dashboard
```

---

Made with 💗 for Sophie's nail business!
