import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import dtrRoutes from './routes/dtrRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import coordinatorRoutes from './routes/coordinatorRoutes.js';
import evaluationRoutes from './routes/evaluationRoutes.js';
import deploymentRoutes from './routes/deploymentRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import attendanceExceptionRoutes from './routes/attendanceExceptionRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import auditRoutes from './routes/auditRoutes.js';
import exportRoutes from './routes/exportRoutes.js';
import systemRoutes from './routes/systemRoutes.js';
import completionRoutes from './routes/completionRoutes.js';
import { deliverNotification } from './controllers/notificationController.js';
import { processNotificationOutbox, startNotificationWorker, stopNotificationWorker } from './utils/notificationOutbox.js';
import { processScheduledReports, startReportProcessor, stopReportProcessor } from './utils/reportProcessor.js';
import { cleanupExpiredAttendanceImages, startAttendanceImageRetention, stopAttendanceImageRetention } from './utils/attendanceImageRetention.js';
import { monitorRequests } from './middleware/monitoringMiddleware.js';
import { logger } from './utils/logger.js';
import { validateRuntimeConfig } from './config/runtime.js';
import pool from './config/db.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(serverDir, '.env') });

const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const isServerless = Boolean(process.env.VERCEL);
if (!(isServerless && !process.env.JWT_SECRET)) validateRuntimeConfig();
if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
  console.warn('Password-reset email is disabled until RESEND_API_KEY and EMAIL_FROM are configured.');

const app = express();
if (isProduction || isServerless || process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https:', 'wss:'],
      fontSrc: ["'self'", 'data:', 'https:'],
      mediaSrc: ["'self'", 'blob:'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
    },
  },
}));

const configuredOrigins = [process.env.FRONTEND_URL, process.env.CLIENT_URL]
  .filter(Boolean)
  .flatMap(value => value.split(','))
  .map(origin => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  ...configuredOrigins,
].filter(Boolean);

app.use(cors((req, callback) => {
  const origin = req.get('origin');
  const normalizedOrigin = origin?.replace(/\/$/, '');
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0].trim();
  const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0].trim();
  const requestHost = forwardedHost || req.get('host');
  const requestProtocol = forwardedProtocol || req.protocol;
  const sameOrigin = requestHost && normalizedOrigin === `${requestProtocol}://${requestHost}`.replace(/\/$/, '');
  const permitted = !origin || sameOrigin || allowedOrigins.includes(normalizedOrigin);

  if (permitted) return callback(null, { origin: origin || false, credentials: true });
  const error = new Error('This app address is not allowed to access the API. Reopen Smartrack using the current system link.');
  error.status = 403;
  return callback(error);
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(monitorRequests);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: req => req.method === 'OPTIONS' || req.path === '/health',
  message: { message: 'This device has sent unusually many requests. Wait a minute, then try again.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Too many unsuccessful sign-in attempts. Try again in 15 minutes.' },
});

app.use('/api/', limiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/mfa/verify', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

const sensitiveWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: req => req.method === 'OPTIONS',
  message: { message: 'Too many sensitive operations. Wait before trying again.' },
});
app.use('/api/dtr/clock-in', sensitiveWriteLimiter);
app.use('/api/dtr/clock-out', sensitiveWriteLimiter);
app.use('/api/documents/upload', sensitiveWriteLimiter);
app.use('/api/users/import-students', sensitiveWriteLimiter);

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Health database check failed', { error });
    res.status(503).json({ status: 'unavailable', database: 'disconnected', timestamp: new Date().toISOString() });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dtr', dtrRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/coordinator', coordinatorRoutes);
app.use('/api/evaluations', evaluationRoutes);
app.use('/api/deployments', deploymentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/attendance-exceptions', attendanceExceptionRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/completions', completionRoutes);

app.get('/api/cron/workers', async (req, res) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.get('authorization') !== `Bearer ${secret}`)
    return res.status(401).json({ message: 'Unauthorized.' });
  try {
    const [outbox, reports, retention] = await Promise.all([
      processNotificationOutbox(deliverNotification),
      processScheduledReports(),
      cleanupExpiredAttendanceImages(),
    ]);
    return res.status(200).json({ ok: true, outbox, reports, retention });
  } catch (error) {
    logger.error('Cron workers failed', { error });
    return res.status(500).json({ message: 'Background jobs failed.' });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API route not found' });
});

if (isProduction && !isServerless) {
  const clientDist = path.resolve(serverDir, '../client/dist');
  app.use(express.static(clientDist, {
    maxAge: '1d',
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest'))
        res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.use((req, res) => {
    res.status(404).json({ message: 'Route not found' });
  });
}

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled request error', {
    error: err,
    method: req.method,
    path: req.originalUrl,
    requestId: req.requestId,
  });
  res.status(err.status || 500).json({ message: err.status ? err.message : 'Internal server error' });
});

let httpServer;

export const startServer = async () => {
  await pool.query('SELECT 1');
  logger.info('Database connected');

  return new Promise((resolve, reject) => {
    httpServer = app.listen(PORT, '0.0.0.0', () => {
      logger.info('Smartrack server started', { port: Number(PORT) });
      startNotificationWorker(deliverNotification);
      startReportProcessor();
      startAttendanceImageRetention();
      resolve(httpServer);
    });
    httpServer.once('error', reject);
  });
};

const shutdown = async (signal) => {
  logger.info('Shutdown requested', { signal });
  stopNotificationWorker();
  stopReportProcessor();
  stopAttendanceImageRetention();
  if (httpServer) await new Promise(resolve => httpServer.close(resolve));
  await pool.end();
  process.exit(0);
};
if (!isServerless) {
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  startServer().catch(error => {
    logger.error('Server startup failed', { error });
    process.exitCode = 1;
  });
}

export default app;
