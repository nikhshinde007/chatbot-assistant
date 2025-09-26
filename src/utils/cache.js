const NodeCache = require('node-cache');
const config = require('../config/config');

class TraversalCache {
  constructor() {
    this.cache = new NodeCache({
      stdTTL: config.cache.ttl,
      checkperiod: config.cache.checkPeriod,
      useClones: false
    });
    this.maxSize = 1000;
    this.enabled = config.cache.enabled;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
  }
  
  get(key) {
    if (!this.enabled) return null;
    
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.stats.hits++;
      return value;
    }
    
    this.stats.misses++;
    return null;
  }
  
  set(key, value, ttl = null) {
    if (!this.enabled) return;
    
    if (this.cache.keys().length >= this.maxSize) {
      const oldestKey = this.cache.keys()[0];
      this.cache.del(oldestKey);
      this.stats.deletes++;
    }
    
    this.cache.set(key, value, ttl || config.cache.ttl);
    this.stats.sets++;
  }
  
  del(key) {
    if (!this.enabled) return;
    
    this.cache.del(key);
    this.stats.deletes++;
  }
  
  clear() {
    this.cache.flushAll();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0
    };
  }
  
  getStats() {
    return {
      ...this.stats,
      size: this.cache.keys().length,
      hitRate: this.stats.hits > 0 
        ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(2) + '%'
        : '0%'
    };
  }
}

// Global cache instance
const globalCache = new TraversalCache();

module.exports = { 
  TraversalCache,
  globalCache
};