import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { initWebSocketServer } from './src/lib/wsServer.ts';
import authRoutes from './src/routes/authRoutes.ts';
import complaintRoutes from './src/routes/complaintRoutes.ts';
import adminRoutes from './src/routes/adminRoutes.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Attach authenticated WebSocket server on /ws
initWebSocketServer(server);

// Parse JSON safely (supports attachments & base64 voice clips up to 12MB)
app.use(express.json({ limit: '12mb' }));

// Sliding-window API rate limiter
const rateWindowMs = 60_000;
const maxRequestsPerWindow = 180;
const ipHits = new Map<string, number[]>();

app.use('/api', (req, res, next) => {
  const key = req.ip || 'local';
  const now = Date.now();
  const timestamps = (ipHits.get(key) || []).filter((t) => now - t < rateWindowMs);
  if (timestamps.length >= maxRequestsPerWindow) {
    return res.status(429).json({ error: 'Too many requests. Please slow down and try again.' });
  }
  timestamps.push(now);
  ipHits.set(key, timestamps);
  next();
});

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api', complaintRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(__dirname, 'dist');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`ResolveCore AI server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
