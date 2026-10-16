import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { connectDB, mongoose } from './db';
import { authenticate } from './middleware/auth';
import { handleError, AppError } from './errors';

import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import customersRoutes from './routes/customers';
import itemsRoutes from './routes/items';
import { categories, warehouses, movements } from './routes/inventory';
import assignmentsRoutes from './routes/assignments';
import paymentsRoutes from './routes/payments';
import installmentsRoutes from './routes/installments';
import accountingRoutes from './routes/accounting';
import reportsRoutes from './routes/reports';
import dashboardRoutes from './routes/dashboard';
import auditRoutes from './routes/audit';
import settingsRoutes from './routes/settings';
import searchRoutes from './routes/search';

const app = express();
app.disable('x-powered-by');
// Behind Render's proxy: makes req.ip the real client IP
app.set('trust proxy', 1);
app.use(cors({
  origin: [
    'https://warehouse-management-client.pages.dev',
    'https://radiant-ganache-bf34a7.netlify.app',
    'http://localhost:5173'
  ],
  credentials: true
}));
// Basic security headers
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '2mb' }));

// Public health check for platform probes — always 200 (Render healthCheckPath),
// but reports database connectivity so monitoring can alert on it
app.get('/api/health', (_req, res) => {
  const state = mongoose.connection.readyState; // 1 connected, 2 connecting, 0 disconnected
  res.json({
    ok: true,
    db: state === 1 ? 'connected' : state === 2 ? 'connecting' : 'disconnected',
    uptime_s: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

// Auth router is public at its root; protected endpoints apply authenticate() themselves
app.use('/api/auth', authRoutes);

// Authenticated + permission-checked
app.use('/api/users', authenticate, usersRoutes);
app.use('/api/customers', authenticate, customersRoutes);
app.use('/api/items', authenticate, itemsRoutes);
app.use('/api/categories', authenticate, categories);
app.use('/api/warehouses', authenticate, warehouses);
app.use('/api/movements', authenticate, movements);
app.use('/api/assignments', authenticate, assignmentsRoutes);
app.use('/api/payments', authenticate, paymentsRoutes);
app.use('/api/installments', authenticate, installmentsRoutes);
app.use('/api/accounting', authenticate, accountingRoutes);
app.use('/api/reports', authenticate, reportsRoutes);
app.use('/api/dashboard', authenticate, dashboardRoutes);
app.use('/api/audit', authenticate, auditRoutes);
app.use('/api/settings', authenticate, settingsRoutes);
app.use('/api/search', authenticate, searchRoutes);

// Attachments (authenticated)
const uploadsDir = path.join(__dirname, '..', 'uploads');
app.get('/uploads/:file', authenticate, (req, res, next) => {
  const file = path.basename(String(req.params.file));
  const full = path.join(uploadsDir, file);
  if (!fs.existsSync(full)) return next(new AppError(404, 'File not found'));
  res.sendFile(full);
});

// Production: serve the built client
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Malformed JSON body → clean 400 instead of a 500
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  handleError(err, res);
});

const port = Number(process.env.PORT || 4000);

(async () => {
  try {
    await connectDB();
    console.log('✔ Connected to MongoDB');
  } catch (e) {
    console.error('✖ MongoDB connection failed — API will serve errors until the DB is reachable', e);
  }
  app.listen(port, () => {
    console.log(`✔ Warehouse API listening on http://localhost:${port}`);
  });
})();
