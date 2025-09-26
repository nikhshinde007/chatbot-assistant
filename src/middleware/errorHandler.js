// src/middleware/errorHandler.js
const winston = require('winston');
const path = require('path');

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'chatbot-assistant' },
  transports: [
    new winston.transports.File({ 
      filename: path.join('logs', 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join('logs', 'combined.log') 
    })
  ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

/**
 * Custom error class for application errors
 */
class AppError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Async error handler wrapper for route handlers
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Not found (404) handler
 */
const notFoundHandler = (req, res, next) => {
  const error = new AppError(`Not found - ${req.originalUrl}`, 404);
  next(error);
};

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error({
    message: err.message,
    stack: err.stack,
    statusCode: err.statusCode || 500,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    details: err.details
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Invalid ID format';
    error = new AppError(message, 400);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    const message = 'Validation error';
    error = new AppError(message, 400, errors);
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'File size exceeds maximum allowed limit';
    error = new AppError(message, 413);
  }

  if (err.code === 'EBADCSRFTOKEN') {
    const message = 'Invalid CSRF token';
    error = new AppError(message, 403);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = new AppError(message, 401);
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = new AppError(message, 401);
  }

  // File system errors
  if (err.code === 'ENOENT') {
    const message = 'File or directory not found';
    error = new AppError(message, 404);
  }

  if (err.code === 'EACCES') {
    const message = 'Permission denied';
    error = new AppError(message, 403);
  }

  if (err.code === 'EISDIR') {
    const message = 'Expected a file but found a directory';
    error = new AppError(message, 400);
  }

  // API rate limiting
  if (err.message && err.message.includes('Rate limit')) {
    error = new AppError(err.message, 429);
  }

  // Default error response
  res.status(error.statusCode || 500).json({
    success: false,
    error: {
      message: error.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { 
        stack: err.stack,
        details: error.details 
      })
    }
  });
};

/**
 * Graceful shutdown handler
 */
const gracefulShutdown = (server) => {
  const shutdown = (signal) => {
    logger.info(`${signal} signal received: closing HTTP server`);
    
    // Stop accepting new requests
    server.close(() => {
      logger.info('HTTP server closed');
      
      // Close database connections, clear caches, etc.
      if (global.dbConnection) {
        global.dbConnection.close();
      }
      
      process.exit(0);
    });
    
    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    shutdown('UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('UNHANDLED_REJECTION');
  });
};

/**
 * Request logger middleware
 */
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });
  
  next();
};

module.exports = {
  AppError,
  asyncHandler,
  notFoundHandler,
  errorHandler,
  gracefulShutdown,
  requestLogger,
  logger
};