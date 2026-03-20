const os = require('os');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4, validate: uuidValidate } = require('uuid');
const qrcode = require('qrcode');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const app = express();
const rawPort = Number(process.env.PORT);
const PORT = Number.isInteger(rawPort) && rawPort >= 0 ? rawPort : 0;  // 0 selects any available port

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // Always allow cookies over HTTP for local dev
      maxAge: 1000 * 60 * 60, // 1 hour
    },
  })
);

// Only serve the client assets (avoid exposing server root, sessions.json, uploads/, etc.)
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));

// CORS: default to same-origin; optionally allow explicit origins via env.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Non-browser or same-origin requests often have no Origin header
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, false);
    return cb(null, allowedOrigins.includes(origin));
  },
}));

// Basic rate limiting to reduce brute force / abuse
const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(['/create-session', '/session-code/:code', '/upload-multiple', '/view-data', '/download/:sessionId/:filename'], apiLimiter);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// ========= SESSION CODE SYSTEM =========
const sessionsFile = path.join(__dirname, 'sessions.json');

if (!fs.existsSync(sessionsFile)) {
  fs.writeFileSync(sessionsFile, JSON.stringify({}), 'utf8');
}

function loadSessions() {
  try {
    return JSON.parse(fs.readFileSync(sessionsFile, 'utf8') || '{}');
  } catch (err) {
    console.error('Failed to load sessions.json', err);
    return {};
  }
}

function saveSessions(map) {
  fs.writeFileSync(sessionsFile, JSON.stringify(map, null, 2), 'utf8');
}

function pruneExpiredSessions(map) {
  const ttlHours = Number(process.env.SESSION_TTL_HOURS || 24);
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) return map;
  const cutoffMs = Date.now() - ttlHours * 60 * 60 * 1000;

  let changed = false;
  for (const [code, record] of Object.entries(map)) {
    const createdAtMs = Date.parse(record?.createdAt || '');
    if (!Number.isFinite(createdAtMs) || createdAtMs < cutoffMs) {
      delete map[code];
      changed = true;
    }
  }
  if (changed) saveSessions(map);
  return map;
}

function generateUniqueCode() {
  const map = pruneExpiredSessions(loadSessions());
  for (let i = 0; i < 10000; i++) {
    const useFour = crypto.randomInt(0, 2) === 0;
    const code = useFour
      ? String(crypto.randomInt(1000, 10000))      // 4 digits
      : String(crypto.randomInt(10000, 100000));   // 5 digits
    if (!map[code]) return code;
  }
  return Date.now().toString().slice(-5);
}

