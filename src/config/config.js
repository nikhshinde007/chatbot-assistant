// src/config/config.js
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.join(process.cwd(), envFile) });

// Validate required environment variables
const requiredEnvVars = [
  'ANTHROPIC_API_KEY',
  'DEFAULT_SOURCE_DIR'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Please check your .env file');
  process.exit(1);
}

const config = {
  // Server configuration
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || 'localhost',
    env: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    trustProxy: process.env.TRUST_PROXY === 'true'
  },

  // LLM configuration
  llm: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229',
    maxTokens: parseInt(process.env.MAX_TOKENS || '1024', 10),
    temperature: parseFloat(process.env.TEMPERATURE || '0.2'),
    timeout: parseInt(process.env.LLM_TIMEOUT || '30000', 10),
    retryAttempts: parseInt(process.env.LLM_RETRY_ATTEMPTS || '3', 10),
    retryDelay: parseInt(process.env.LLM_RETRY_DELAY || '1000', 10)
  },

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10), // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '50', 10),
    message: 'Too many requests, please try again later.'
  },

  // File handling
  files: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880', 10), // 5MB
    maxFiles: parseInt(process.env.MAX_FILES || '100', 10),
    allowedPaths: (process.env.ALLOWED_PATHS || './').split(',').map(p => p.trim()),
    allowedExtensions: {
      code: ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', '.rb', '.go', '.php', '.html', '.css', '.json', '.xml', '.md', '.sh', '.bat', '.pl', '.scala', '.swift', '.rs', '.kt', '.dart'],
      docs: ['.pdf', '.docx', '.txt', '.md', '.rst'],
      config: ['.json', '.yaml', '.yml', '.toml', '.xml', '.properties', '.ini', '.env']
    }
  },

  // Caching
  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false',
    ttl: parseInt(process.env.CACHE_TTL || '600', 10), // 10 minutes
    checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD || '120', 10) // 2 minutes
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
    maxFiles: parseInt(process.env.LOG_MAX_FILES || '30', 10),
    maxSize: process.env.LOG_MAX_SIZE || '10m'
  },

  // Security
  security: {
    helmet: process.env.HELMET_ENABLED !== 'false',
    csrf: process.env.CSRF_ENABLED === 'true',
    apiKeyHeader: process.env.API_KEY_HEADER || 'x-api-key',
    jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
    enablePathValidation: process.env.ENABLE_PATH_VALIDATION !== 'false',
    maxRequestSize: process.env.MAX_REQUEST_SIZE || '50mb'
  },
  
  auth: {
    apiKeys: process.env.API_KEYS ? process.env.API_KEYS.split(',') : [],
    jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
    sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || '3600', 10)
  },

  // Search configuration
  search: {
    maxResults: parseInt(process.env.SEARCH_MAX_RESULTS || '100', 10),
    contextLength: parseInt(process.env.SEARCH_CONTEXT_LENGTH || '80', 10),
    maxDepth: parseInt(process.env.SEARCH_MAX_DEPTH || '5', 10)
  },

  // Analysis configuration
  analysis: {
    enableProactiveScanning: process.env.ENABLE_PROACTIVE_SCANNING !== 'false',
    scanInterval: parseInt(process.env.SCAN_INTERVAL || '3600000', 10), // 1 hour
    maxAnalysisSize: parseInt(process.env.MAX_ANALYSIS_SIZE || '102400', 10) // 100KB
  },

  // Supported languages
  languages: {
    programming: ['javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby', 'swift', 'kotlin', 'dart', 'scala'],
    translation: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'nl', 'pl', 'sv']
  },

  // Database (if needed in future)
  database: {
    url: process.env.DATABASE_URL || 'sqlite://./data/chatbot-assistant.db',
    poolMin: parseInt(process.env.DB_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DB_POOL_MAX || '10', 10)
  }
};

// Create necessary directories
const ensureDirectories = () => {
  const dirs = [
    config.logging.dir,
    'data',
    'temp',
    'uploads'
  ];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  });
};

// Validate configuration
const validateConfig = () => {
  const errors = [];

  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push('Port must be between 1 and 65535');
  }

  if (config.llm.temperature < 0 || config.llm.temperature > 1) {
    errors.push('Temperature must be between 0 and 1');
  }

  if (config.files.maxFileSize < 1024) {
    errors.push('Max file size must be at least 1KB');
  }

  if (errors.length > 0) {
    console.error('Configuration errors:', errors);
    process.exit(1);
  }
};

// Initialize configuration
ensureDirectories();
validateConfig();

module.exports = config;