/**
 * Central configuration. All secrets come from environment variables.
 * Callers must load dotenv before requiring this module if they need .env values.
 */

const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');

function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || String(value).trim() === '') {
    return fallback;
  }
  return value;
}

function loadConfig() {
  return {
    rootDir,
    dbPath: path.resolve(rootDir, optionalEnv('DB_PATH', 'database/zero-trust.db')),
    bcryptRounds: Number(optionalEnv('BCRYPT_ROUNDS', '10')),
    jwtSecret: requireEnv('JWT_SECRET'),
    jwtRefreshSecret: requireEnv('JWT_REFRESH_SECRET'),
    jwtServiceSecret: requireEnv('JWT_SERVICE_SECRET'),
    gatewaySecret: requireEnv('GATEWAY_SECRET'),
    gatewayUrl: optionalEnv('GATEWAY_URL', 'http://localhost:3000'),
    serviceClients: {
      nilai: {
        clientId: optionalEnv('NILAI_SERVICE_CLIENT_ID', 'nilai-service'),
        clientSecret: requireEnv('NILAI_SERVICE_SECRET'),
        serviceName: 'Nilai Service',
      },
      transkrip: {
        clientId: optionalEnv('TRANSKRIP_SERVICE_CLIENT_ID', 'transkrip-service'),
        clientSecret: requireEnv('TRANSKRIP_SERVICE_SECRET'),
        serviceName: 'Transkrip Service',
      },
    },
    allowedHoursStart: optionalEnv('ALLOWED_HOURS_START', '07:00'),
    allowedHoursEnd: optionalEnv('ALLOWED_HOURS_END', '21:00'),
    accessTokenMinutes: Number(optionalEnv('ACCESS_TOKEN_MINUTES', '10')),
    refreshTokenDays: Number(optionalEnv('REFRESH_TOKEN_DAYS', '1')),
    serviceTokenMinutes: Number(optionalEnv('SERVICE_TOKEN_MINUTES', '5')),
  };
}

module.exports = { loadConfig, requireEnv, optionalEnv };
