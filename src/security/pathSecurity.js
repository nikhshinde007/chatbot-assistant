// pathSecurity.js - Enhanced security module for file path validation
const path = require('path');
const fs = require('fs');

/**
 * Express middleware for path validation
 */
const pathValidationMiddleware = () => {
  const validator = new PathSecurityValidator();
  
  return (req, res, next) => {
    // Validate any path parameters
    const pathsToValidate = [
      req.body.dir,
      req.body.filePath,
      req.query.dir,
      req.params.path
    ].filter(Boolean);
    
    for (const path of pathsToValidate) {
      const validation = validator.validatePath(path);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Invalid path',
          details: validation.error,
          code: validation.code
        });
      }
    }
    
    req.validatedPaths = pathsToValidate;
    next();
  };
};

class PathSecurityValidator {
  constructor() {
    // Comprehensive blocked paths from your security document
    this.blockedPatterns = {
      linux: [
        /^\/etc\//i,
        /^\/root\//i,
        /^\/boot\//i,
        /^\/sys\//i,
        /^\/proc\//i,
        /^\/dev\//i,
        /^\/var\/log\//i,
        /^\/usr\/bin\//i,
        /^\/usr\/sbin\//i,
        /^\/lib\//i,
        /^\/lib64\//i,
        /^\/sbin\//i,
        /^\/bin\//i,
        /^\/tmp\//i,
        /^\/var\/spool\//i,
        /^\/var\/cache\//i,
        /^\/var\/run\//i,
        /^\/lost\+found\//i
      ],
      windows: [
        /^[A-Z]:\\Windows\\/i,
        /^[A-Z]:\\Program Files\\/i,
        /^[A-Z]:\\ProgramData\\/i,
        /^[A-Z]:\\System Volume Information\\/i,
        /^[A-Z]:\\Recovery\\/i,
        /^[A-Z]:\\Boot\\/i,
        /^[A-Z]:\\\$Recycle\.Bin\\/i,
        /hiberfil\.sys$/i,
        /pagefile\.sys$/i,
        /swapfile\.sys$/i
      ],
      macos: [
        /^\/System\//i,
        /^\/Library\/Application Support\//i,
        /^\/Library\/LaunchDaemons\//i,
        /^\/Library\/LaunchAgents\//i,
        /^\/Library\/Frameworks\//i,
        /^\/private\//i,
        /^\/usr\/libexec\//i,
        /^\/Applications\/Utilities\//i
      ],
      universal: [
        /\.ssh\//i,
        /\.gnupg\//i,
        /id_rsa/i,
        /id_ed25519/i,
        /\.key$/i,
        /\.pem$/i,
        /shadow/i,
        /passwd$/i,
        /sudoers/i
      ]
    };

    this.maxPathLength = 4096;
    this.securityLog = [];
  }

  /**
   * Validate a file path for security
   * @param {string} filePath - Path to validate
   * @returns {object} - Validation result with status and message
   */
  validatePath(filePath) {
    try {
      // Step 1: Basic validation
      if (!filePath || typeof filePath !== 'string') {
        return { 
          valid: false, 
          error: 'Invalid path: must be a non-empty string',
          code: 'INVALID_INPUT'
        };
      }

      // Step 2: Length validation
      if (filePath.length > this.maxPathLength) {
        return { 
          valid: false, 
          error: `Path too long: exceeds ${this.maxPathLength} characters`,
          code: 'PATH_TOO_LONG'
        };
      }

      // Step 3: Normalize and resolve path
      const normalizedPath = path.normalize(filePath);
      const absolutePath = path.resolve(normalizedPath);

      // Step 4: Check for directory traversal
      if (normalizedPath.includes('..') || filePath.includes('..')) {
        this.logSecurityViolation('TRAVERSAL_ATTEMPT', filePath);
        return { 
          valid: false, 
          error: 'Security violation: Directory traversal detected',
          code: 'TRAVERSAL_DETECTED'
        };
      }

      // Step 5: Check against blocked patterns
      const platform = process.platform;
      const patterns = this.getPatternsByPlatform(platform);
      
      for (const pattern of patterns) {
        if (pattern.test(absolutePath)) {
          this.logSecurityViolation('BLOCKED_PATH', absolutePath);
          return { 
            valid: false, 
            error: `Access denied: Cannot access system directory`,
            code: 'BLOCKED_PATH'
          };
        }
      }

      // Step 6: Check for symlink attacks
      try {
        const stats = fs.lstatSync(absolutePath);
        if (stats.isSymbolicLink()) {
          const realPath = fs.realpathSync(absolutePath);
          // Recursively validate the real path
          const realPathValidation = this.validatePath(realPath);
          if (!realPathValidation.valid) {
            this.logSecurityViolation('SYMLINK_TO_BLOCKED', absolutePath);
            return realPathValidation;
          }
        }
      } catch (e) {
        // File doesn't exist yet, which is OK for write operations
      }

      return { valid: true, normalizedPath: absolutePath };

    } catch (error) {
      return { 
        valid: false, 
        error: `Path validation error: ${error.message}`,
        code: 'VALIDATION_ERROR'
      };
    }
  }

