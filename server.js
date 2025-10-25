const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
import { v4 as uuidv4 } from 'uuid';
const { MongoClient } = require('mongodb');

dotenv.config();

const PORT = process.env.PORT || 3000;
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'db.json');
const qrDir = path.join(__dirname, 'public', 'qrcodes');

function ensureDirs() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(path.join(__dirname, 'public'))) fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
  if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });
}

function loadDB() {
  if (!fs.existsSync(dbFile)) {
    const initial = {
      visitors: [],
      scans: [],
      stalls: [
        { id: 'A', name: 'STALL A', access_code: 'stallA2025' },
        { id: 'B', name: 'STALL B', access_code: 'stallB2025' }
      ]
    };
    fs.writeFileSync(dbFile, JSON.stringify(initial, null, 2));
  }
  return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

ensureDirs();
let db = loadDB();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/stalls', (req, res) => {
  res.json(db.stalls.map(s => ({ id: s.id, name: s.name })));
});

// List registered visitors
app.get('/api/visitors', (req, res) => {
  const visitors = db.visitors.map(v => {
    const vScans = db.scans.filter(s => s.visitor_id === v.id);
    const stallIds = [...new Set(vScans.map(s => s.stall_id))];
    return {
      id: v.id,
      name: v.name,
      email: v.email,
      registered_at: v.registered_at,
      email_status: v.email_status,
      scans_count: vScans.length,
      stalls: stallIds
    };
  }).sort((a, b) => new Date(b.registered_at) - new Date(a.registered_at));
  res.json(visitors);
});

// Dashboard stats
app.get('/api/stats', (req, res) => {
  const totalVisitors = db.visitors.length;
  const emailsSent = db.visitors.filter(v => v.email_status === 'sent').length;
  const totalScans = db.scans.length;
  const stalls = db.stalls.map(s => {
    const scansForStall = db.scans.filter(sc => sc.stall_id === s.id);
    const uniqueVisitors = new Set(scansForStall.map(sc => sc.visitor_id));
    return { id: s.id, name: s.name, scans: scansForStall.length, unique_visitors: uniqueVisitors.size };
  });
  const recentVisitors = db.visitors
    .slice()
    .sort((a, b) => new Date(b.registered_at) - new Date(a.registered_at))
    .slice(0, 10)
    .map(v => ({ id: v.id, name: v.name, email: v.email, registered_at: v.registered_at, email_status: v.email_status }));
  res.json({ totalVisitors, emailsSent, totalScans, stalls, recentVisitors });
});

async function getTransporter() {
  if (String(process.env.USE_ETHEREAL).toLowerCase() === 'true') {
    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass }
    });
  }
  // SMTP from env
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    logger: String(process.env.SMTP_LOGGER).toLowerCase() === 'true',
    debug: String(process.env.SMTP_DEBUG).toLowerCase() === 'true'
  });
}