function getBaseUrl(req) {
  const envUrl = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (envUrl) return envUrl;
  // Works even when PORT=0 (random free port)
  const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http';
  const host = req?.get ? req.get('host') : null;
  return host ? `${proto}://${host}` : `http://localhost:${PORT}`;
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function sanitizeFilenamePreserveExt(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const safeExt = ext && ext.length <= 10 ? ext : '';
  return `${Date.now()}-${uuidv4()}${safeExt}`;
}

function validateUuid(value) {
  return typeof value === 'string' && uuidValidate(value);
}

// ======== ADMIN AUTH (simple session-based) ========
const adminsFile = path.join(__dirname, 'admins.json');
const ADMIN_ALLOW_REGISTRATION = process.env.ADMIN_ALLOW_REGISTRATION === 'true';

if (!fs.existsSync(adminsFile)) {
  fs.writeFileSync(adminsFile, JSON.stringify({ admins: {} }, null, 2), 'utf8');
}

function loadAdmins() {
  try {
    const raw = fs.readFileSync(adminsFile, 'utf8');
    if (!raw) return { admins: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { admins: {} };
    return { admins: parsed.admins && typeof parsed.admins === 'object' ? parsed.admins : {} };
  } catch (err) {
    console.error('Failed to load admins.json', err);
    return { admins: {} };
  }
}

function saveAdmins(data) {
  fs.writeFileSync(adminsFile, JSON.stringify(data, null, 2), 'utf8');
}

function getAdmin(username) {
  if (!username || typeof username !== 'string') return null;
  const { admins } = loadAdmins();
  return admins[username] || null;
}

async function createAdmin(username, password) {
  const trimmed = String(username || '').trim();
  if (!trimmed || typeof password !== 'string' || password.length < 6) {
    throw new Error('Invalid username or password');
  }

  const { admins } = loadAdmins();
  if (admins[trimmed]) {
    throw new Error('User already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  admins[trimmed] = {
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  saveAdmins({ admins });
  return { username: trimmed };
}

function requireAdmin(req, res, next) {
  const sessionAdmin = req.session?.admin;
  if (!sessionAdmin || !sessionAdmin.username) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const admin = getAdmin(sessionAdmin.username);
  if (!admin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.admin = { username: sessionAdmin.username };
  next();
}

// ========== ROUTES ==========

// Serve static pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/upload.html', (req, res) => res.sendFile(path.join(__dirname, 'upload.html')));
app.get('/view.html', (req, res) => res.sendFile(path.join(__dirname, 'view.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ===== Admin API =====
app.post('/admin/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const { admins } = loadAdmins();
  if (Object.keys(admins).length > 0 && !ADMIN_ALLOW_REGISTRATION) {
    return res.status(403).json({ error: 'Registration disabled' });
  }

  try {
    const admin = await createAdmin(username, password);
    req.session.admin = { username: admin.username };
    return res.json({ ok: true, username: admin.username });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  console.log('[LOGIN ATTEMPT]', { username, password: password ? '***' : undefined });
  if (!username || !password) {
    console.log('[LOGIN FAIL] Missing username or password');
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const admin = getAdmin(username);
  if (!admin) {
    console.log('[LOGIN FAIL] No such user:', username);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = await bcrypt.compare(password, admin.passwordHash || '');
  if (!ok) {
    console.log('[LOGIN FAIL] Bad password for:', username);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.admin = { username };
  console.log('[LOGIN SUCCESS]', username);
  return res.json({ ok: true, username });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/admin/me', (req, res) => {
  const sessionAdmin = req.session?.admin;
  console.log('[ADMIN ME] session:', req.session);
  if (!sessionAdmin || !sessionAdmin.username) {
    console.log('[ADMIN ME] Not authenticated');
    return res.json({ authenticated: false });
  }
  const admin = getAdmin(sessionAdmin.username);
  if (!admin) {
    console.log('[ADMIN ME] Session user not found:', sessionAdmin.username);
    return res.json({ authenticated: false });
  }
  console.log('[ADMIN ME] Authenticated as', sessionAdmin.username);
  return res.json({ authenticated: true, username: sessionAdmin.username });
});

app.get('/admin/sessions', requireAdmin, (req, res) => {
  const sessionsMap = pruneExpiredSessions(loadSessions());
  const sessions = Object.entries(sessionsMap).map(([code, record]) => ({ code, ...record }));
  res.json({ sessions });
});

app.delete('/admin/session/:code', requireAdmin, (req, res) => {
  const code = req.params.code;
  if (!code) return res.status(400).json({ error: 'Session code required' });

  const sessionsMap = pruneExpiredSessions(loadSessions());
  const record = sessionsMap[code];
  if (!record) return res.status(404).json({ error: 'Session not found' });

  const { sessionId } = record;
  delete sessionsMap[code];
  saveSessions(sessionsMap);

  try {
    const sessionDir = path.join(uploadsDir, sessionId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Failed to delete session uploads', err);
  }

  return res.json({ ok: true });
});

app.post('/admin/session/:sessionId/uploads', requireAdmin, (req, res) => {
  const { sessionId } = req.params;
  if (!validateUuid(sessionId)) return res.status(400).json({ error: 'Invalid sessionId' });

  const sessionDir = path.join(uploadsDir, sessionId);
  const infoFile = path.join(sessionDir, 'uploads.json');
  if (!fs.existsSync(infoFile)) return res.json({ uploads: [] });

  const uploads = safeReadJson(infoFile, []);
  return res.json({ uploads });
});

app.delete('/admin/file/:sessionId/:filename', requireAdmin, (req, res) => {
  const { sessionId, filename } = req.params;
  if (!validateUuid(sessionId)) return res.status(400).json({ error: 'Invalid sessionId' });
  if (!filename || filename !== path.basename(filename)) return res.status(400).json({ error: 'Invalid filename' });

  const sessionDir = path.join(uploadsDir, sessionId);
  const infoFile = path.join(sessionDir, 'uploads.json');
  const uploads = safeReadJson(infoFile, []);

  const remaining = Array.isArray(uploads) ? uploads.filter(u => u.filename !== filename) : [];
  fs.writeFileSync(infoFile, JSON.stringify(remaining, null, 2));

  const filePath = path.join(sessionDir, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Failed to delete file', err);
  }

  return res.json({ ok: true });
});

// ✅ Create session + generate QR + unique code (admin only)
app.post('/create-session', requireAdmin, async (req, res) => {
  const sessionId = uuidv4();
  const baseUrl = getBaseUrl(req);
  const uploadUrl = `${baseUrl}/upload.html?session=${sessionId}`;
  const viewUrl = `${baseUrl}/view.html?session=${sessionId}`;

  try {
    // Generate unique 4–5 digit code
    const sessionsMap = pruneExpiredSessions(loadSessions());
    const code = generateUniqueCode();

    // Save mapping
    sessionsMap[code] = { sessionId, createdAt: new Date().toISOString() };
    saveSessions(sessionsMap);

    // Create QR Code
    const qrCodeDataURL = await qrcode.toDataURL(uploadUrl);

    // Send response including code
    res.json({ sessionId, code, qrCode: qrCodeDataURL, viewUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate session or QR code' });
  }
});


// ✅ Multer storage for sessions
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.body.sessionId;
    if (!validateUuid(sessionId)) return cb(new Error('Invalid sessionId.'));
    const sessionDir = path.join(uploadsDir, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    cb(null, sanitizeFilenamePreserveExt(file.originalname));
  },
});

// ✅ Allowed file types
const allowedTypes = [
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const fileFilter = (req, file, cb) => {
  if (allowedTypes.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Invalid file type. Only PPT, PPTX, and PDF are allowed.'));
};

const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB || 25);
const upload = multer({
  storage,
  fileFilter,
  limits: {
    files: 10,
    fileSize: Number.isFinite(maxFileSizeMb) && maxFileSizeMb > 0 ? maxFileSizeMb * 1024 * 1024 : 25 * 1024 * 1024,
  },
});

// ✅ Handle multiple file uploads
app.post('/upload-multiple', upload.array('files', 10), (req, res) => {

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const { name, rollNumber, sessionId } = req.body;
  if (!validateUuid(sessionId)) return res.status(400).json({ error: 'Invalid sessionId' });
  const sessionDir = path.join(uploadsDir, sessionId);
  const infoFile = path.join(sessionDir, 'uploads.json');
  const uploads = safeReadJson(infoFile, []);

  const newFiles = req.files.map((file) => ({
    filename: file.filename,
    originalName: file.originalname,
    uploader: name,
    rollNumber,
    uploadTime: new Date().toISOString(),
  }));

  uploads.push(...newFiles);
  fs.writeFileSync(infoFile, JSON.stringify(uploads, null, 2));

  const uploadedFiles = newFiles.map(f => ({
  name: f.originalName,
  url: `/download/${sessionId}/${f.filename}`
}));

res.json({
  message: 'Files uploaded successfully!',
  uploadedCount: uploadedFiles.length,
  files: uploadedFiles
});

});

// ✅ View session data
app.get('/view-data', (req, res) => {
  const sessionId = req.query.session;
  if (!sessionId) return res.status(400).json({ error: 'Session ID required' });
  if (!validateUuid(sessionId)) return res.status(400).json({ error: 'Invalid sessionId' });

  const sessionDir = path.join(uploadsDir, sessionId);
  const infoFile = path.join(sessionDir, 'uploads.json');
  if (!fs.existsSync(infoFile)) return res.json([]);

  const uploads = safeReadJson(infoFile, []);
  // Strip any legacy/unsafe fields before returning
  res.json(uploads.map(u => ({
    filename: u.filename,
    originalName: u.originalName,
    uploader: u.uploader,
    rollNumber: u.rollNumber,
    uploadTime: u.uploadTime,
  })));
});

// ✅ Download file
app.get('/download/:sessionId/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  if (!validateUuid(sessionId)) return res.status(400).json({ error: 'Invalid sessionId' });
  if (!filename || filename !== path.basename(filename)) return res.status(400).json({ error: 'Invalid filename' });

  const sessionDir = path.join(uploadsDir, sessionId);
  const infoFile = path.join(sessionDir, 'uploads.json');
  const uploads = safeReadJson(infoFile, []);
  const allowed = uploads.some(u => u && u.filename === filename);
  if (!allowed) return res.status(404).json({ error: 'File not found' });

  const filePath = path.join(sessionDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  return res.download(filePath);
});
// ✅ Access session using numeric code
app.get('/session-code/:code', (req, res) => {
  const code = req.params.code;
  const sessionsMap = pruneExpiredSessions(loadSessions());
  const record = sessionsMap[code];

  if (!record) {
    return res.status(404).send('❌ Invalid session code.');
  }

  const baseUrl = getBaseUrl(req);
  const viewUrl = `${baseUrl}/view.html?session=${record.sessionId}`;

  // Redirect to view page for that session
  return res.redirect(viewUrl);
});

// Serve admin panel for any admin route (client-side routing support)
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// Centralized error handler (e.g. Multer errors, invalid sessionId during storage, etc.)
app.use((err, req, res, next) => {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files' });
    return res.status(400).json({ error: err.message });
  }

  const msg = String(err.message || '');
  if (msg.includes('Invalid sessionId')) return res.status(400).json({ error: 'Invalid sessionId' });
  if (msg.includes('Invalid file type')) return res.status(400).json({ error: msg });

  console.error(err);
  return res.status(500).json({ error: 'Server error' });
});

// Start server
const server = app.listen(PORT, () => {
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : PORT;
  console.log(`✅ Server running at http://localhost:${actualPort}`);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Try: set PORT=0&& node server.js`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