  /**
   * Get patterns for current platform
   */
  getPatternsByPlatform(platform) {
    let patterns = [...this.blockedPatterns.universal];
    
    switch (platform) {
      case 'win32':
        patterns.push(...this.blockedPatterns.windows);
        break;
      case 'darwin':
        patterns.push(...this.blockedPatterns.macos);
        patterns.push(...this.blockedPatterns.linux); // macOS shares some Unix paths
        break;
      default: // linux and other unix-like
        patterns.push(...this.blockedPatterns.linux);
        break;
    }
    
    return patterns;
  }

  /**
   * Log security violations for monitoring
   */
  logSecurityViolation(type, path) {
    const violation = {
      type,
      path: path.substring(0, 100), // Truncate for security
      timestamp: new Date().toISOString(),
      platform: process.platform
    };
    
    this.securityLog.push(violation);
    
    // Log to stderr for MCP servers
    console.error(`[SECURITY] ${type}: Blocked access attempt`);
    
    // Keep only last 1000 violations in memory
    if (this.securityLog.length > 1000) {
      this.securityLog = this.securityLog.slice(-1000);
    }
  }

  /**
   * Get safe alternative directories
   */
  getSafeAlternatives() {
    const home = process.env.HOME || process.env.USERPROFILE;
    return {
      documents: path.join(home, 'Documents'),
      desktop: path.join(home, 'Desktop'),
      downloads: path.join(home, 'Downloads'),
      projects: path.join(home, 'Projects'),
      workspace: path.join(home, 'workspace')
    };
  }

  /**
   * Validate multiple paths at once
   */
  validatePaths(paths) {
    return paths.map(p => ({
      path: p,
      ...this.validatePath(p)
    }));
  }

  /**
   * Get security statistics
   */
  getSecurityStats() {
    const stats = {
      totalViolations: this.securityLog.length,
      violationsByType: {},
      recentViolations: this.securityLog.slice(-10)
    };
    
    this.securityLog.forEach(v => {
      stats.violationsByType[v.type] = (stats.violationsByType[v.type] || 0) + 1;
    });
    
    return stats;
  }
}

// Authentication module
class APIKeyValidator {
  constructor() {
    this.validKeys = new Set();
    // In production, load from secure storage
    this.loadKeys();
  }

  loadKeys() {
    // Load from environment or secure storage
    const keys = process.env.API_KEYS ? process.env.API_KEYS.split(',') : [];
    keys.forEach(key => this.validKeys.add(key.trim()));
  }

  validateKey(key) {
    if (!key || typeof key !== 'string') {
      return { valid: false, error: 'Missing or invalid API key' };
    }

    // Remove Bearer prefix if present
    const cleanKey = key.replace(/^Bearer\s+/i, '').trim();

    // Check format (32 alphanumeric characters)
    if (!/^[a-zA-Z0-9_]{32,}$/.test(cleanKey)) {
      return { valid: false, error: 'Invalid API key format' };
    }

    // Check against valid keys
    if (!this.validKeys.has(cleanKey)) {
      return { valid: false, error: 'Invalid API key' };
    }

    return { valid: true, key: cleanKey };
  }

  /**
   * Express middleware for API key validation
   */
  middleware() {
    return (req, res, next) => {
      const key = req.headers.authorization || req.query.api_key;
      const validation = this.validateKey(key);
      
      if (!validation.valid) {
        return res.status(401).json({
          error: 'Authentication failed',
          message: validation.error
        });
      }
      
      req.apiKey = validation.key;
      next();
    };
  }
}

// Export both modules
module.exports = {
  PathSecurityValidator,
  APIKeyValidator,
  pathValidationMiddleware
};