const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config/config');
const { logger } = require('./errorHandler');

class AuthenticationManager {
  constructor() {
    this.apiKeys = new Set(config.auth.apiKeys);
    this.activeSessions = new Map();
    this.rateLimiters = new Map();
  }

  /**
   * API Key authentication middleware
   */
  apiKeyAuth() {
    return (req, res, next) => {
      const apiKey = req.headers[config.security.apiKeyHeader] || 
                    req.headers.authorization?.replace('Bearer ', '') ||
                    req.query.api_key;

      if (!apiKey) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'API key must be provided'
        });
      }

      if (!this.apiKeys.has(apiKey)) {
        logger.warn(`Invalid API key attempt from ${req.ip}`, { 
          userAgent: req.get('user-agent'),
          path: req.path 
        });
        
        return res.status(401).json({
          error: 'Invalid API key',
          message: 'The provided API key is not valid'
        });
      }

      req.apiKey = apiKey;
      req.authenticated = true;
      next();
    };
  }

  /**
   * Optional API key authentication (allows public access)
   */
  optionalApiKeyAuth() {
    return (req, res, next) => {
      const apiKey = req.headers[config.security.apiKeyHeader] || 
                    req.query.api_key;

      if (apiKey && this.apiKeys.has(apiKey)) {
        req.apiKey = apiKey;
        req.authenticated = true;
      } else {
        req.authenticated = false;
      }

      next();
    };
  }

  /**
   * Session-based authentication
   */
  sessionAuth() {
    return (req, res, next) => {
      const sessionId = req.headers['x-session-id'] || req.query.session_id;

      if (!sessionId) {
        return res.status(401).json({
          error: 'Session required',
          message: 'Session ID must be provided'
        });
      }

      const session = this.activeSessions.get(sessionId);
      if (!session || session.expires < Date.now()) {
        if (session) {
          this.activeSessions.delete(sessionId);
        }
        
        return res.status(401).json({
          error: 'Session expired',
          message: 'Please create a new session'
        });
      }

      // Update session expiry
      session.expires = Date.now() + config.auth.sessionTimeout * 1000;
      req.session = session;
      req.authenticated = true;
      next();
    };
  }

  /**
   * Create a new session
   */
  createSession(apiKey, metadata = {}) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const session = {
      id: sessionId,
      apiKey,
      created: Date.now(),
      expires: Date.now() + config.auth.sessionTimeout * 1000,
      metadata
    };

    this.activeSessions.set(sessionId, session);
    return session;
  }

  /**
   * Revoke a session
   */
  revokeSession(sessionId) {
    return this.activeSessions.delete(sessionId);
  }

  /**
   * Clean up expired sessions
   */
  cleanupSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.activeSessions) {
      if (session.expires < now) {
        this.activeSessions.delete(sessionId);
      }
    }
  }

  /**
   * Get authentication statistics
   */
  getStats() {
    const now = Date.now();
    const activeSessions = Array.from(this.activeSessions.values())
      .filter(session => session.expires > now);

    return {
      totalApiKeys: this.apiKeys.size,
      activeSessions: activeSessions.length,
      totalSessions: this.activeSessions.size,
      oldestSession: activeSessions.length > 0 
        ? Math.min(...activeSessions.map(s => s.created))
        : null
    };
  }
}

// Singleton instance
const authManager = new AuthenticationManager();

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  authManager.cleanupSessions();
}, 5 * 60 * 1000);

module.exports = {
  AuthenticationManager,
  authManager,
  apiKeyAuth: () => authManager.apiKeyAuth(),
  optionalApiKeyAuth: () => authManager.optionalApiKeyAuth(),
  sessionAuth: () => authManager.sessionAuth()
};