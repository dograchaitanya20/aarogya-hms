import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import requestId from './middleware/requestId.js';
import requestLogger from './middleware/requestLogger.js';
import errorHandler from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { NotFoundError } from './errors/AppError.js';
import apiRoutes from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security Headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: false, // Disabled for Swagger UI rendering
    crossOriginEmbedderPolicy: false,
  })
);

// CORS Configuration
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(
  cors({
    origin: [frontendUrl, 'http://localhost:3000', 'http://127.0.0.1:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id'],
  })
);

// Body Parsers (strict size limits to prevent body-inflation DoS) & Cookie Parser
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-cookie-secret-key-change-in-production'));

// Request ID and Request Logging
app.use(requestId);
app.use(requestLogger);

// Global API Rate Limiter
app.use('/api/', apiLimiter);

// OpenAPI Swagger Documentation
const openApiPath = path.join(__dirname, 'docs', 'openapi.json');
if (fs.existsSync(openApiPath)) {
  const swaggerDoc = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
}

// API v1 Routes
app.use('/api/v1', apiRoutes);

// Root Health & Synthetic Data Disclaimer
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Aarogya HMS API',
    version: '1.0.0',
    documentation: '/api/docs',
    health: '/api/v1/health',
    notice: 'Demo system — synthetic data only. No real patient data.',
  });
});

// 404 Handler for undefined routes
app.use((req, res, next) => {
  next(new NotFoundError(`Endpoint '${req.method} ${req.originalUrl}' not found`));
});

// Central Error Handler
app.use(errorHandler);

export default app;
