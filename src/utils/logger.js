const isDevelopment = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';

function formatLog(severity, message, data) {
  const entry = { severity, message, timestamp: new Date().toISOString() };
  if (data != null) entry.data = data;
  try {
    return JSON.stringify(entry);
  } catch (_) {
    return JSON.stringify({
      severity: 'ERROR',
      message: 'Log serialization failed',
      timestamp: entry.timestamp,
    });
  }
}

class Logger {
  static info(message, data = null) {
    console.log(formatLog('INFO', message, data));
  }

  static warn(message, data = null) {
    console.warn(formatLog('WARNING', message, data));
  }

  static error(message, error = null) {
    const data =
      error instanceof Error
        ? { ...error, message: error.message, stack: error.stack }
        : error;
    console.error(formatLog('ERROR', message, data));
  }

  static debug(message, data = null) {
    if (isDevelopment || isTest) {
      console.log(formatLog('DEBUG', message, data));
    }
  }

  static performance(operation, duration) {
    if (isDevelopment || isTest) {
      console.log(formatLog('DEBUG', `[PERF] ${operation} took ${duration}ms`));
    }
  }
}

export default Logger;
