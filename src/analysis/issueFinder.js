const { callLLM } = require('../integration/llmClient');
const { EnhancedIssueFinder } = require('./enhancedIssueFinder');
const { AnalysisFormatter } = require('./analysisFormatter');
const { EnhancedTraversalAnalyzer } = require('../analysis/enhancedTraversalAnalyzer');

/**
 * Enhanced Issue Finder - Integrates LLM analysis with code traversal
 * Provides backward compatibility while adding new enhanced features
 */

/**
 * Main analysis function - supports both basic and enhanced modes
 * @param {string} snippet - Code snippet to analyze
 * @param {string} file - Source file name
 * @param {string} extraContext - Additional context information
 * @param {string} searchDirectory - Optional directory for traversal analysis
 * @param {object} options - Analysis options
 * @returns {object} Analysis result
 */
async function analyzeSnippet(snippet, file, extraContext = "", searchDirectory = null, options = {}) {
  const {
    useEnhanced = true,
    fallbackToLLM = true,
    outputFormat = 'json',
    includeTraversal = !!searchDirectory
  } = options;

  try {
    // First try enhanced traversal analysis if available and requested
    if (useEnhanced && includeTraversal && searchDirectory) {
      const traversalAnalyzer = new EnhancedTraversalAnalyzer();
      const traversalResults = await traversalAnalyzer.analyzeWithTraversal(
        snippet, 
        file, 
        searchDirectory, 
        extraContext
      );
      
      if (traversalResults && !traversalResults.error) {
        return formatAnalysisResult(traversalResults, outputFormat, options);
      }
    }
	
    // If enhanced analysis is requested and search directory is provided
    if (useEnhanced && includeTraversal && searchDirectory) {
      return await analyzeSnippetEnhanced(snippet, file, extraContext, searchDirectory, options);
    }
    
    // Fall back to basic LLM analysis
    if (fallbackToLLM) {
      return await analyzeSnippetBasic(snippet, file, extraContext, options);
    }
    
    // If no LLM fallback, use enhanced without traversal
    if (useEnhanced) {
      return await analyzeSnippetEnhanced(snippet, file, extraContext, null, options);
    }
    
    throw new Error('No analysis method available with current options');
    
  } catch (error) {
    console.error('Error in analyzeSnippet:', error);
    
    // Emergency fallback to basic analysis
    if (fallbackToLLM) {
      try {
        const basicResult = await analyzeSnippetBasic(snippet, file, extraContext, options);
        basicResult.fallbackUsed = true;
        basicResult.originalError = error.message;
        return basicResult;
      } catch (fallbackError) {
        return createErrorResponse(error, fallbackError, snippet, file);
      }
    }
    
    return createErrorResponse(error, null, snippet, file);
  }
}

/**
 * Enhanced analysis using code traversal and pattern matching
 */
async function analyzeSnippetEnhanced(snippet, file, extraContext = "", searchDirectory = null, options = {}) {
  try {
    const enhancedFinder = new EnhancedIssueFinder();
    
    const analysis = await enhancedFinder.analyzeSnippetWithTraversal(
      snippet, 
      file, 
      extraContext, 
      searchDirectory
    );

    // Format output based on requested format
    const outputFormat = options.outputFormat || 'json';
    
    const result = {
      analysisType: 'enhanced',
      timestamp: analysis.timestamp,
      hasTraversalData: !!searchDirectory,
      ...analysis.combinedAnalysis
    };

    // Add formatted output if requested
    if (outputFormat !== 'raw') {
      result.formattedOutput = AnalysisFormatter.format(analysis, outputFormat);
    }

    // Add raw analysis data if requested
    if (options.includeRawData) {
      result.rawAnalysis = {
        basic: analysis.basicAnalysis,
        traversal: analysis.traversalAnalysis,
        combined: analysis.combinedAnalysis
      };
    }

    return result;
    
  } catch (error) {
    console.error('Enhanced analysis failed:', error);
    
    // If fallback is enabled, try basic analysis
    if (options.fallbackToLLM !== false) {
      const basicResult = await analyzeSnippetBasic(snippet, file, extraContext, options);
      basicResult.enhancedFailed = true;
      basicResult.enhancedError = error.message;
      return basicResult;
    }
    
    throw error;
  }
}