function eventEmailHTML(visitor, qrCid) {
  const artworkUrl = process.env.ARTWORK_URL || '';
  const eventName = process.env.EVENT_NAME || 'Event';
  const date = process.env.EVENT_DATE || '';
  const venue = process.env.EVENT_VENUE || '';
  const time = process.env.EVENT_TIME || '';

  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.5; max-width: 640px; margin: 0 auto; color: #222;">
    <p>Dear ${visitor.name},</p>
    <p>Thank you for your registration for <strong>${eventName}</strong>!</p>
    <p>We’re excited to welcome you to our upcoming event. Please find your QR code below, which will be scanned upon entry.</p>

    <div style="border:1px solid #eee; padding:16px; border-radius:8px; margin:16px 0;">
      <p>📅 <strong>Date:</strong> ${date}</p>
      <p>📍 <strong>Venue:</strong> ${venue}</p>
      <p>🕘 <strong>Time:</strong> ${time}</p>
    </div>

    <div style="text-align:center; margin:20px 0;">
      <img src="cid:${qrCid}" alt="Your QR Code" style="width:240px; height:240px;"/>
      <p style="font-size:12px; color:#555;">Please show this QR code at entry and at any stall within the event.</p>
      <p style="font-size:12px; color:#555;">If the image does not load, open this link to your QR: ${APP_BASE_URL}/qrcodes/${visitor.id}.png</p>
    </div>

    ${artworkUrl ? `<p>The artwork can be retrieved from the link shared: <a href="${artworkUrl}">${artworkUrl}</a></p>` : ''}

    <p>Please note these QR codes will also be scanned by the STALL HOSTS within the event.</p>

    <p>We look forward to seeing you there!</p>

    <p style="margin-top:24px; color:#555; font-size:12px;">If you did not register for this event, please ignore this email.</p>
  </div>
  `;
}

function eventEmailText(visitor) {
  const eventName = process.env.EVENT_NAME || 'Event';
  const date = process.env.EVENT_DATE || '';
  const venue = process.env.EVENT_VENUE || '';
  const time = process.env.EVENT_TIME || '';
  return `Dear ${visitor.name},\n\nThank you for your registration for ${eventName}!\n\nDate: ${date}\nVenue: ${venue}\nTime: ${time}\n\nYour QR code is attached to this email. Please show it at entry and at any stall within the event.\n\nWe look forward to seeing you there!`;
}

let mongo = { client: null, db: null, enabled: false };
async function initMongo() {
  try {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB || 'vms';
    if (!uri) { console.log('MongoDB not configured (MONGODB_URI missing). Skipping.'); return; }
    mongo.client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await mongo.client.connect();
    mongo.db = mongo.client.db(dbName);
    mongo.enabled = true;
    await mongo.db.collection('visitors').createIndex({ email: 1 });
    await mongo.db.collection('scans').createIndex({ visitor_id: 1, stall_id: 1 }, { unique: true });
    console.log('MongoDB connected:', dbName);
  } catch (err) {
    console.error('Mongo init error', err);
  }
}
initMongo();

app.post('/api/register', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });

  const id = uuidv4();
  const qrText = `VMS:${id}`;
  try {
    const qrPng = await QRCode.toBuffer(qrText, { type: 'png', width: 600 });
    const qrPath = path.join(qrDir, `${id}.png`);
    fs.writeFileSync(qrPath, qrPng);

    const visitor = {
      id,
      name,
      email,
      registered_at: new Date().toISOString(),
      email_status: 'pending'
    };
    db.visitors.push(visitor);
    saveDB(db);

    if (mongo.enabled) {
      await mongo.db.collection('visitors').insertOne({ ...visitor, qr_path: qrPath });
    }

    const transporter = await getTransporter();

    let info = null;
    let previewUrl = null;

    // Verify SMTP connection before sending, but do not fail registration
    try {
      await transporter.verify();
    } catch (verr) {
      const vIndex = db.visitors.findIndex(v => v.id === id);
      if (vIndex !== -1) {
        db.visitors[vIndex].email_status = 'failed';
        db.visitors[vIndex].email_error = String(verr);
        saveDB(db);
      }
      if (mongo.enabled) {
        await mongo.db.collection('visitors').updateOne({ id }, { $set: { email_status: 'failed', email_error: String(verr) } });
      }
      console.error('SMTP verify failed:', verr);
      // Continue without throwing; registration should still succeed
    }

    const qrCid = 'visitor-qr';
    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'Event <noreply@example.com>',
      to: email,
      subject: `Your QR Code for ${process.env.EVENT_NAME || 'Event'}`,
      text: eventEmailText(visitor),
      html: eventEmailHTML(visitor, qrCid),
      replyTo: process.env.SMTP_REPLY_TO || undefined,
      attachments: [ { filename: 'qr.png', path: qrPath, cid: qrCid } ]
    };

    // Only attempt to send if previous verify did not mark failure
    const vCheck = db.visitors.findIndex(v => v.id === id);
    const alreadyFailed = vCheck !== -1 && db.visitors[vCheck].email_status === 'failed';

    if (!alreadyFailed) {
      try {
        info = await transporter.sendMail(mailOptions);
        // Update email status to sent
        const vIndex = db.visitors.findIndex(v => v.id === id);
        if (vIndex !== -1) {
          db.visitors[vIndex].email_status = 'sent';
          db.visitors[vIndex].email_message_id = info.messageId;
          saveDB(db);
        }
        if (mongo.enabled) {
          await mongo.db.collection('visitors').updateOne({ id }, { $set: { email_status: 'sent', email_message_id: info.messageId } });
        }
      } catch (sendErr) {
        const vIndexFail = db.visitors.findIndex(v => v.id === id);
        if (vIndexFail !== -1) {
          db.visitors[vIndexFail].email_status = 'failed';
          db.visitors[vIndexFail].email_error = String(sendErr);
          saveDB(db);
        }
        if (mongo.enabled) {
          await mongo.db.collection('visitors').updateOne({ id }, { $set: { email_status: 'failed', email_error: String(sendErr) } });
        }
        console.error('SMTP send failed:', sendErr);
        // Do not throw; registration should return success payload with failed status
      }
    }

    // Ethereal preview when enabled
    if (String(process.env.USE_ETHEREAL).toLowerCase() === 'true' && info) {
      previewUrl = nodemailer.getTestMessageUrl(info);
    }

    // Registration succeeds regardless of email outcome
    res.json({ id, previewUrl, email_status: db.visitors.find(v => v.id === id)?.email_status || 'pending', email_error: db.visitors.find(v => v.id === id)?.email_error || null });
  } catch (err) {
    console.error('Register error', err);
    // Only hard fail if core registration steps (QR/db) failed
    res.status(500).json({ error: 'Failed to register' });
  }
});

// Stall host auth: validate stallId + accessCode before enabling scanner
app.post('/api/stall-auth', (req, res) => {
  const { stallId, accessCode } = req.body;
  if (!stallId || !accessCode) return res.status(400).json({ error: 'stallId and accessCode required' });
  const stall = db.stalls.find(s => s.id === stallId);
  if (!stall) return res.status(404).json({ error: 'Stall not found' });
  if (stall.access_code !== accessCode) return res.status(403).json({ error: 'Invalid stall access code' });
  res.json({ ok: true, stall: { id: stall.id, name: stall.name } });
});

app.post('/api/scan', async (req, res) => {
  const { visitorId, stallId, accessCode } = req.body;
  if (!visitorId || !stallId || !accessCode) return res.status(400).json({ error: 'visitorId, stallId, accessCode required' });

  const stall = db.stalls.find(s => s.id === stallId);
  if (!stall) return res.status(404).json({ error: 'Stall not found' });
  if (stall.access_code !== accessCode) return res.status(403).json({ error: 'Invalid stall access code' });

  const visitor = db.visitors.find(v => v.id === visitorId);
  if (!visitor) return res.status(404).json({ error: 'Visitor not found' });

  // Cross-stall verification: if scanned at another stall, deny
  const prior = db.scans.find(s => s.visitor_id === visitorId);
  if (prior) {
    if (prior.stall_id !== stallId) {
      const priorStall = db.stalls.find(x => x.id === prior.stall_id);
      return res.status(403).json({ error: `Visitor already scanned at ${priorStall ? priorStall.name : prior.stall_id}` });
    } else {
      // Already scanned at this stall; return OK without duplicating
      return res.json({ ok: true, message: 'Already scanned at this stall', visitor: { id: visitor.id, name: visitor.name, email: visitor.email }, stall: { id: stall.id, name: stall.name } });
    }
  }

  const already = db.scans.find(s => s.visitor_id === visitorId && s.stall_id === stallId);
  if (!already) {
    const scanDoc = { id: uuidv4(), visitor_id: visitorId, stall_id: stallId, scanned_at: new Date().toISOString() };
    db.scans.push(scanDoc);
    saveDB(db);
    if (mongo.enabled) {
      try { await mongo.db.collection('scans').insertOne(scanDoc); } catch (e) { console.error('Mongo scan insert error', e); }
    }
  }

  res.json({ ok: true, visitor: { id: visitor.id, name: visitor.name, email: visitor.email }, stall: { id: stall.id, name: stall.name } });
});

app.get('/api/export/stall/:stallId', (req, res) => {
  const stallId = req.params.stallId;
  const stall = db.stalls.find(s => s.id === stallId);
  if (!stall) return res.status(404).json({ error: 'Stall not found' });

  const scans = db.scans.filter(s => s.stall_id === stallId);
  const rows = scans.map(s => {
    const v = db.visitors.find(vv => vv.id === s.visitor_id);
    return {
      name: v ? v.name : '',
      email: v ? v.email : '',
      registered_at: v ? v.registered_at : '',
      scanned_at: s.scanned_at
    };
  });

  const csvHeader = 'name,email,registered_at,scanned_at\n';
  const csvBody = rows.map(r => `${escapeCsv(r.name)},${escapeCsv(r.email)},${escapeCsv(r.registered_at)},${escapeCsv(r.scanned_at)}`).join('\n');
  const csv = csvHeader + csvBody + '\n';

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${stallId}-visitors.csv"`);
  res.send(csv);
});

function escapeCsv(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Routes to serve pages directly
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/scan', (req, res) => res.sendFile(path.join(__dirname, 'public', 'scan.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/visitors', (req, res) => res.sendFile(path.join(__dirname, 'public', 'visitors.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.listen(PORT, () => {
  console.log(`VMS server running at ${APP_BASE_URL}`);
});