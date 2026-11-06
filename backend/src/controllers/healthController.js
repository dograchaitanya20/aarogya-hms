import { query } from '../config/db.js';

export async function getHealth(req, res, next) {
  try {
    const dbStart = Date.now();
    await query('SELECT 1');
    const dbLatencyMs = Date.now() - dbStart;

    res.status(200).json({
      status: 'ok',
      service: 'aarogya-hms-api',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        status: 'connected',
        latencyMs: dbLatencyMs,
      },
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      service: 'aarogya-hms-api',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        status: 'disconnected',
        error: err.message,
      },
    });
  }
}

export default {
  getHealth,
};