/**
 * Basic LLM-powered analysis (original functionality)
 */
async function analyzeSnippetBasic(snippet, file, extraContext = "", options = {}) {
  const prompt = `
You are an expert code and document diagnostician. Given the following code or documentation snippet (with some extra context):

File: ${file}
Snippet:
"""
${snippet}
"""

${extraContext ? "Extra context:\n" + extraContext : ""}

Detect if there is an issue, explain the likely root cause, and give clear actionable tips or code suggestions to fix it.
Respond in JSON with keys: "issue", "rootCause", "tips".

Additionally, identify:
- Any error codes (like MIGERROR-XXX)
- Constants or configuration references
- Method calls that might need investigation
- Validation patterns
- Database or configuration dependencies

Include these in your analysis.
`;

  try {
    const llmResponse = await callLLM(prompt, {
      temperature: options.temperature || 0.2,
      max_tokens: options.maxTokens || 512
    });
    
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(llmResponse);
    } catch (parseError) {
      // Fallback parsing if JSON is malformed
      parsedResponse = {
        issue: "LLM response parsing failed",
        rootCause: llmResponse,
        tips: ["Please check the response format"]
      };
    }

    // Enhance basic analysis with some pattern detection
    const enhancedBasic = enhanceBasicAnalysis(parsedResponse, snippet, file);
    
    const result = {
      analysisType: 'basic_llm',
      timestamp: new Date().toISOString(),
      hasTraversalData: false,
      ...enhancedBasic
    };

    // Add formatted output if requested
    const outputFormat = options.outputFormat || 'json';
    if (outputFormat !== 'raw') {
      // Create analysis structure compatible with formatter
      const analysisForFormatter = {
        file,
        snippet,
        timestamp: result.timestamp,
        combinedAnalysis: result,
        basicAnalysis: { errorCodes: result.errorCodes || [] }
      };
      result.formattedOutput = AnalysisFormatter.format(analysisForFormatter, outputFormat);
    }

    return result;
    
  } catch (error) {
    console.error('LLM analysis failed:', error);
    throw error;
  }
}

/**
 * Enhance basic LLM analysis with pattern detection
 */
function enhanceBasicAnalysis(basicAnalysis, snippet, file) {
  const enhanced = { ...basicAnalysis };
  
  // Extract error codes
  enhanced.errorCodes = extractErrorCodes(snippet);
  
  // Extract patterns
  enhanced.patterns = identifyBasicPatterns(snippet);
  
  // Extract code elements
  enhanced.codeElements = {
    methodCalls: extractMethodCalls(snippet),
    constants: extractConstants(snippet),
    variables: extractVariables(snippet)
  };
  
  // Generate basic recommendations
  enhanced.recommendations = generateBasicRecommendations(enhanced, snippet);
  
  // Add metadata
  enhanced.metadata = {
    file,
    linesOfCode: snippet.split('\n').length,
    hasValidation: snippet.includes('Valid') || snippet.includes('check'),
    hasLogging: snippet.includes('LOGGER') || snippet.includes('log'),
    hasConfiguration: snippet.includes('ConfigStore') || snippet.includes('Const.'),
    hasConditional: snippet.includes('if (') || snippet.includes('while (')
  };
  
  return enhanced;
}

/**
 * Generate basic recommendations from pattern analysis
 */
