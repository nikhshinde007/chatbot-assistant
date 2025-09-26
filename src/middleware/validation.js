// src/middleware/validation.js
const { body, param, query, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');

/**
 * Middleware to handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
};

/**
 * Custom validator for API endpoints
 */
const validateApiRequest = (allowedFields = []) => {
  return [
    body().custom((value, { req }) => {
      const extraFields = Object.keys(req.body).filter(key => !allowedFields.includes(key));
      if (extraFields.length > 0) {
        throw new Error(`Unexpected fields: ${extraFields.join(', ')}`);
      }
      return true;
    }),
    handleValidationErrors
  ];
};

/**
 * Rate limiting validator
 */
const validateRateLimit = (req, res, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const window = 60000; // 1 minute
  const maxRequests = 100;
  
  if (!global.requestCounts) {
    global.requestCounts = new Map();
  }
  
  const requests = global.requestCounts.get(key) || [];
  const validRequests = requests.filter(time => now - time < window);
  
  if (validRequests.length >= maxRequests) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil(window / 1000)
    });
  }
  
  validRequests.push(now);
  global.requestCounts.set(key, validRequests);
  next();
};

/**
 * Custom validator to prevent path traversal attacks
 */
const isSafePath = (value) => {
  // Normalize the path
  const normalizedPath = path.normalize(value);
  
  // Check for path traversal attempts
  if (normalizedPath.includes('..') || normalizedPath.includes('~')) {
    throw new Error('Invalid path - potential security risk');
  }
  
  // Ensure path is within allowed directories
  const allowedBasePaths = (process.env.ALLOWED_PATHS || './').split(',');
  const isAllowed = allowedBasePaths.some(basePath => {
    const resolvedBase = path.resolve(basePath.trim());
    const resolvedTarget = path.resolve(normalizedPath);
    return resolvedTarget.startsWith(resolvedBase);
  });
  
  if (!isAllowed) {
    throw new Error('Path is outside allowed directories');
  }
  
  return true;
};

/**
 * Custom validator for file existence
 */
const fileExists = (value) => {
  if (!fs.existsSync(value)) {
    throw new Error('File does not exist');
  }
  return true;
};

/**
 * Custom validator for directory existence
 */
const directoryExists = (value) => {
  try {
    const stats = fs.statSync(value);
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory');
    }
  } catch (error) {
    throw new Error('Directory does not exist');
  }
  return true;
};

// Validation rules for different endpoints
const validationRules = {
  // Search endpoint validation
  search: [
    body('query')
      .trim()
      .notEmpty().withMessage('Query is required')
      .isLength({ min: 1, max: 500 }).withMessage('Query must be between 1 and 500 characters')
      .escape(), // Escape HTML to prevent XSS
    body('dir')
      .trim()
      .notEmpty().withMessage('Directory is required')
      .custom(isSafePath)
      .custom(directoryExists),
    body('user')
      .optional()
      .isObject().withMessage('User must be an object'),
    body('lang')
      .optional()
      .isIn(['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'])
      .withMessage('Unsupported language'),
    handleValidationErrors
  ],
  
  // Log analysis validation
  analyzeLog: [
    body('log')
      .trim()
      .notEmpty().withMessage('Log content is required')
      .isLength({ max: 100000 }).withMessage('Log content too large (max 100KB)'),
    body('code')
      .optional()
      .isString()
      .isLength({ max: 50000 }).withMessage('Code content too large (max 50KB)'),
    body('doc')
      .optional()
      .isString()
      .isLength({ max: 50000 }).withMessage('Documentation content too large (max 50KB)'),
    handleValidationErrors
  ],
  
  // Scan pitfalls validation
  scanPitfalls: [
    body('files')
      .isArray({ min: 1, max: 100 }).withMessage('Files must be an array with 1-100 items'),
    body('files.*.name')
      .trim()
      .notEmpty().withMessage('File name is required')
      .matches(/^[a-zA-Z0-9._\-/]+$/).withMessage('Invalid file name'),
    body('files.*.content')
      .isString()
      .isLength({ max: 50000 }).withMessage('File content too large (max 50KB per file)'),
    handleValidationErrors
  ],
  
  // Linting validation
  lint: [
    body('filePath')
      .trim()
      .notEmpty().withMessage('File path is required')
      .custom(isSafePath)
      .custom(fileExists),
    body('lang')
      .trim()
      .notEmpty().withMessage('Language is required')
      .isIn(['javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby', 'swift'])
      .withMessage('Unsupported language'),
    handleValidationErrors
  ],
  
  // Dependencies validation
  deps: [
    body('filePath')
      .trim()
      .notEmpty().withMessage('File path is required')
      .custom(isSafePath)
      .custom(fileExists)
      .matches(/\.(json|xml|yaml|yml|toml|lock)$/i)
      .withMessage('File must be a dependency file (package.json, pom.xml, etc.)'),
    handleValidationErrors
  ],
  
  // Knowledge base search validation
  kb: [
    body('query')
      .trim()
      .notEmpty().withMessage('Query is required')
      .isLength({ min: 3, max: 500 }).withMessage('Query must be between 3 and 500 characters')
      .escape(),
    handleValidationErrors
  ],
  
  // Workflow validation
  workflow: [
    body('errorType')
      .trim()
      .notEmpty().withMessage('Error type is required')
      .isLength({ max: 200 }).withMessage('Error type too long')
      .escape(),
    body('context')
      .optional()
      .isObject().withMessage('Context must be an object'),
    handleValidationErrors
  ],
  
  // Chat next step validation
  chatNext: [
    body('context')
      .optional()
      .isObject().withMessage('Context must be an object'),
    handleValidationErrors
  ],
  
  // Visualization validation
  visualize: [
    body('code')
      .trim()
      .notEmpty().withMessage('Code is required')
      .isLength({ min: 10, max: 50000 }).withMessage('Code must be between 10 and 50000 characters'),
    handleValidationErrors
  ],
  
  // Translation validation
  translate: [
    body('text')
      .trim()
      .notEmpty().withMessage('Text is required')
      .isLength({ min: 1, max: 10000 }).withMessage('Text must be between 1 and 10000 characters'),
    body('lang')
      .trim()
      .notEmpty().withMessage('Language is required')
      .isIn(['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi'])
      .withMessage('Unsupported language'),
    handleValidationErrors
  ]
};

/**
 * Sanitize file paths to prevent directory traversal
 */
const sanitizePath = (filePath) => {
  // Remove any potentially dangerous characters
  const cleaned = filePath.replace(/[^\w\s\-._/]/g, '');
  // Normalize the path
  return path.normalize(cleaned);
};

/**
 * Sanitize user input to prevent XSS
 */
const sanitizeInput = (input) => {
  if (typeof input === 'string') {
    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }
  return input;
};

module.exports = {
  validationRules,
  handleValidationErrors,
  sanitizePath,
  sanitizeInput,
  isSafePath,
  fileExists,
  directoryExists,
  validateApiRequest,
  validateRateLimit
};