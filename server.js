const os = require('os');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(cors());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// ========== ROUTES ==========

// Serve static pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/upload.html', (req, res) => res.sendFile(path.join(__dirname, 'upload.html')));
app.get('/view.html', (req, res) => res.sendFile(path.join(__dirname, 'view.html')));

// ✅ Create session + generate QR
app.get('/create-session', async (req, res) => {
  const sessionId = uuidv4();
  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

  const uploadUrl = `${baseUrl}/upload.html?session=${sessionId}`;
  const viewUrl = `${baseUrl}/view.html?session=${sessionId}`;

  try {
    const qrCodeDataURL = await qrcode.toDataURL(uploadUrl);
    res.json({ sessionId, qrCode: qrCodeDataURL, viewUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// ✅ Multer storage for sessions
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.body.sessionId;
    const sessionDir = path.join(uploadsDir, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

// ✅ Allowed file types
const allowedTypes = [
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
];

const fileFilter = (req, file, cb) => {
  if (allowedTypes.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Invalid file type. Only PPT, PPTX, PDF, PNG, and JPG are allowed.'));
};

const upload = multer({ storage, fileFilter });

// ✅ Handle multiple file uploads
app.post('/upload-multiple', upload.array('files', 10), (req, res) => {

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const { name, rollNumber, sessionId } = req.body;
  const sessionDir = path.join(uploadsDir, sessionId);
  const infoFile = path.join(sessionDir, 'uploads.json');
  let uploads = [];

  if (fs.existsSync(infoFile)) {
    uploads = JSON.parse(fs.readFileSync(infoFile));
  }

  const newFiles = req.files.map((file) => ({
    filename: file.filename,
    originalName: file.originalname,
    uploader: name,
    rollNumber,
    uploadTime: new Date().toISOString(),
    path: file.path,
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

  const sessionDir = path.join(uploadsDir, sessionId);
  const infoFile = path.join(sessionDir, 'uploads.json');
  if (!fs.existsSync(infoFile)) return res.json([]);

  const uploads = JSON.parse(fs.readFileSync(infoFile));
  res.json(uploads);
});

// ✅ Download file
app.get('/download/:sessionId/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  const filePath = path.join(uploadsDir, sessionId, filename);
  if (fs.existsSync(filePath)) res.download(filePath);
  else res.status(404).json({ error: 'File not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