function generateBasicRecommendations(analysis, snippet) {
  const recommendations = [];
  
  // Error code recommendations
  if (analysis.errorCodes && analysis.errorCodes.length > 0) {
    recommendations.push({
      type: 'error_investigation',
      priority: 'high',
      title: `Investigate error codes: ${analysis.errorCodes.join(', ')}`,
      description: 'Error codes found in snippet require investigation',
      action: 'Trace error codes to understand validation failures'
    });
  }
  
  // Validation recommendations
  if (analysis.patterns && analysis.patterns.includes('validation')) {
    recommendations.push({
      type: 'validation_check',
      priority: 'high',
      title: 'Verify validation logic and input data',
      description: 'Validation patterns detected - check input data format',
      action: 'Review validation rules and verify input data matches expected format'
    });
  }
  
  // Configuration recommendations
  if (analysis.codeElements && analysis.codeElements.constants.some(c => c.includes('ConfigStore'))) {
    recommendations.push({
      type: 'configuration_check',
      priority: 'medium',
      title: 'Verify configuration data availability',
      description: 'Configuration references found - ensure data is loaded',
      action: 'Check that configuration data is properly loaded and accessible'
    });
  }
  
  // Method call recommendations
  if (analysis.codeElements && analysis.codeElements.methodCalls.length > 0) {
    recommendations.push({
      type: 'method_verification',
      priority: 'medium',
      title: 'Verify method call parameters and return values',
      description: 'Multiple method calls detected',
      action: 'Check method parameters, return values, and error handling'
    });
  }
  
  return recommendations;
}

/**
 * Create error response structure
 */
function createErrorResponse(primaryError, fallbackError, snippet, file) {
  return {
    analysisType: 'error',
    timestamp: new Date().toISOString(),
    error: primaryError.message,
    fallbackError: fallbackError?.message || null,
    issue: `Analysis failed: ${primaryError.message}`,
    rootCause: 'Internal analysis error occurred',
    tips: [
      'Check if the code snippet is valid',
      'Verify that all dependencies are available',
      'Try again with a simpler code snippet'
    ],
    metadata: {
      file,
      snippet: snippet.substring(0, 100) + '...', // Truncated for error logging
      failed: true
    }
  };
}

// Utility functions for pattern extraction
function extractErrorCodes(snippet) {
  const errorPattern = /\b[A-Z]+ERROR-\d+\b|\b[A-Z]+ERR-\d+\b/g;
  return snippet.match(errorPattern) || [];
}

