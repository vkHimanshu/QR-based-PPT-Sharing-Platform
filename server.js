const os = require('os'); 
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const qrcode = require('qrcode');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/upload.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'upload.html'));
});

app.get('/view.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'view.html'));
});



app.get('/create-session', async (req, res) => {
  const sessionId = uuidv4();

  // Get your local IP address dynamically
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (let key in interfaces) {
    for (let iface of interfaces[key]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }

  // Use local IP for QR code URLs
  const uploadUrl = `http://${localIP}:${PORT}/upload.html?session=${sessionId}`;
  const viewUrl = `http://${localIP}:${PORT}/view.html?session=${sessionId}`;

  try {
    const qrCodeDataURL = await qrcode.toDataURL(uploadUrl);
    res.json({ sessionId, qrCode: qrCodeDataURL, viewUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});


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
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PPT, PPTX, and PDF are allowed.'));
    }
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { name, rollNumber, sessionId } = req.body;
  const fileInfo = {
    filename: req.file.filename,
    originalName: req.file.originalname,
    uploader: name,
    rollNumber,
    uploadTime: new Date().toISOString(),
    path: req.file.path
  };

  const sessionDir = path.join(uploadsDir, sessionId);
  const infoFile = path.join(sessionDir, 'uploads.json');
  let uploads = [];
  if (fs.existsSync(infoFile)) {
    uploads = JSON.parse(fs.readFileSync(infoFile));
  }
  uploads.push(fileInfo);
  fs.writeFileSync(infoFile, JSON.stringify(uploads, null, 2));

  res.json({ message: 'File uploaded successfully!' });
});

app.get('/view-data', (req, res) => {
  const sessionId = req.query.session;
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  const sessionDir = path.join(uploadsDir, sessionId);
  const infoFile = path.join(sessionDir, 'uploads.json');
  if (!fs.existsSync(infoFile)) {
    return res.json([]);
  }

  const uploads = JSON.parse(fs.readFileSync(infoFile));
  res.json(uploads);
});

app.get('/download/:sessionId/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  const filePath = path.join(uploadsDir, sessionId, filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
