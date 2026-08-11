const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate
} = require('./db');

const GameManager = require('./game/manager');

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'PresentIt2026Secure!';
const ADMIN_TOKEN = 'token_' + Buffer.from(ADMIN_PASSWORD).toString('base64');

// Site-wide Locked Mode
const SITE_LOCKED = process.env.SITE_LOCKED === 'true' || process.env.SITE_LOCKED === '1';
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS = process.env.AUTH_PASS || 'stoppedwumm2026!';

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Site Lock Basic Auth Middleware
function siteLockMiddleware(req, res, next) {
  if (!SITE_LOCKED) return next();

  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [scheme, credentials] = authHeader.split(' ');
    if (scheme === 'Basic' && credentials) {
      const decoded = Buffer.from(credentials, 'base64').toString('utf8');
      const [user, pass] = decoded.split(':');
      if (user === AUTH_USER && pass === AUTH_PASS) {
        return next();
      }
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="PresentIt Locked Site Access"');
  return res.status(401).send('🔒 Site access locked. Valid username and password required.');
}

app.use(siteLockMiddleware);

// Static files
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Admin Auth Middleware
function requireAdminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token === ADMIN_TOKEN) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized: Admin PIN required' });
}

// Admin Auth REST API
app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, token: ADMIN_TOKEN });
  }
  return res.status(401).json({ error: 'Incorrect Admin Password/PIN' });
});

// Templates REST API
app.get('/api/templates', (req, res) => {
  try {
    const templates = getTemplates();
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/templates/:id', (req, res) => {
  try {
    const template = getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/templates', requireAdminAuth, (req, res) => {
  try {
    const { name, description, slides } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Template name is required' });
    }
    const template = createTemplate(name, description, slides || []);
    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/templates/:id', requireAdminAuth, (req, res) => {
  try {
    const { name, description, slides } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Template name is required' });
    }
    const template = updateTemplate(req.params.id, name, description, slides || []);
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/templates/:id', requireAdminAuth, (req, res) => {
  try {
    const success = deleteTemplate(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Template not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Image Upload API
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded' });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// Image Download from URL API
app.post('/api/upload-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch image from URL: HTTP ${response.status}` });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const contentType = response.headers.get('content-type') || '';
    let ext = '.jpg';
    if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('gif')) ext = '.gif';
    else if (contentType.includes('webp')) ext = '.webp';

    const filename = `${uuidv4()}${ext}`;
    const filePath = path.join(uploadsDir, filename);

    fs.writeFileSync(filePath, buffer);

    res.json({ url: `/uploads/${filename}` });
  } catch (err) {
    res.status(500).json({ error: `URL download failed: ${err.message}` });
  }
});

// Routes for main web pages
app.get('/admin*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

app.get('/host*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'host', 'index.html'));
});

app.get('/play*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'play', 'index.html'));
});

app.get('/display*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'display', 'index.html'));
});

// Initialize Game Manager with Socket.IO
const gameManager = new GameManager(io);

io.on('connection', (socket) => {
  gameManager.setupSocketEvents(socket);
});

// Start Server
server.listen(PORT, () => {
  console.log(`🚀 PresentIt Server running on port ${PORT}`);
  console.log(`📱 App URL: http://localhost:${PORT}`);
  console.log(`🔒 Admin PIN default: presentit123`);
});
