import dotenv from 'dotenv';
import app from './app.js';
import logger from './config/logger.js';
import { query } from './config/db.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '5000', 10);

async function startServer() {
  try {
    // Verify database connection on startup
    await query('SELECT 1');
    logger.info('Connected to PostgreSQL database successfully.');

    const server = app.listen(PORT, () => {
      logger.info(`Aarogya HMS Server running on http://localhost:${PORT}`);
      logger.info(`OpenAPI Documentation available at http://localhost:${PORT}/api/docs`);
      logger.info(`Health check available at http://localhost:${PORT}/api/v1/health`);
    });

    // Graceful Shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);
      server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    logger.fatal(err, 'Failed to start server due to database connection error');
    process.exit(1);
  }
}

startServer();
