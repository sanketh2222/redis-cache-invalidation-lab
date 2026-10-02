const { logLevel } = require('../config');

const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const current = levels[logLevel] ?? levels.info;

function log(level, message, meta) {
  if ((levels[level] ?? 99) > current) return;
  const line = meta ? `${message} ${JSON.stringify(meta)}` : message;
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](`[${level.toUpperCase()}] ${line}`);
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};
