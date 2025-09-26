// src/integration/llmClient.js
const axios = require('axios');
const crypto = require('crypto');
const NodeCache = require('node-cache');

const config = require('../config/config');

// Initialize cache with 10-minute TTL
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// Rate limiting
const rateLimiter = {
  requests: [],
  maxRequests: 50,
  windowMs: 60000, // 1 minute
  
  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    this.requests.push(now);
    return true;
  },
  
  timeUntilNextRequest() {
    if (this.requests.length < this.maxRequests) return 0;
    const oldestRequest = this.requests[0];
    const now = Date.now();
    return Math.max(0, this.windowMs - (now - oldestRequest));
  }
};

/**
 * Modern Claude API client with caching and rate limiting
 * @param {string} prompt - The prompt to send to Claude
 * @param {object} options - Configuration options
 * @param {number} options.max_tokens - Maximum tokens in response
 * @param {number} options.temperature - Response randomness (0-1)
 * @param {string} options.model - Claude model to use
 * @param {boolean} options.useCache - Whether to use caching
 * @returns {Promise<string>} - Claude's response
 */
async function callLLM(prompt, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  
  // Check cache if enabled
  if (options.useCache !== false) {
    const cacheKey = crypto.createHash('md5')
      .update(JSON.stringify({ prompt, ...options }))
      .digest('hex');
    
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('[LLM] Cache hit');
      return cached;
    }
  }
  
  // Rate limiting check
  if (!rateLimiter.canMakeRequest()) {
    const waitTime = rateLimiter.timeUntilNextRequest();
    throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(waitTime / 1000)} seconds`);
  }
  
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: options.model || process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: options.max_tokens || 1024,
        temperature: options.temperature || 0.2,
        system: options.system || 'You are a helpful technical assistant specializing in code migration, debugging, and software development best practices.'
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: options.timeout || 30000 // 30 second timeout
      }
    );
    
    const result = response.data.content[0].text;
    
    // Cache the result if caching is enabled
    if (options.useCache !== false) {
      const cacheKey = crypto.createHash('md5')
        .update(JSON.stringify({ prompt, ...options }))
        .digest('hex');
      cache.set(cacheKey, result);
    }
    
    return result;
  } catch (error) {
    console.error('[LLM] API call failed:', error.message);
    
    if (error.response) {
      // API responded with error
      const status = error.response.status;
      const errorMessage = error.response.data?.error?.message || 'Unknown error';
      
      switch (status) {
        case 401:
          throw new Error('Invalid API key');
        case 429:
          throw new Error('Rate limit exceeded by API');
        case 400:
          throw new Error(`Bad request: ${errorMessage}`);
        case 500:
        case 502:
        case 503:
          throw new Error('Claude API is temporarily unavailable');
        default:
          throw new Error(`API error (${status}): ${errorMessage}`);
      }
    } else if (error.request) {
      // Request made but no response
      throw new Error('No response from Claude API - check your connection');
    } else {
      // Error in request setup
      throw error;
    }
  }
}

/**
 * Batch process multiple prompts efficiently
 * @param {Array<{prompt: string, options?: object}>} requests 
 * @returns {Promise<string[]>} Array of responses
 */
async function batchCallLLM(requests) {
  const results = [];
  
  for (const request of requests) {
    try {
      const result = await callLLM(request.prompt, request.options || {});
      results.push(result);
      
      // Small delay between requests to be respectful of API
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      results.push(`[Error: ${error.message}]`);
    }
  }
  
  return results;
}

/**
 * Clear the cache
 */
function clearCache() {
  cache.flushAll();
  console.log('[LLM] Cache cleared');
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return cache.getStats();
}

module.exports = {
  callLLM,
  batchCallLLM,
  clearCache,
  getCacheStats
};