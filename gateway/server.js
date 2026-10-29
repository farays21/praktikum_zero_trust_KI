/**
 * API Gateway - Zero Trust Security
 * Port 3000
 * Handles authentication, token management, and policy enforcement.
 */

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { loadConfig } = require('../shared/config');
const { openDatabase } = require('../shared/db/connection');
const authRoutes = require('./routes/auth');
const policyEngine = require('./middleware/policyEngine');

const app = express();
const config = loadConfig();

// Middleware
app.use(express.json());
app.use(cookieParser());

// CORS untuk frontend Vite dev server (http://localhost:5173)
const cors = require('cors');
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID', 'X-Policy-Now'],
}));

// Database connection (shared across requests)
const db = openDatabase(config.dbPath);

// Attach db and config to request for route handlers
app.use((req, res, next) => {
  req.db = db;
  req.config = config;
  next();
});

// Routes
app.use('/auth', authRoutes);

// Business routes (proxied to internal services)
const nilaiRoutes = require('./routes/nilai');
const transkripRoutes = require('./routes/transkrip');
app.use(nilaiRoutes);
app.use(transkripRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', port: 3000 });
});

// Root endpoint - informational message
app.get('/', (req, res) => {
  res.json({ message: 'API Gateway aktif. Gunakan endpoint /auth/login untuk login, /nilai untuk data nilai, /transkrip/:nim untuk transkrip.', health: '/health' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Gateway error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`API Gateway running on http://localhost:${PORT}`);
});

module.exports = app;