function identifyBasicPatterns(snippet) {
  const patterns = [];
  
  if (/if\s*\(\s*!\s*.*Valid.*\)/i.test(snippet)) {
    patterns.push('validation');
  }
  if (/LOGGER\.(info|error|warn)/i.test(snippet)) {
    patterns.push('logging');
  }
  if (/ConfigStore\.\w+/.test(snippet)) {
    patterns.push('configuration');
  }
  if (/if\s*\(.*\s*[<>]=?\s*.*\)/.test(snippet)) {
    patterns.push('comparison');
  }
  if (/try\s*\{|catch\s*\(/.test(snippet)) {
    patterns.push('exception_handling');
  }
  
  return patterns;
}

function extractMethodCalls(snippet) {
  const methodPattern = /\b\w+\.\w+\s*\(/g;
  const matches = snippet.match(methodPattern) || [];
  return matches.map(m => m.replace(/\s*\($/, ''));
}

function extractConstants(snippet) {
  const constantPattern = /\b[A-Z][A-Z0-9_]{2,}\b/g;
  const configPattern = /\b(ConfigStore|Const)\.\w+/g;
  
  const constants = snippet.match(constantPattern) || [];
  const configs = snippet.match(configPattern) || [];
  
  return [...new Set([...constants, ...configs])];
}

function extractVariables(snippet) {
  const varPattern = /\b[a-z]\w*\./g;
  const matches = snippet.match(varPattern) || [];
  return [...new Set(matches.map(m => m.replace('.', '')))];
}

/**
 * Specialized analysis for specific error types
 */
async function analyzeSpecificError(errorCode, snippet, file, searchDirectory = null, options = {}) {
  try {
    // Use enhanced analysis if directory provided
    if (searchDirectory) {
      const enhancedFinder = new EnhancedIssueFinder();
      const analysis = await enhancedFinder.analyzeSnippetWithTraversal(
        snippet, file, `Analyzing specific error: ${errorCode}`, searchDirectory
      );
      
      // Filter results to focus on the specific error
      if (analysis.traversalAnalysis && analysis.traversalAnalysis.dependencies) {
        const errorSpecific = analysis.traversalAnalysis.dependencies[errorCode];
        if (errorSpecific) {
          return {
            analysisType: 'error_specific',
            errorCode,
            timestamp: analysis.timestamp,
            ...errorSpecific,
            recommendations: analysis.combinedAnalysis.recommendations || []
          };
        }
      }
    }
    
    // Fallback to general analysis
    return await analyzeSnippet(snippet, file, `Specific error analysis: ${errorCode}`, searchDirectory, options);
    
  } catch (error) {
    console.error(`Error analyzing specific error ${errorCode}:`, error);
    throw error;
  }
}

/**
 * Batch analysis for multiple snippets
 */
async function analyzeMultipleSnippets(snippets, options = {}) {
  const results = [];
  const { 
    maxConcurrent = 3,
    continueOnError = true 
  } = options;
  
  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < snippets.length; i += maxConcurrent) {
    const batch = snippets.slice(i, i + maxConcurrent);
    const batchPromises = batch.map(async (snippetInfo, index) => {
      try {
        const result = await analyzeSnippet(
          snippetInfo.snippet,
          snippetInfo.file || `snippet_${i + index}`,
          snippetInfo.context || '',
          snippetInfo.searchDirectory || options.searchDirectory,
          options
        );
        return { index: i + index, success: true, result };
      } catch (error) {
        if (continueOnError) {
          return { 
            index: i + index, 
            success: false, 
            error: error.message,
            snippet: snippetInfo.snippet.substring(0, 50) + '...'
          };
        }
        throw error;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return {
    total: snippets.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  };
}

/**
 * Analysis with caching support
 */
const analysisCache = new Map();

async function analyzeSnippetWithCache(snippet, file, extraContext = "", searchDirectory = null, options = {}) {
  const { useCache = true, cacheTimeout = 300000 } = options; // 5 minute default
  
  if (!useCache) {
    return await analyzeSnippet(snippet, file, extraContext, searchDirectory, options);
  }
  
  // Create cache key
  const cacheKey = createCacheKey(snippet, file, extraContext, searchDirectory);
  
  // Check cache
  const cached = analysisCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < cacheTimeout) {
    return { ...cached.result, fromCache: true };
  }
  
  // Perform analysis
  const result = await analyzeSnippet(snippet, file, extraContext, searchDirectory, options);
  
  // Cache result
  analysisCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });
  
  return result;
}

function createCacheKey(snippet, file, extraContext, searchDirectory) {
  const crypto = require('crypto');
  const data = `${snippet}|${file}|${extraContext}|${searchDirectory || ''}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Clear analysis cache
 */
function clearAnalysisCache() {
  analysisCache.clear();
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return {
    size: analysisCache.size,
    entries: Array.from(analysisCache.keys()).map(key => ({
      key: key.substring(0, 8) + '...',
      age: Date.now() - (analysisCache.get(key)?.timestamp || 0)
    }))
  };
}

// Export all functions
module.exports = {
  analyzeSnippet,
  analyzeSnippetEnhanced,
  analyzeSnippetBasic,
  analyzeSpecificError,
  analyzeMultipleSnippets,
  analyzeSnippetWithCache,
  clearAnalysisCache,
  getCacheStats,
  
  // Utility functions
  extractErrorCodes,
  identifyBasicPatterns,
  extractMethodCalls,
  extractConstants,
  extractVariables
};