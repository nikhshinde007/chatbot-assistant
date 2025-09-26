#!/usr/bin/env node

/**
 * Enhanced MCP Server for Migration Assistant with Improved Traversal and Analysis
 * This version includes better tracing for arrays, constants, and database queries
 * 
 * IMPORTANT: All logging must go to stderr in MCP servers!
 * stdout is reserved for JSON-RPC protocol messages only.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const { TableRegistry } = require('./registry/tableRegistry');
const { ResponseValidator } = require('./response/responseValidator');
const { PathSecurityValidator, APIKeyValidator } = require('./security/pathSecurity');
const { EnhancedTraversalAnalyzer } = require('./analysis/EnhancedTraversalAnalyzer');

const pathValidator = new PathSecurityValidator();
const apiValidator = new APIKeyValidator();

// New class for Jira Integration Support
// Enhanced JiraIntegrationHelper class for index.js
// Replace the existing JiraIntegrationHelper class with this updated version

class JiraIntegrationHelper {
  constructor() {
    this.analysisCache = new Map();
    this.jiraTemplate = {
      projectKey: "CER", // Default project key
      issueType: "Problem", // Default issue type
      components: ["Billing"], // Default components
      customFields: {
        customfield_10015: ["Jersey Telecom"], // Customer field
        customfield_10014: "Support" // Category field
      },
      versions: ["manx_cerillion_6_03"], // Default version
      priority: "Medium", // Default priority
      environment: "Development", // Default environment
      labels: ["automated-analysis"] // Default labels
    };
  }

  /**
   * Prepare Jira issue data using your specific template format
   */
  prepareJiraIssueData(analysisResult, userInput = {}) {
    const {
      projectKey = this.jiraTemplate.projectKey,
      summary = '',
      description = '',
      priority = this.determinePriority(analysisResult),
      issueType = this.determineIssueType(analysisResult),
      assignee = null,
      environment = this.jiraTemplate.environment,
      components = [...this.jiraTemplate.components],
      labels = [],
      customFields = {},
      versions = [...this.jiraTemplate.versions],
      incidentId = null
    } = userInput;

    // Build comprehensive summary
    let issueSummary = summary;
    if (!issueSummary && analysisResult.explanation) {
      const fileName = analysisResult.file ? analysisResult.file.split('/').pop() : 'code';
      const issueType = this.extractIssueType(analysisResult);
      issueSummary = `${issueType} in ${fileName} - ${this.extractMainIssue(analysisResult.explanation)}`;
    }
    if (!issueSummary) {
      issueSummary = `Code analysis issue detected in ${analysisResult.file || 'unknown file'}`;
    }

    // Build detailed description using your format
    let issueDescription = description;
    if (!issueDescription) {
      issueDescription = this.buildJiraDescription(analysisResult);
    }

    // Determine components based on analysis
    const analysisComponents = this.extractComponents(analysisResult);
    const finalComponents = [...new Set([...components, ...analysisComponents])];

    // Build labels from analysis
    const analysisLabels = this.generateLabels(analysisResult);
    const finalLabels = [...new Set([...this.jiraTemplate.labels, ...analysisLabels, ...labels])];

    // Merge custom fields
    const finalCustomFields = {
      ...this.jiraTemplate.customFields,
      ...customFields
    };

    // Add incident ID if provided
    if (incidentId) {
      finalCustomFields.customfield_10012 = incidentId;
    }

    const jiraIssue = {
      projectKey,
      issueType: issueType || this.jiraTemplate.issueType,
      summary: issueSummary,
      description: issueDescription,
      components: finalComponents,
      customFields: finalCustomFields,
      versions: versions,
      assignee: assignee,
      priority: priority,
      environment: environment,
      labels: finalLabels,
      analysisId: this.storeAnalysis(analysisResult)
    };

    return jiraIssue;
  }

  /**
   * Build Jira description following your standard format
   */
  buildJiraDescription(analysisResult) {
    let description = '';
    
    // Main issue description
    if (analysisResult.explanation) {
      description += `${analysisResult.explanation}\n\n`;
    }

    // Steps to reproduce / Analysis details
    description += `## Analysis Details\n\n`;
    description += `**File:** ${analysisResult.file || 'Unknown'}\n`;
    description += `**Language:** ${analysisResult.language || 'Unknown'}\n`;
    description += `**Analysis Type:** Automated code traversal and pattern analysis\n`;
    
    if (analysisResult.metadata?.lineCount) {
      description += `**Lines of Code:** ${analysisResult.metadata.lineCount}\n`;
    }

    // Technical findings
    if (analysisResult.analysis?.immediateIssue) {
      description += `\n**Issue Type:** ${analysisResult.analysis.immediateIssue.issue || 'Code pattern issue'}\n`;
      description += `**Root Cause:** ${analysisResult.analysis.immediateIssue.rootCause || 'Analysis based on code patterns'}\n`;
    }

    // Expected vs Actual (if we can determine)
    description += `\n**Expected:** Code should execute without errors\n`;
    description += `**Actual:** ${this.extractActualProblem(analysisResult)}\n`;

    // Impact assessment
    description += `\n**Impact:** ${this.assessImpact(analysisResult)}\n`;

    // Technical recommendations
    if (analysisResult.analysis?.recommendations?.length > 0) {
      description += `\n## Technical Recommendations\n\n`;
      analysisResult.analysis.recommendations.slice(0, 3).forEach((rec, index) => {
        const priority = rec.priority || 'medium';
        const priorityEmoji = priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢';
        
        description += `${index + 1}. ${priorityEmoji} **${rec.title || rec.type}** (${priority} priority)\n`;
        description += `   ${rec.description || rec.message || 'No description provided'}\n`;
        if (rec.action || rec.suggestion) {
          description += `   *Action:* ${rec.action || rec.suggestion}\n`;
        }
        description += `\n`;
      });
    }

    // Code snippet (if reasonable size)
    if (analysisResult.analysis?.snippet && analysisResult.analysis.snippet.length < 800) {
      description += `## Code Snippet\n\n`;
      description += `{code:${analysisResult.language || 'java'}}\n`;
      description += analysisResult.analysis.snippet;
      description += `\n{code}\n\n`;
    }

    // Dependencies and configuration info
    if (analysisResult.resolved?.constants?.length > 0 || analysisResult.resolved?.arrays?.length > 0) {
      description += `## Technical Context\n\n`;
      
      if (analysisResult.resolved.constants?.length > 0) {
        description += `**Constants Found:** ${analysisResult.resolved.constants.length}\n`;
        analysisResult.resolved.constants.slice(0, 3).forEach(constant => {
          description += `- ${constant.name}: ${constant.value}\n`;
        });
      }
      
      if (analysisResult.resolved.arrays?.length > 0) {
        description += `**Data Structures:** ${analysisResult.resolved.arrays.length}\n`;
        analysisResult.resolved.arrays.slice(0, 3).forEach(array => {
          if (array.type === 'database') {
            description += `- Database Table: ${array.table}\n`;
          } else {
            description += `- Collection: ${array.name || 'Unknown'}\n`;
          }
        });
      }
    }

    // Add automation footer
    description += `\n---\n`;
    description += `*This issue was automatically created by ChatBot Assistant MCP Server based on code analysis.*\n`;
    description += `*Analysis performed on: ${new Date().toISOString()}*`;

    return description;
  }

  /**
   * Determine priority based on analysis results
   */
  determinePriority(analysisResult) {
    // High priority indicators
    const highPriorityKeywords = [
      'exception', 'error', 'crash', 'failure', 'null pointer', 'security',
      'authentication', 'authorization', 'database', 'connection', 'timeout',
      'production', 'critical', 'billing', 'payment'
    ];
    
    const explanation = (analysisResult.explanation || '').toLowerCase();
    const hasHighPriority = highPriorityKeywords.some(keyword => 
      explanation.includes(keyword)
    );
    
    if (hasHighPriority) return 'High';
    
    // Check recommendations priority
    if (analysisResult.analysis?.recommendations?.some(r => r.priority === 'high')) {
      return 'High';
    }
    
    // Medium priority for general code issues
    if (analysisResult.explanation) return 'Medium';
    
    return 'Low';
  }

  /**
   * Determine issue type based on analysis
   */
  determineIssueType(analysisResult) {
    const explanation = (analysisResult.explanation || '').toLowerCase();
    
    if (explanation.includes('exception') || 
        explanation.includes('error') || 
        explanation.includes('crash') ||
        explanation.includes('fail')) {
      return 'Problem';
    }
    
    if (explanation.includes('performance') || 
        explanation.includes('optimization') ||
        explanation.includes('improvement')) {
      return 'Improvement';
    }
    
    if (explanation.includes('feature') || 
        explanation.includes('enhancement')) {
      return 'Change Request';
    }
    
    return 'Problem'; // Default
  }

  /**
   * Extract components based on file path and analysis
   */
  extractComponents(analysisResult) {
    const components = [];
    
    if (analysisResult.file) {
      const filePath = analysisResult.file.toLowerCase();
      
      // Map file paths to components
      if (filePath.includes('billing') || filePath.includes('invoice')) {
        components.push('Billing');
      } else if (filePath.includes('user') || filePath.includes('auth')) {
        components.push('Authentication');
      } else if (filePath.includes('report')) {
        components.push('Reporting');
      } else if (filePath.includes('api') || filePath.includes('service')) {
        components.push('API');
      } else if (filePath.includes('database') || filePath.includes('dao')) {
        components.push('Database');
      } else {
        components.push('General');
      }
    }
    
    return components;
  }

  /**
   * Generate labels based on analysis results
   */
  generateLabels(analysisResult) {
    const labels = [];
    
    // Language-based labels
    if (analysisResult.language) {
      labels.push(analysisResult.language.toLowerCase());
    }
    
    // Analysis type labels
    labels.push('code-analysis');
    labels.push('automated');
    
    // Issue type labels
    if (analysisResult.explanation) {
      const explanation = analysisResult.explanation.toLowerCase();
      
      if (explanation.includes('null')) labels.push('null-pointer');
      if (explanation.includes('validation')) labels.push('validation');
      if (explanation.includes('database')) labels.push('database');
      if (explanation.includes('configuration')) labels.push('configuration');
      if (explanation.includes('authentication')) labels.push('auth');
      if (explanation.includes('performance')) labels.push('performance');
      if (explanation.includes('exception')) labels.push('exception');
      if (explanation.includes('error')) labels.push('error');
    }
    
    // Technical context labels
    if (analysisResult.resolved?.arrays?.some(a => a.type === 'database')) {
      labels.push('database-related');
    }
    
    return labels.slice(0, 10); // Limit to 10 labels
  }

  /**
   * Extract main issue for summary
   */
  extractMainIssue(explanation) {
    // Extract the first sentence or key issue
    const sentences = explanation.split(/[.!?]/);
    let mainIssue = sentences[0].trim();
    
    // Limit length for summary
    if (mainIssue.length > 50) {
      mainIssue = mainIssue.substring(0, 50) + '...';
    }
    
    return mainIssue;
  }

  /**
   * Extract issue type for summary
   */
  extractIssueType(analysisResult) {
    const explanation = (analysisResult.explanation || '').toLowerCase();
    
    if (explanation.includes('null pointer')) return 'NullPointerException';
    if (explanation.includes('validation')) return 'Validation Error';
    if (explanation.includes('configuration')) return 'Configuration Issue';
    if (explanation.includes('database')) return 'Database Error';
    if (explanation.includes('authentication')) return 'Auth Error';
    if (explanation.includes('exception')) return 'Exception';
    if (explanation.includes('error')) return 'Error';
    
    return 'Code Issue';
  }

  /**
   * Extract actual problem description
   */
  extractActualProblem(analysisResult) {
    if (analysisResult.analysis?.immediateIssue?.issue) {
      return analysisResult.analysis.immediateIssue.issue;
    }
    
    if (analysisResult.explanation) {
      const sentences = analysisResult.explanation.split(/[.!?]/);
      return sentences[0].trim();
    }
    
    return 'Code analysis detected potential issues';
  }

  /**
   * Assess impact based on analysis
   */
  assessImpact(analysisResult) {
    const explanation = (analysisResult.explanation || '').toLowerCase();
    
    if (explanation.includes('crash') || explanation.includes('exception')) {
      return 'System may crash or fail to process requests';
    }
    
    if (explanation.includes('null pointer')) {
      return 'Application may throw NullPointerException during execution';
    }
    
    if (explanation.includes('validation')) {
      return 'Invalid data may be processed, leading to data integrity issues';
    }
    
    if (explanation.includes('database')) {
      return 'Database operations may fail or return incorrect results';
    }
    
    if (explanation.includes('authentication')) {
      return 'Security vulnerability - authentication may be bypassed';
    }
    
    return 'Potential runtime issues or unexpected behavior';
  }

  /**
   * Store analysis result for later reference
   */
  storeAnalysis(analysisResult) {
    const id = `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.analysisCache.set(id, {
      result: analysisResult,
      timestamp: new Date().toISOString(),
      id: id
    });

    // Clean up old entries (keep last 100)
    if (this.analysisCache.size > 100) {
      const entries = Array.from(this.analysisCache.entries());
      entries.slice(0, this.analysisCache.size - 100).forEach(([key]) => {
        this.analysisCache.delete(key);
      });
    }
    
    return id;
  }

  /**
   * Get stored analysis by ID
   */
  getAnalysis(analysisId) {
    return this.analysisCache.get(analysisId);
  }

  /**
   * Format analysis summary for user confirmation
   */
  formatAnalysisSummary(analysisResult) {
    return {
      file: analysisResult.file,
      language: analysisResult.language,
      issueDetected: !!analysisResult.explanation,
      issueDescription: analysisResult.explanation || 'No specific issue detected',
      recommendationsCount: analysisResult.analysis?.recommendations?.length || 0,
      dependenciesFound: analysisResult.analysis?.dependencies?.length || 0,
      shouldCreateJira: !!analysisResult.explanation || (analysisResult.analysis?.recommendations?.length > 0),
      estimatedPriority: this.determinePriority(analysisResult),
      estimatedIssueType: this.determineIssueType(analysisResult)
    };
  }

  /**
   * Generate search queries for related Jira/Confluence content
   */
  generateRelatedContentQueries(analysisResult) {
    const queries = [];

    // 1. Error-based queries
    if (analysisResult.explanation) {
      const issue = this.extractMainIssue(analysisResult.explanation);
      queries.push({
        type: 'error',
        query: issue,
        description: 'Search for similar error reports'
      });
    }

    // 2. Technology/language specific queries
    if (analysisResult.language && analysisResult.language !== 'unknown') {
      queries.push({
        type: 'technology',
        query: `${analysisResult.language} ${this.extractIssueType(analysisResult)}`,
        description: `Search for ${analysisResult.language}-related issues`
      });
    }

    // 3. Component/file-based queries
    if (analysisResult.file) {
      const fileName = path.basename(analysisResult.file, path.extname(analysisResult.file));
      queries.push({
        type: 'component',
        query: fileName,
        description: 'Search for issues in the same component'
      });
    }

    // 4. Technical pattern queries
    if (analysisResult.analysis?.recommendations?.length > 0) {
      const mainRecommendation = analysisResult.analysis.recommendations[0];
      queries.push({
        type: 'pattern',
        query: mainRecommendation.type || mainRecommendation.title,
        description: 'Search for similar technical patterns'
      });
    }

    return queries.slice(0, 8);
  }
}

// Smart Search Engine Class
class SmartSearchEngine {
	
    constructor() {
      this.debugMode = process.env.DEBUG === 'true';
      
      // Increased limits for large codebases
      this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024;
      this.maxDepth = parseInt(process.env.MAX_SEARCH_DEPTH) || 30;
      this.maxFilesToProcess = parseInt(process.env.MAX_FILES_TO_PROCESS) || 20000;
      this.maxResults = parseInt(process.env.MAX_SEARCH_RESULTS) || 500;
      
      // Performance settings
      this.batchSize = parseInt(process.env.SEARCH_BATCH_SIZE) || 500;
      this.enableCaching = process.env.ENABLE_SEARCH_CACHE !== 'false';
      this.cacheTimeout = parseInt(process.env.CACHE_TIMEOUT) || 900000; // 5 mins
      
      // File processing stats
      this.processedFiles = 0;
      this.skippedFiles = 0;
      this.errors = [];
      this.fileCache = new Map(); // Cache for file contents
	  
	  this.fileTypeMapping = {
	   java: ['java'],
	   javascript: ['javascript'],
	   python: ['python'],
	   cpp: ['cpp'],
	   web: ['web'],
	   docs: ['docs'],
	   config: ['config', 'build'],
	   code: ['java', 'javascript', 'python', 'cpp', 'csharp', 'web', 'sql', 'shell']
	  };
    }
	
    // Enhanced file filtering with better performance
	shouldProcessFile(filePath, fileStats, searchOptions = {}) {
	  const { fileTypes = ['all'], excludePatterns = [] } = searchOptions;
	  
	  // Size check first (fastest)
	  if (fileStats.size > this.maxFileSize) {
		this.skippedFiles++;
		return false;
	  }
	  
	  // Binary file detection (avoid reading binary files)
	  const ext = path.extname(filePath).toLowerCase();
	  const binaryExtensions = new Set([
		'.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.jar', '.war',
		'.zip', '.tar', '.gz', '.rar', '.7z', '.pdf', '.doc', '.docx',
		'.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif',
		'.bmp', '.svg', '.ico', '.mp3', '.mp4', '.avi', '.mov', '.wmv'
	  ]);
	  
	  if (binaryExtensions.has(ext)) {
		this.skippedFiles++;
		return false;
	  }
	  
	  // File type filtering
	  if (!fileTypes.includes('all')) {
		const fileType = this.getFileType(filePath);
		const allowedTypes = new Set();
		
		for (const type of fileTypes) {
		  if (this.fileTypeMapping[type]) {
			this.fileTypeMapping[type].forEach(t => allowedTypes.add(t));
		  }
		}
		
		if (!allowedTypes.has(fileType)) {
		  return false;
		}
	  }
	  
	  // Exclude patterns
	  for (const pattern of excludePatterns) {
		if (filePath.match(pattern)) {
		  return false;
		}
	  }
	  
	  return true;
	}
	
    // Batch processing for better memory management
    async processFilesInBatches(files, searchFunction, options = {}) {
      const results = [];
      const batches = [];
      
      // Split files into batches
      for (let i = 0; i < files.length; i += this.batchSize) {
        batches.push(files.slice(i, i + this.batchSize));
      }
      
      console.error(`[SEARCH] Processing ${files.length} files in ${batches.length} batches`);
      
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
//        console.error(`[SEARCH] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} files)`);
        
        // Process batch with Promise.all for parallel processing
        const batchPromises = batch.map(file => 
          searchFunction(file).catch(error => {
            this.error(`Error processing ${file.path}`, error);
            return []; // Return empty array on error
          })
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.flat());
        
        // Memory cleanup between batches
        if (global.gc && batchIndex % 10 === 9) {
          global.gc();
        }
        
        // Early termination if we have enough results
        if (results.length >= this.maxResults) {
          console.error(`[SEARCH] Reached max results (${this.maxResults}), stopping early`);
          break;
        }
      }
      
      return results;
    }

    // Multi-level normalization approach
    normalizeLogText(log, level = 'moderate') {
    let text = log;
    
    if (level === 'light') {
      // Light normalization - preserve structure
      // Just normalize whitespace and case
      text = text.replace(/\s+/g, ' ').trim();
      return text;
    }
    
    if (level === 'moderate') {
      // Moderate normalization - smart replacements
      // Order matters: most specific patterns first
      
      // 1. Replace UUIDs first (before we replace numbers)
      text = text.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, 'UUID');
      
      // 2. Replace hex numbers (before general numbers)
      text = text.replace(/0x[0-9a-fA-F]+/g, 'HEX');
      
      // 3. Replace IP addresses (before general numbers)
      text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'IP');
      
      // 4. Replace emails
      text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'EMAIL');
      
      // 5. Replace file paths (preserve structure)
      text = text.replace(/(?:\/[\w.-]+)+(?:\.\w+)?/g, 'FILEPATH');
      text = text.replace(/(?:[A-Z]:\\[\w\\.-]+)+(?:\.\w+)?/g, 'FILEPATH');
      
      // 6. Replace timestamps (various formats)
      text = text.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, 'TIMESTAMP');
      text = text.replace(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/g, 'TIMESTAMP');
      
      // 7. Replace quoted strings (with better escape handling)
      text = text.replace(/"(?:[^"\\]|\\.)*"/g, 'STR');
      text = text.replace(/'(?:[^'\\]|\\.)*'/g, 'STR');
      
      // 8. Replace template placeholders only (not all curly braces)
      text = text.replace(/%[sdifoxX]/g, 'PLACEHOLDER');
      text = text.replace(/\$\{\w+\}/g, 'PLACEHOLDER');
      text = text.replace(/\{\d+\}/g, 'PLACEHOLDER');  // Only numbered placeholders
      text = text.replace(/\{[A-Z_]+\}/g, 'PLACEHOLDER');  // Only CONSTANT_NAME placeholders
      
      // 9. Replace floats before integers
      text = text.replace(/\b\d+\.\d+\b/g, 'NUM');
      
      // 10. Replace remaining numbers (but preserve small numbers that might be important)
      text = text.replace(/\b\d{4,}\b/g, 'NUM');  // Only replace long numbers (4+ digits)
      text = text.replace(/\b\d{1,3}\b/g, (match) => {
        // Keep common error codes and status codes
        if (['200', '404', '500', '403', '401', '503', '400', '0', '1', '-1'].includes(match)) {
          return match;
        }
        return 'NUM';
      });
      
      // 11. Lowercase but preserve camelCase boundaries with spaces
      text = text.replace(/([a-z])([A-Z])/g, '$1 $2');
      text = text.toLowerCase();
      
      // 12. Clean up excessive whitespace
      text = text.replace(/\s+/g, ' ').trim();
      
      return text;
    }
    
    if (level === 'heavy') {
      // Heavy normalization - maximum abstraction
      text = this.normalizeLogText(log, 'moderate');
      
      // Remove most punctuation (but keep dots for package/class names)
      text = text.replace(/[!"#$%&'()*+,\-/:;<=>?@[\\]^`|~]/g, ' ');
      
      // Collapse all whitespace
      text = text.replace(/\s+/g, ' ').trim();
      
      return text;
    }
    
    return text;
  }

  // Extract meaningful phrases before normalization
  extractKeyPhrases(log) {
    const phrases = new Set();
    
    // Extract class names (Java/C# style)
    const classNames = log.match(/\b[A-Z][a-zA-Z0-9]*(?:\.[A-Z][a-zA-Z0-9]*)+\b/g) || [];
    classNames.forEach(cn => phrases.add(cn));
    
    // Extract method names with parentheses
    const methods = log.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g) || [];
    methods.forEach(m => phrases.add(m.replace(/\s*\($/, '')));
    
    // Extract error codes and messages after "error:", "exception:", etc.
    const errorPatterns = log.match(/(?:error|exception|failed?|warning):\s*([^.!?\n]+)/gi) || [];
    errorPatterns.forEach(ep => {
      const message = ep.split(/:\s*/)[1];
      if (message) phrases.add(message.trim());
    });
    
    // Extract quoted strings (likely error messages)
    const quotedStrings = log.match(/"[^"]{3,50}"|'[^']{3,50}'/g) || [];
    quotedStrings.forEach(qs => phrases.add(qs.replace(/["']/g, '')));
    
    // Extract stack trace elements
    const stackElements = log.match(/at\s+[\w.]+(?:\([^)]*\))?/g) || [];
    stackElements.forEach(se => phrases.add(se.replace(/^at\s+/, '')));
    
    // Extract file names
    const fileNames = log.match(/\b[\w-]+\.\w{2,4}\b/g) || [];
    fileNames.forEach(fn => phrases.add(fn));
    
    return Array.from(phrases);
  }

  // Progressive search with better strategy
  async traceErrorLogToSource(log, searchPaths, options = {}) {
    const results = [];
    const searchedQueries = new Set();
    
    // Helper to avoid duplicate searches
    const trySearch = async (query, context) => {
      if (searchedQueries.has(query) || query.length < 3) return null;
      searchedQueries.add(query);
      
      const searchResult = await this.smartSearch(query, searchPaths, {
        ...options,
        fileTypes: options.fileTypes || [
          'java', 'javascript', 'python', 'cpp', 'csharp', 
          'web', 'config', 'build', 'docs', 'sql', 'shell'
        ],
        maxResults: 3
      });
      
      if (searchResult.results && searchResult.results.length > 0) {
        searchResult.results.forEach(r => {
          r.searchContext = context;
          r.relevanceScore = this.calculateRelevance(query, r, log);
        });
        return searchResult.results;
      }
      return null;
    };
    
    // 1. First try: Extract and search for key phrases (most specific)
    const keyPhrases = this.extractKeyPhrases(log);
    for (const phrase of keyPhrases) {
      const found = await trySearch(phrase, 'key_phrase');
      if (found) results.push(...found);
      if (results.length >= 5) break;  // Early exit if we have enough
    }
    
    // 2. Second try: Light normalization (preserves structure)
    if (results.length < 3) {
      const lightNormalized = this.normalizeLogText(log, 'light');
      const found = await trySearch(lightNormalized, 'light_normalized');
      if (found) results.push(...found);
    }
    
    // 3. Third try: Moderate normalization
    if (results.length < 3) {
      const moderateNormalized = this.normalizeLogText(log, 'moderate');
      const found = await trySearch(moderateNormalized, 'moderate_normalized');
      if (found) results.push(...found);
      
      // Also try splitting on common delimiters
      const phrases = moderateNormalized.split(/[:\-|]/);
      for (const phrase of phrases) {
        if (phrase.length > 10) {  // Only meaningful phrases
          const found = await trySearch(phrase.trim(), 'phrase_part');
          if (found) results.push(...found);
          if (results.length >= 5) break;
        }
      }
    }
    
    // 4. Fourth try: Look for specific error patterns (not generic terms)
    if (results.length < 3) {
      // Extract specific error types from the log
      const errorTypes = this.extractErrorTypes(log);
      for (const errorType of errorTypes) {
        const found = await trySearch(errorType, 'error_type');
        if (found) results.push(...found);
        if (results.length >= 5) break;
      }
    }
    
    // 5. Process and return results
    if (results.length === 0) {
      return 'No matching source found for the error log.';
    }
    
    // Deduplicate and sort by relevance
    const uniqueResults = this.deduplicateResults(results);
    uniqueResults.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    
    return this.formatTraceResult(uniqueResults.slice(0, 3));
  }
  
  // Extract specific error types from log
  extractErrorTypes(log) {
    const types = new Set();
    
    // Common exception/error class names
    const exceptionPatterns = [
      /\b\w*Exception\b/g,
      /\b\w*Error\b/g,
      /\b\w*Fault\b/g,
      /\b\w*Failure\b/g,
      /\b\w*Timeout\b/g,
      /\b\w*Invalid\w*\b/g,
      /\b\w*NotFound\w*\b/g,
      /\b\w*Denied\b/g,
      /\b\w*Unauthorized\b/g
    ];
    
    exceptionPatterns.forEach(pattern => {
      const matches = log.match(pattern) || [];
      matches.forEach(m => types.add(m));
    });
    
    // HTTP status codes with context
    const httpCodes = log.match(/\b(4\d{2}|5\d{2})\s+\w+/g) || [];
    httpCodes.forEach(code => types.add(code));
    
    return Array.from(types);
  }
  
  // Calculate relevance score for ranking results
  calculateRelevance(query, result, originalLog) {
    let score = 0;
    
    // Boost for exact matches
    if (result.context && result.context.toLowerCase().includes(query.toLowerCase())) {
      score += 10;
    }
    
    // Boost for file type relevance
    const logLower = originalLog.toLowerCase();
    if (logLower.includes('java') && result.file.endsWith('.java')) score += 5;
    if (logLower.includes('javascript') && result.file.endsWith('.js')) score += 5;
    if (logLower.includes('python') && result.file.endsWith('.py')) score += 5;
    
    // Boost for exception/error files
    if (result.file.toLowerCase().includes('error') || 
        result.file.toLowerCase().includes('exception')) {
      score += 3;
    }
    
    // Boost based on search context
    if (result.searchContext === 'key_phrase') score += 8;
    if (result.searchContext === 'light_normalized') score += 5;
    if (result.searchContext === 'error_type') score += 4;
    
    return score;
  }
  
  // Deduplicate results based on file and line
  deduplicateResults(results) {
    const seen = new Set();
    const unique = [];
    
    for (const result of results) {
      const key = `${result.file}:${result.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(result);
      } else {
        // If duplicate, keep the one with higher relevance score
        const existing = unique.find(r => `${r.file}:${r.line}` === key);
        if (existing && result.relevanceScore > existing.relevanceScore) {
          existing.relevanceScore = result.relevanceScore;
          existing.searchContext = result.searchContext;
        }
      }
    }
    
    return unique;
  }

  // Format results with more context
  formatTraceResult(results) {
    if (!results || results.length === 0) {
      return 'No matching source found for the error log.';
    }
    
    const formatted = results.map((r, idx) => {
      const contextLines = r.context ? r.context.split('\n') : [];
      const relevantLine = contextLines[0] ? contextLines[0].trim() : 'No context available';
      const shortPath = r.file.length > 50 ? '...' + r.file.slice(-47) : r.file;
      
      return `${idx + 1}. ${shortPath}:${r.line}\n   ${relevantLine}${r.relevanceScore ? ` [relevance: ${r.relevanceScore}]` : ''}`;
    });
    
    return formatted.join('\n\n');
  }

  log(message, data = null) {
    if (this.debugMode) {
      // FIXED: Use console.error instead of console.log for MCP server logging
      console.error(`[SEARCH] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
  }

  error(message, error = null) {
    const errorMsg = `[SEARCH ERROR] ${message}${error ? ': ' + error.message : ''}`;
    // FIXED: Use console.error instead of console.log for MCP server logging
    console.error(errorMsg);
    this.errors.push(errorMsg);
  }

  // Smart pattern matching for different search types
  createSmartPatterns(query) {
    const patterns = {
      original: query,
      caseInsensitive: query.toLowerCase(),
      // Java-specific patterns
      javaClass: query.includes('class') ? query : `class.*${query}`,
      javaMethod: query.includes('(') ? query : `${query}\\s*\\(`,
      javaImport: query.includes('import') ? query : `import.*${query}`,
      javaPackage: query.includes('package') ? query : `package.*${query}`,
      // General programming patterns
      function: query.includes('function') ? query : `function\\s+${query}`,
      variable: `\\b${query}\\b`,
      // Documentation patterns
      heading: `^#+\\s*.*${query}`,
      listItem: `^\\s*[-*]\\s*.*${query}`,
    };
    return patterns;
  }

  // Enhanced file type detection
  getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath).toLowerCase();

    // Define fileTypes mapping within the method (this was missing!)
    const fileTypes = {
      java: ['.java', '.jsp', '.jspx', '.properties', '.groovy', '.kt', '.kts', '.scala', '.clj'],
      javascript: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.elm', '.dart', '.gql', '.graphql'],
      python: ['.py', '.pyw', '.pyi', '.ipynb'],
      cpp: ['.cpp', '.c', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.s', '.asm'],
      csharp: ['.cs'],
      web: ['.html', '.htm', '.xhtml', '.css', '.scss', '.sass', '.less'],
      config: ['.json', '.yaml', '.yml', '.xml', '.toml', '.ini', '.env'],
      build: ['.gradle', '.maven', '.pom', '.cmake', '.makefile', '.dockerfile'],
      sql: ['.sql', '.ddl', '.dml'],
      shell: ['.sh', '.bash', '.zsh', '.ksh', '.bat', '.ps1', '.cmd'],
      docs: ['.md', '.txt', '.rst', '.adoc', '.tex', '.bib', '.chm', '.log', '.doc', '.docx', '.odt', '.rtf', '.wpd','.xls', '.xlsx', '.ods', '.csv', '.tsv','.ppt', '.pptx', '.odp','.pdf', '.epub', '.mobi','.ipynb', '.rmd', '.notebook', '.nb']
    };
    
    // Special filename patterns
    if (['readme', 'changelog', 'license', 'todo', 'notes'].some(name => filename.includes(name))) {
      return 'docs';
    }
    
    for (const [type, extensions] of Object.entries(fileTypes)) {
      if (extensions.includes(ext) || (ext === '' && extensions.includes('.' + filename))) {
        return type;
      }
    }

    return 'unknown';
  }

  // Smart search that adapts to file type and content
  async smartSearchInFile(filePath, query, options = {}) {

    const pathValidation = pathValidator.validatePath(filePath);
    if (!pathValidation.valid) {
      this.error(`Security: ${pathValidation.error}`, null);
      return [];
    }
	
    const { caseSensitive = false, maxMatches = 10, contextLines = 3 } = options;
    
    try {
      // Check file accessibility and size
      const stats = await fs.stat(filePath);
      if (stats.size > this.maxFileSize) {
        this.log(`Skipping large file: ${filePath} (${Math.round(stats.size / 1024 / 1024)}MB)`);
        return [];
      }

      // Read file content
      let content;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        this.error(`Cannot read file: ${filePath}`, error);
        return [];
      }

      const fileType = this.getFileType(filePath);
      const patterns = this.createSmartPatterns(query);
      const lines = content.split('\n');
      const results = [];
      
      // Search with multiple patterns based on file type
      const searchPatterns = this.selectSearchPatterns(patterns, fileType, query);
      
      for (const patternInfo of searchPatterns) {
        if (results.length >= maxMatches) break;
        
        const matches = this.findMatches(content, lines, patternInfo, caseSensitive, contextLines);
        results.push(...matches);
      }

      // Remove duplicates and sort by relevance
      const uniqueResults = this.deduplicateAndScore(results, query, fileType);
      
      this.processedFiles++;
      return uniqueResults.slice(0, maxMatches);
      
    } catch (error) {
      this.error(`Error in smart search for file: ${filePath}`, error);
      return [];
    }
  }

  selectSearchPatterns(patterns, fileType, originalQuery) {
    const patternPriority = [];
    
    // Add patterns based on file type and query content
    if (fileType === 'java') {
      if (originalQuery.includes('class')) patternPriority.push({ pattern: patterns.javaClass, type: 'javaClass', weight: 10 });
      if (originalQuery.includes('import')) patternPriority.push({ pattern: patterns.javaImport, type: 'javaImport', weight: 10 });
      if (originalQuery.includes('package')) patternPriority.push({ pattern: patterns.javaPackage, type: 'javaPackage', weight: 10 });
      if (originalQuery.includes('(') || originalQuery.includes('method')) {
        patternPriority.push({ pattern: patterns.javaMethod, type: 'javaMethod', weight: 9 });
      }
    }
    
    if (fileType === 'docs') {
      patternPriority.push({ pattern: patterns.heading, type: 'heading', weight: 8 });
      patternPriority.push({ pattern: patterns.listItem, type: 'listItem', weight: 7 });
    }
    
    if (['javascript', 'python', 'cpp', 'csharp'].includes(fileType)) {
      patternPriority.push({ pattern: patterns.function, type: 'function', weight: 8 });
    }
    
    // Always include basic patterns
    patternPriority.push({ pattern: patterns.variable, type: 'variable', weight: 6 });
    patternPriority.push({ pattern: patterns.caseInsensitive, type: 'caseInsensitive', weight: 5 });
    patternPriority.push({ pattern: patterns.original, type: 'exact', weight: 10 });
    
    return patternPriority.sort((a, b) => b.weight - a.weight);
  }

  findMatches(content, lines, patternInfo, caseSensitive, contextLines) {
    const { pattern, type, weight } = patternInfo;
    const results = [];
    
    try {
      const regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
      const matches = [...content.matchAll(regex)];
      
      for (const match of matches) {
        const matchIndex = match.index;
        const beforeMatch = content.substring(0, matchIndex);
        const lineNumber = beforeMatch.split('\n').length;
        
        // Extract context
        const startLine = Math.max(0, lineNumber - contextLines - 1);
        const endLine = Math.min(lines.length - 1, lineNumber + contextLines - 1);
        const context = lines.slice(startLine, endLine + 1).join('\n');
        
        results.push({
          line: lineNumber,
          column: matchIndex - beforeMatch.lastIndexOf('\n'),
          matchText: match[0],
          context: context,
          matchType: type,
          relevanceScore: weight,
          patternUsed: pattern
        });
      }
    } catch (regexError) {
      // If regex fails, fall back to simple string search
      const searchText = caseSensitive ? content : content.toLowerCase();
      const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();
      
      let index = searchText.indexOf(searchPattern);
      while (index !== -1) {
        const beforeMatch = content.substring(0, index);
        const lineNumber = beforeMatch.split('\n').length;
        const startLine = Math.max(0, lineNumber - contextLines - 1);
        const endLine = Math.min(lines.length - 1, lineNumber + contextLines - 1);
        const context = lines.slice(startLine, endLine + 1).join('\n');
        
        results.push({
          line: lineNumber,
          column: index - beforeMatch.lastIndexOf('\n'),
          matchText: content.substr(index, searchPattern.length),
          context: context,
          matchType: type,
          relevanceScore: weight,
          patternUsed: pattern
        });
        
        index = searchText.indexOf(searchPattern, index + 1);
      }
    }
    
    return results;
  }

  deduplicateAndScore(results, originalQuery, fileType) {
    // Remove duplicates based on line number
    const uniqueByLine = new Map();
    
    for (const result of results) {
      const key = result.line;
      if (!uniqueByLine.has(key) || uniqueByLine.get(key).relevanceScore < result.relevanceScore) {
        uniqueByLine.set(key, result);
      }
    }
    
    // Sort by relevance score and line number
    return Array.from(uniqueByLine.values()).sort((a, b) => {
      if (a.relevanceScore !== b.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return a.line - b.line;
    });
  }

  // Recursive directory scanning
  async getAllFiles(dirPath, options = {}) {
	  
    const pathValidation = pathValidator.validatePath(dirPath);
    if (!pathValidation.valid) {
      throw new Error(`Security violation: ${pathValidation.error}`);
    }

    const { maxDepth = this.maxDepth, extensions = [], skipDirs = [] } = options;
    
    const defaultSkipDirs = new Set([
      'node_modules', '.git', '.svn', '.hg', 'target', 'build', 'dist',
      'bin', 'obj', '.vscode', '.idea', '__pycache__', '.gradle',
      'vendor', 'coverage', '.nyc_output', 'logs', '.next', 'out',
      'tmp', 'temp', '.cache', '.pytest_cache', '.mypy_cache'
    ]);
    
    const skipDirsSet = new Set([...defaultSkipDirs, ...skipDirs]);

	const scanDirectory = async (currentPath, currentDepth = 0) => {
	  const results = [];

	  if (currentDepth >= maxDepth) {
		return results;
	  }

	  try {
		const entries = await fs.readdir(currentPath, { withFileTypes: true });

		for (const entry of entries) {
		  const fullPath = path.join(currentPath, entry.name);

		  if (entry.isDirectory()) {
			if (entry.name.startsWith('.') && entry.name !== '.') continue;
			if (skipDirsSet.has(entry.name.toLowerCase())) continue;

			const subResults = await scanDirectory(fullPath, currentDepth + 1);
			results.push(...subResults);

		  } else if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (extensions.length === 0 || extensions.includes(ext)) {
			  results.push({
				path: fullPath,
				name: entry.name,
				extension: ext,
				relativePath: path.relative(dirPath, fullPath),
				directory: path.dirname(fullPath),
				fileType: this.getFileType(fullPath)  // now safe
			  });
			}
		  }
		}
	  } catch (error) {
		this.error(`Cannot read directory: ${currentPath}`, error); // now safe
	  }
      return results;
    }
    
    return await scanDirectory(dirPath);
  }

  // Main smart search function
  async smartSearch(query, searchPaths, options = {}) {
    const {
      fileTypes = ['all'],
      maxResults = this.maxResults,
      maxFiles = this.maxFilesToProcess,
      caseSensitive = false,
      contextLines = 3,
      excludePatterns = []
    } = options;
    
    this.processedFiles = 0;
    this.skippedFiles = 0;
    this.errors = [];
    
	const startTime = Date.now();
    this.log(`Starting smart search for: "${query}"`);
    this.log(`Search paths: ${JSON.stringify(searchPaths)}`);
    this.log(`File types: ${JSON.stringify(fileTypes)}`);
    
    const paths = Array.isArray(searchPaths) ? searchPaths : [searchPaths];
    const allFiles = [];

/*    
    // Get all files from search paths
    for (const searchPath of paths) {
      try {
        const stats = await fs.stat(searchPath);
        if (!stats.isDirectory()) {
          this.error(`Not a directory: ${searchPath}`);
          continue;
        }
        
        this.log(`Scanning directory: ${searchPath}`);
        const files = await this.getAllFiles(searchPath, options);
        this.log(`Found ${files.length} files in ${searchPath}`);
        allFiles.push(...files);
      } catch (error) {
        this.error(`Cannot access directory: ${searchPath}`, error);
      }
    }
*/
	
    // Get all files with enhanced filtering
    for (const searchPath of paths) {
      try {
        const pathFiles = await this.getAllFiles(searchPath, { 
          maxDepth: this.maxDepth,
          fileTypes,
          excludePatterns 
        });
        
        // Filter files by should process check
        const validFiles = [];
        for (const file of pathFiles) {
          try {
            const stats = await fs.stat(file.path);
            if (this.shouldProcessFile(file.path, stats, { fileTypes, excludePatterns })) {
              validFiles.push(file);
            }
          } catch (error) {
            this.error(`Cannot stat file: ${file.path}`, error);
          }
        }
        
        allFiles.push(...validFiles);
        this.log(`Found ${validFiles.length} valid files in ${searchPath} (${pathFiles.length} total)`);
      } catch (error) {
        this.error(`Cannot access directory: ${searchPath}`, error);
      }
    }
    
    // Filter files by type
    const filteredFiles = this.filterFilesByType(allFiles, fileTypes);
    this.log(`Files after type filtering: ${filteredFiles.length}`);
    
    if (filteredFiles.length === 0) {
      return {
        query,
        searchPaths: paths,
        results: [],
        summary: {
          totalFiles: allFiles.length,
          filteredFiles: 0,
          processedFiles: 0,
          errors: this.errors,
          message: 'No files found matching the specified file types'
        }
      };
    }
    
    // Limit files to process
    const filesToProcess = allFiles.slice(0, maxFiles);
    if (filesToProcess.length < allFiles.length) {
      console.error(`Limited to ${maxFiles} files (${allFiles.length} total found)`);
    }
	
    // Process files in batches
    const searchFunction = async (file) => {
      const results = await this.smartSearchInFile(file.path, query, {
        caseSensitive,
        maxMatches: 3, // Reduce per-file matches for large searches
        contextLines
      });
      
      // Add file metadata to results
      return results.map(result => ({
        ...result,
        file: file.relativePath,
        fullPath: file.path,
        fileName: file.name,
        fileType: file.fileType,
        extension: file.extension
      }));
    };
	
    const allResults = await this.processFilesInBatches(filesToProcess, searchFunction, options);

    // Sort and limit final results
    const sortedResults = allResults
      .sort((a, b) => {
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return a.file.localeCompare(b.file);
      })
      .slice(0, maxResults);	
	
/*    
    // Search each file
    for (const file of filesToProcess) {
      if (allResults.length >= maxResults) break;
      
      const fileResults = await this.smartSearchInFile(file.path, query, {
        caseSensitive,
        maxMatches: 5,
        contextLines
      });
      
      // Add file info to results
      for (const result of fileResults) {
        result.file = file.relativePath;
        result.fullPath = file.path;
        result.fileName = file.name;
        result.fileType = file.fileType;
        result.extension = file.extension;
      }
      
      allResults.push(...fileResults);
    }
    
    // Sort final results by relevance
    const sortedResults = allResults.sort((a, b) => {
      if (a.relevanceScore !== b.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return a.file.localeCompare(b.file);
    });
	
*/
  
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
  
    console.error(`Search complete in ${duration.toFixed(2)}s. Found ${sortedResults.length} matches in ${this.processedFiles} files.`);
    
    return {
      query,
      searchPaths: paths,
      fileTypes,
      results: sortedResults.slice(0, maxResults),
      summary: {
        totalFiles: allFiles.length,
        filteredFiles: filteredFiles.length,
        processedFiles: this.processedFiles,
        matchCount: sortedResults.length,
        errors: this.errors
      }
    };
  }
  
  filterFilesByType(files, fileTypes) {
    if (fileTypes.includes('all')) return files;
    
    const typeMapping = {
      java: ['java'],
      javascript: ['javascript'],
      python: ['python'],
      cpp: ['cpp'],
      web: ['web'],
      docs: ['docs'],
      config: ['config', 'build'],
      code: ['java', 'javascript', 'python', 'cpp', 'csharp', 'web', 'sql', 'shell']
    };
    
    const allowedTypes = new Set();
    for (const type of fileTypes) {
      if (typeMapping[type]) {
        typeMapping[type].forEach(t => allowedTypes.add(t));
      } else {
        allowedTypes.add(type);
      }
    }
    
    return files.filter(file => allowedTypes.has(file.fileType));
  }
}

// Directory utilities
class DirectoryManager {
  static getConfiguredDirectories() {
    const dirs = {
      sourceDir: process.env.DEFAULT_SOURCE_DIR,
      docsDir: process.env.DEFAULT_DOCS_DIR,
    };
    
    return dirs;
  }
  
  static async getDirectoryStats(dirPaths) {
    const searchEngine = new SmartSearchEngine();
    const paths = Array.isArray(dirPaths) ? dirPaths : [dirPaths];
    const stats = {
      directories: [],
      totalFiles: 0,
      filesByType: {},
      filesByExtension: {}
    };
    
    for (const dirPath of paths) {
      if (!dirPath) continue;
      
      try {
        // Check if directory exists first
        const dirStat = await fs.stat(dirPath);
        if (!dirStat.isDirectory()) {
          throw new Error('Path is not a directory');
        }
        
        const files = await searchEngine.getAllFiles(dirPath);
        
        const dirStats = {
          path: dirPath,
          accessible: true,
          fileCount: files.length,
          fileTypes: {},
          extensions: {},
          error: null
        };
        
        for (const file of files) {
          // Count by type
          const type = file.fileType;
          dirStats.fileTypes[type] = (dirStats.fileTypes[type] || 0) + 1;
          stats.filesByType[type] = (stats.filesByType[type] || 0) + 1;
          
          // Count by extension
          const ext = file.extension || 'no-extension';
          dirStats.extensions[ext] = (dirStats.extensions[ext] || 0) + 1;
          stats.filesByExtension[ext] = (stats.filesByExtension[ext] || 0) + 1;
        }
        
        stats.directories.push(dirStats);
        stats.totalFiles += files.length;
        
      } catch (error) {
        console.error(`Error getting stats for ${dirPath}:`, error);
        stats.directories.push({
          path: dirPath,
          accessible: false,
          error: error.message,
          fileCount: 0,
          fileTypes: {},
          extensions: {}
        });
      }
    }
    
    return stats;
  }
}

// Enhanced MCP Server with new traversal functionality
class EnhancedChatbotAssistantServer {
  constructor() {
    this.server = new Server(
      {
        name: 'chatbot-assistant',
        version: '3.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.searchEngine = new SmartSearchEngine();
    this.traversalAnalyzer = new EnhancedTraversalAnalyzer(this.searchEngine);
	this.jiraHelper = new JiraIntegrationHelper();
    this.tableRegistry = new TableRegistry();
    this.responseValidator = new ResponseValidator(this.tableRegistry);
    this.tableValidationEnabled = process.env.ENABLE_TABLE_VALIDATION !== 'false';

	
	this.initializeTableRegistry();
    this.setupToolHandlers();
	
    // Set up global error handlers
    this.setupGlobalErrorHandlers();
  }

  async initializeTableRegistry() {
    if (!this.tableValidationEnabled) {
      console.error('[TABLE_VALIDATION] Table validation is disabled');
      return;
    }
    
    try {
      console.error('[TABLE_VALIDATION] Initializing table registry...');
      const directories = this.getDefaultSearchDirectories();
      const summary = await this.tableRegistry.initialize(directories);
      console.error(`[TABLE_VALIDATION] Registry initialized with ${summary.totalTables} tables`);
      
      // Log first few tables for verification
      if (summary.tables.length > 0) {
        console.error(`[TABLE_VALIDATION] Sample tables: ${summary.tables.slice(0, 10).join(', ')}`);
      }
    } catch (error) {
      console.error(`[TABLE_VALIDATION] Failed to initialize registry: ${error.message}`);
    }
  }

  setupToolHandlers() {
	  
    // Add authentication check wrapper
    const authenticatedHandler = (handler) => {
      return async (request) => {
        // Check for API key in request metadata
        const apiKey = request.metadata?.apiKey || request.params?.apiKey;
        const validation = apiValidator.validateKey(apiKey);
        
        if (!validation.valid) {
          return {
            content: [{
              type: 'text',
              text: `Authentication failed: ${validation.error}`
            }]
          };
        }
        
        // Call original handler
        return handler(request);
      };
    };

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'smart_search',
          description: 'Smart search with pattern matching across configured directories',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query with intelligent pattern matching',
              },
              directories: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific directories to search (optional, uses configured defaults)',
              },
              fileTypes: {
                type: 'array',
                items: { 
                  type: 'string',
                  enum: ['all', 'java', 'javascript', 'python', 'cpp', 'web', 'docs', 'config', 'code']
                },
                description: 'Types of files to search',
              },
              caseSensitive: {
                type: 'boolean',
                description: 'Case sensitive search',
              },
              maxResults: {
                type: 'integer',
                description: 'Maximum number of results',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'search_source_code',
          description: 'Specialized search for Java source code with Java-specific patterns',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Java code search query (classes, methods, imports, etc.)',
              },
              directories: {
                type: 'array',
                items: { type: 'string' },
                description: 'Directories to search (optional)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'analyze_with_traversal',
          description: 'Analyze code errors with IDE-like traversal to trace root causes',
          inputSchema: {
            type: 'object',
            properties: {
              snippet: {
                type: 'string',
                description: 'Code snippet containing the error',
              },
              file: {
                type: 'string',
                description: 'Source file name',
              },
              searchDirectory: {
                type: 'string',
                description: 'Directory to search for dependencies and configuration sources',
              },
              extraContext: {
                type: 'string',
                description: 'Additional context about the error',
              },
            },
            required: ['snippet', 'file'],
          },
        },
/*		{
		  name: 'intelligent_code_analysis',
		  description: 'Auto-detect language, analyze code, resolve constants/globals/arrays, and explain issues as a developer would.',
		  inputSchema: {
			type: 'object',
			properties: {
			  filePath: { type: 'string', description: 'Path to the file to analyze' },
			  content: { type: 'string', description: 'File content (optional, will read if not provided)' },
			  searchDirectory: { type: 'string', description: 'Directory for dependency/context search (optional)' }
			},
			required: ['filePath']
		  }
		},
*/
		{
			name: 'trace_error_log',
			description: 'Trace error logs back to source code files using intelligent normalization',
			inputSchema: {
				type: 'object',
				properties: {
				errorLog: {
					type: 'string',
					description: 'The error log or stack trace to analyze',
				},
				searchPaths: {
					type: 'array',
					items: { type: 'string' },
					description: 'Directories to search in',
				},
				fileTypes: {
					type: 'array',
					items: { type: 'string' },
					description: 'File types to search',
				},
				maxResults: {
					type: 'integer',
					description: 'Maximum results to return',
				},
				},
				required: ['errorLog'],
			},
		},
        {
          name: 'search_documentation',
          description: 'Search documentation files with documentation-specific patterns',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Documentation search query',
              },
              directories: {
                type: 'array',
                items: { type: 'string' },
                description: 'Directories to search (optional)',
              },
            },
            required: ['query'],
          },
        },
		{
		  name: 'create_jira_issue_from_analysis',
		  description: 'Create a Jira issue directly from analysis results using the standard template format',
		  inputSchema: {
			type: 'object',
			properties: {
			  analysisResult: {
				type: 'object',
				description: 'The analysis result from code analysis'
			  },
			  projectKey: {
				type: 'string',
				description: 'Jira project key (e.g., "CER")',
				default: 'CER'
			  },
			  assignee: {
				type: 'string',
				description: 'Jira username to assign the issue to'
			  },
			  environment: {
				type: 'string',
				description: 'Environment where the issue occurs',
				enum: ['Development', 'Testing', 'Staging', 'Production'],
				default: 'Development'
			  },
			  customizations: {
				type: 'object',
				properties: {
				  summary: { type: 'string', description: 'Custom summary (optional)' },
				  priority: { 
					type: 'string', 
					enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'],
					description: 'Issue priority (auto-determined if not provided)'
				  },
				  issueType: { 
					type: 'string',
					enum: ['Problem', 'Improvement', 'Change Request', 'Task'],
					description: 'Issue type (auto-determined if not provided)'
				  },
				  components: { 
					type: 'array',
					items: { type: 'string' },
					description: 'Additional components'
				  },
				  labels: { 
					type: 'array',
					items: { type: 'string' },
					description: 'Additional labels'
				  },
				  incidentId: {
					type: 'string',
					description: 'Related incident ID (for customfield_10012)'
				  }
				},
				description: 'Optional customizations for the Jira issue'
			  }
			},
			required: ['analysisResult', 'projectKey']
		  }
		},
		{
		  name: 'analyze_and_create_jira_workflow',
		  description: 'Complete workflow: analyze code, search for similar issues, and create Jira with standard template',
		  inputSchema: {
			type: 'object',
			properties: {
			  filePath: { type: 'string', description: 'Path to the file to analyze' },
			  content: { type: 'string', description: 'File content (optional)' },
			  searchDirectory: { type: 'string', description: 'Directory for dependency search (optional)' },
			  projectKey: { type: 'string', description: 'Jira project key', default: 'CER' },
			  assignee: { type: 'string', description: 'Assignee username' },
			  environment: { 
				type: 'string', 
				enum: ['Development', 'Testing', 'Staging', 'Production'],
				description: 'Environment where issue occurs',
				default: 'Development'
			  },
			  incidentId: { type: 'string', description: 'Related incident ID if any' },
			  skipSimilarSearch: { type: 'boolean', description: 'Skip searching for similar issues', default: false }
			},
			required: ['filePath', 'projectKey']
		  }
		},
		{
			name: 'extract_confluence_search_terms',
			description: 'Extract search terms optimized for Confluence documentation search',
			inputSchema: {
				type: 'object',
				properties: {
				analysisResult: {
					type: 'object',
					description: 'Result from code analysis'
				},
				jiraIssues: {
					type: 'array',
					description: 'Optional: Related Jira issues to include in search',
					items: { type: 'object' }
				},
				searchScope: {
					type: 'string',
					enum: ['technical', 'documentation', 'troubleshooting', 'all'],
					description: 'Type of Confluence content to focus on',
					default: 'all'
				}
				},
				required: ['analysisResult']
			}
		},
		{
			name: 'prepare_confluence_page_content',
			description: 'Prepare comprehensive Confluence page content from analysis results and related findings',
			inputSchema: {
				type: 'object',
				properties: {
				analysisResult: {
					type: 'object',
					description: 'Code analysis result'
				},
				jiraIssues: {
					type: 'array',
					description: 'Related Jira issues found',
					items: { type: 'object' }
				},
				confluencePages: {
					type: 'array',
					description: 'Related Confluence pages found', 
					items: { type: 'object' }
				},
				pageType: {
					type: 'string',
					enum: ['troubleshooting', 'technical_analysis', 'issue_documentation', 'knowledge_base'],
					description: 'Type of Confluence page to create',
					default: 'technical_analysis'
				},
				spaceKey: {
					type: 'string',
					description: 'Target Confluence space key'
				},
				includeCodeSnippets: {
					type: 'boolean',
					description: 'Include code examples in the page',
					default: true
				}
				},
				required: ['analysisResult', 'spaceKey']
			}
		},
		{
			name: 'complete_analysis_workflow',
			description: 'Complete workflow: analyze code, search Jira/Confluence, and prepare documentation',
			inputSchema: {
				type: 'object',
				properties: {
				filePath: { type: 'string', description: 'Path to the file to analyze' },
				content: { type: 'string', description: 'File content (optional)' },
				searchDirectory: { type: 'string', description: 'Directory for dependency search (optional)' },
				projectKey: { type: 'string', description: 'Jira project key' },
				confluenceSpaceKey: { type: 'string', description: 'Confluence space key for documentation' },
				workflowOptions: {
					type: 'object',
					properties: {
					searchJira: { type: 'boolean', default: true },
					searchConfluence: { type: 'boolean', default: true },
					createConfluencePage: { type: 'boolean', default: false },
					jiraSearchDepth: { type: 'string', enum: ['basic', 'comprehensive'], default: 'basic' },
					confluenceSearchScope: { type: 'string', enum: ['technical', 'documentation', 'all'], default: 'all' }
					}
				}
				},
				required: ['filePath', 'projectKey']
			}
		},
		{
          name: 'prepare_jira_issue_from_analysis',
          description: 'Prepare Jira issue data from code analysis results with smart field population',
          inputSchema: {
            type: 'object',
            properties: {
              analysisResult: {
                type: 'object',
                description: 'The analysis result from analyze_with_traversal'
              },
              userInput: {
                type: 'object',
                properties: {
                  summary: { type: 'string', description: 'Custom issue summary (optional)' },
                  description: { type: 'string', description: 'Custom description (optional)' },
                  priority: { 
                    type: 'string', 
                    enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'],
                    description: 'Issue priority (optional, auto-determined if not provided)'
                  },
                  issueType: { 
                    type: 'string',
                    enum: ['Bug', 'Task', 'Story', 'Improvement', 'Epic'],
                    description: 'Issue type (optional, auto-determined if not provided)'
                  },
                  labels: { 
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Additional labels (optional)'
                  },
                  components: { 
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Project components (optional)'
                  }
                },
                description: 'Optional user customizations for the Jira issue'
              }
            },
            required: ['analysisResult']
          }
        },
        {
          name: 'generate_related_content_queries',
          description: 'Generate search queries to find related Jira issues and Confluence pages based on analysis results',
          inputSchema: {
            type: 'object',
            properties: {
              analysisResult: {
                type: 'object',
                description: 'The analysis result from code analysis'
              }
            },
            required: ['analysisResult']
          }
        },
        {
          name: 'format_analysis_summary',
          description: 'Format analysis results into a user-friendly summary for confirmation before creating Jira issues',
          inputSchema: {
            type: 'object',
            properties: {
              analysisResult: {
                type: 'object',
                description: 'The analysis result to format'
              }
            },
            required: ['analysisResult']
          }
        },
		{
			name: 'analyze_and_suggest_jira',
			description: 'Complete workflow: analyze code, search for related content, and prepare for Jira creation with user confirmation',
			inputSchema: {
				type: 'object',
				properties: {
				filePath: { type: 'string', description: 'Path to the file to analyze' },
				content: { type: 'string', description: 'File content (optional)' },
				searchDirectory: { type: 'string', description: 'Directory for dependency search (optional)' },
				projectKey: { type: 'string', description: 'Jira project key for potential issue creation' },
				skipRelatedSearch: { type: 'boolean', description: 'Skip searching for related content', default: false }
				},
				required: ['filePath', 'projectKey']
			}
		},
		{
		  name: 'confirm_jira_creation',
			description: 'Handle user confirmation for Jira issue creation and return creation instructions',
			inputSchema: {
				type: 'object',
				properties: {
				analysisId: { type: 'string', description: 'Analysis ID from previous analysis' },
				userConfirmed: { type: 'boolean', description: 'Whether user confirmed Jira creation' },
				projectKey: { type: 'string', description: 'Jira project key' },
				customizations: {
					type: 'object',
					properties: {
					summary: { type: 'string' },
					priority: { type: 'string' },
					assignee: { type: 'string' }
					},
					description: 'User customizations for the Jira issue'
				}
				},
				required: ['analysisId', 'userConfirmed', 'projectKey']
			}
		},
        {
          name: 'analyze_project_structure',
          description: 'Analyze the structure and file composition of configured directories',
          inputSchema: {
            type: 'object',
            properties: {
              directories: {
                type: 'array',
                items: { type: 'string' },
                description: 'Directories to analyze (optional, uses configured defaults)',
              },
            },
            required: [],
          },
        },
        {
          name: 'list_files',
          description: 'List files in directories with filtering options',
          inputSchema: {
            type: 'object',
            properties: {
              directory: {
                type: 'string',
                description: 'Directory to list (optional, uses DEFAULT_SOURCE_DIR)',
              },
              fileTypes: {
                type: 'array',
                items: { type: 'string' },
                description: 'File types to include',
              },
              maxFiles: {
                type: 'integer',
                description: 'Maximum number of files to return',
              },
            },
            required: [],
          },
        },
        {
          name: 'read_file',
          description: 'Read the contents of a specific file',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Full path to the file',
              },
              maxSize: {
                type: 'integer',
                description: 'Maximum file size to read (bytes)',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'validate_table_names',
          description: 'Validate that table names in a query or text exist in the source code',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Text, SQL query, or code containing table references',
              },
              autoCorrect: {
                type: 'boolean',
                description: 'Automatically suggest corrections for invalid tables',
                default: true,
              },
            },
            required: ['text'],
          },
        },
        {
          name: 'get_available_tables',
          description: 'Get list of all available table names from the source code',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'Optional pattern to filter tables (e.g., "user" for user-related tables)',
              },
              includeMetadata: {
                type: 'boolean',
                description: 'Include metadata about where tables are defined',
                default: false,
              },
            },
            required: [],
          },
        },
        {
          name: 'refresh_table_registry',
          description: 'Refresh the table registry by re-scanning source code',
          inputSchema: {
            type: 'object',
            properties: {
              directories: {
                type: 'array',
                items: { type: 'string' },
                description: 'Directories to scan (optional, uses defaults)',
              },
            },
            required: [],
          },
        },
        {
          name: 'get_ai_agent_instructions',
          description: 'Get instructions to send to AI agents about using only real table names',
          inputSchema: {
            type: 'object',
            properties: {
              format: {
                type: 'string',
                enum: ['system_prompt', 'full_context', 'summary'],
                description: 'Format of instructions to return',
                default: 'system_prompt',
              },
            },
            required: [],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

		// Check if client is still connected before processing
		if (!this.isClientConnected()) {
		  console.error('[MCP] Client disconnected during request');
		  return null;
		}

        switch (name) {
          case 'smart_search':
            return await this.handleSmartSearch(args);
          case 'search_source_code':
            return await this.handleSearchSourceCode(args);
		  case 'trace_error_log': {
		    const { errorLog, searchPaths, fileTypes, maxResults = 5 } = args;
		    
		    const searchDirs = searchPaths || this.getDefaultSearchDirectories();
		    
		    if (searchDirs.length === 0) {
		  	return {
		  	  content: [{
		  		type: 'text',
		  		text: 'No search directories configured.',
		  	  }],
		  	};
		    }
		  
		    const result = await this.searchEngine.traceErrorLogToSource(
		  	errorLog,
		  	searchDirs,
		  	{ fileTypes: fileTypes || ['all'], maxResults }
		    );
		  
		    return {
		  	content: [{
		  	  type: 'text',
		  	  text: JSON.stringify({
		  		errorLog: errorLog.substring(0, 200) + '...',
		  		traceResult: result,
		  		timestamp: new Date().toISOString()
		  	  }, null, 2),
		  	}],
		    };
		  }
          case 'search_documentation':
            return await this.handleSearchDocumentation(args);
          case 'analyze_project_structure':
            return await this.handleAnalyzeProjectStructure(args);
		  case 'analyze_with_traversal':
			  return await this.handleAnalyzeWithTraversal(args);
//          case 'intelligent_code_analysis':
//            return await this.handleIntelligentCodeAnalysis(args);
		  case 'create_jira_issue_from_analysis': {
		    const { 
		  	analysisResult, 
		  	projectKey = 'CER', 
		  	assignee, 
		  	environment = 'Development',
		  	customizations = {} 
		    } = args;
		    
		    try {
		  	// Prepare the Jira issue data using your template format
		  	const jiraIssueData = this.jiraHelper.prepareJiraIssueData(analysisResult, {
		  	  projectKey,
		  	  assignee,
		  	  environment,
		  	  ...customizations
		  	});
		  	
		  	// Return the Jira issue in your exact template format
		  	const jiraPayload = {
		  	  projectKey: jiraIssueData.projectKey,
		  	  issueType: jiraIssueData.issueType,
		  	  summary: jiraIssueData.summary,
		  	  description: jiraIssueData.description,
		  	  components: jiraIssueData.components,
		  	  customFields: jiraIssueData.customFields,
		  	  versions: jiraIssueData.versions,
		  	  assignee: jiraIssueData.assignee,
		  	  priority: jiraIssueData.priority,
		  	  environment: jiraIssueData.environment,
		  	  labels: jiraIssueData.labels
		  	};
		  	
		  	// Add incident ID to custom fields if provided
		  	if (customizations.incidentId) {
		  	  jiraPayload.customFields.customfield_10012 = customizations.incidentId;
		  	}
		  	
		  	return {
		  	  content: [
		  		{
		  		  type: 'text',
		  		  text: JSON.stringify({
		  			success: true,
		  			message: 'Jira issue data prepared in standard template format',
		  			jiraPayload: jiraPayload,
		  			analysisId: jiraIssueData.analysisId,
		  			instructions: {
		  			  nextStep: 'Use this payload with your Jira REST API or Jira MCP server',
		  			  apiEndpoint: 'POST /rest/api/2/issue',
		  			  mcpServer: 'Use jira-confluence-mcp server create_issue tool with this data'
		  			},
		  			metadata: {
		  			  sourceFile: analysisResult.file,
		  			  language: analysisResult.language,
		  			  analysisTimestamp: analysisResult.metadata?.timestamp || new Date().toISOString(),
		  			  jiraTemplate: 'CER Standard Template v1.0'
		  			}
		  		  }, null, 2),
		  		},
		  	  ],
		  	};
		    } catch (error) {
		  	return {
		  	  content: [
		  		{
		  		  type: 'text',
		  		  text: `Failed to create Jira issue data: ${error.message}`,
		  		},
		  	  ],
		  	};
		    }
		  }
		  case 'analyze_and_create_jira_workflow': {
		    const { 
		  	filePath, 
		  	content, 
		  	searchDirectory, 
		  	projectKey = 'CER',
		  	assignee,
		  	environment = 'Development',
		  	incidentId,
		  	skipSimilarSearch = false
		    } = args;
		    
		    const workflow = {
		  	steps: [],
		  	results: {},
		  	jiraPayload: null,
		  	recommendations: []
		    };
		    
		    try {
		  	// STEP 1: Code Analysis
		  	workflow.steps.push({ step: 1, name: 'Code Analysis', status: 'starting' });
		  	console.error('[WORKFLOW] Step 1: Starting code analysis...');
		  	
		  	const analysisResult = await this.traversalAnalyzer.analyzeFileIntelligently(
		  	  filePath, content, searchDirectory
		  	);
		  	workflow.results.analysis = analysisResult;
		  	workflow.steps[0].status = 'completed';
		  	workflow.steps[0].result = `Analysis completed for ${analysisResult.language} file`;
		  	
		  	// STEP 2: Search for Similar Issues (if not skipped)
		  	if (!skipSimilarSearch) {
		  	  workflow.steps.push({ step: 2, name: 'Similar Issues Search', status: 'starting' });
		  	  
		  	  const searchQueries = this.jiraHelper.generateRelatedContentQueries(analysisResult);
		  	  workflow.results.searchQueries = searchQueries;
		  	  workflow.steps[1].status = 'completed';
		  	  workflow.steps[1].result = `Prepared ${searchQueries.length} search queries for similar issues`;
		  	  
		  	  workflow.recommendations.push({
		  		type: 'manual_search',
		  		message: 'Before creating Jira, search for similar issues using these queries:',
		  		queries: searchQueries.map(q => q.query),
		  		instruction: 'Use jira-confluence-mcp server search_jira_project tool'
		  	  });
		  	}
		  	
		  	// STEP 3: Prepare Jira Issue
		  	workflow.steps.push({ step: 3, name: 'Jira Issue Preparation', status: 'starting' });
		  	
		  	const jiraIssueData = this.jiraHelper.prepareJiraIssueData(analysisResult, {
		  	  projectKey,
		  	  assignee,
		  	  environment,
		  	  incidentId
		  	});
		  	
		  	// Format according to your template
		  	workflow.jiraPayload = {
		  	  projectKey: jiraIssueData.projectKey,
		  	  issueType: jiraIssueData.issueType,
		  	  summary: jiraIssueData.summary,
		  	  description: jiraIssueData.description,
		  	  components: jiraIssueData.components,
		  	  customFields: jiraIssueData.customFields,
		  	  versions: jiraIssueData.versions,
		  	  assignee: jiraIssueData.assignee,
		  	  priority: jiraIssueData.priority,
		  	  environment: jiraIssueData.environment,
		  	  labels: jiraIssueData.labels
		  	};
		  	
		  	workflow.steps[2].status = 'completed';
		  	workflow.steps[2].result = `Jira issue prepared: ${jiraIssueData.issueType} - ${jiraIssueData.priority} priority`;
		  	
		  	// STEP 4: Final Recommendations
		  	workflow.recommendations.push({
		  	  type: 'ready_to_create',
		  	  message: 'Jira issue is ready to be created',
		  	  nextSteps: [
		  		'Review the jiraPayload below',
		  		'Use jira-confluence-mcp server create_issue tool with this payload',
		  		'Or use your Jira REST API with the provided data'
		  	  ]
		  	});
		  	
		  	return {
		  	  content: [{
		  		type: 'text',
		  		text: JSON.stringify({
		  		  workflow: workflow,
		  		  readyForJira: true,
		  		  jiraPayload: workflow.jiraPayload,
		  		  summary: {
		  			analysisComplete: true,
		  			issueType: workflow.jiraPayload.issueType,
		  			priority: workflow.jiraPayload.priority,
		  			summary: workflow.jiraPayload.summary.substring(0, 100) + '...',
		  			components: workflow.jiraPayload.components,
		  			environment: workflow.jiraPayload.environment
		  		  }
		  		}, null, 2)
		  	  }]
		  	};
		  	
		    } catch (error) {
		  	console.error('[WORKFLOW] Error in complete workflow:', error);
		  	
		  	const currentStep = workflow.steps[workflow.steps.length - 1];
		  	if (currentStep) {
		  	  currentStep.status = 'failed';
		  	  currentStep.error = error.message;
		  	}
		  	
		  	return {
		  	  content: [{
		  		type: 'text',
		  		text: JSON.stringify({
		  		  error: `Workflow failed: ${error.message}`,
		  		  partialResults: workflow
		  		}, null, 2)
		  	  }]
		  	};
		    }
		  }
          case 'extract_confluence_search_terms': {
            const { analysisResult, jiraIssues = [], searchScope = 'all' } = args;
            
            try {
              const confluenceSearchTerms = this.extractConfluenceSearchTerms(analysisResult, jiraIssues, searchScope);
              
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    searchTerms: confluenceSearchTerms,
                    usage: {
                      forConfluenceSearch: `Use with search_confluence: "${confluenceSearchTerms.primary}"`,
                      forSpaceSearch: `Use space-specific search: "${confluenceSearchTerms.technical}"`,
                      forTroubleshooting: `Search for solutions: "${confluenceSearchTerms.troubleshooting}"`
                    },
                    recommendedSpaces: confluenceSearchTerms.recommendedSpaces
                  }, null, 2)
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: 'text',
                  text: `Failed to extract Confluence search terms: ${error.message}`
                }]
              };
            }
          }
          
          case 'prepare_confluence_page_content': {
            const { 
              analysisResult, 
              jiraIssues = [], 
              confluencePages = [],
              pageType = 'technical_analysis',
              spaceKey,
              includeCodeSnippets = true
            } = args;
            
            try {
              const pageContent = this.prepareConfluencePageContent(
                analysisResult, 
                jiraIssues, 
                confluencePages, 
                pageType, 
                spaceKey,
                includeCodeSnippets
              );
              
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    pageContent: pageContent,
                    readyForConfluence: true,
                    usage: {
                      toolToUse: 'create_page (from Confluence MCP)',
                      serverToCall: 'jira-confluence-mcp',
                      pageData: {
                        spaceKey: spaceKey,
                        title: pageContent.title,
                        body: pageContent.body,
                        labels: pageContent.labels
                      }
                    }
                  }, null, 2)
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: 'text',
                  text: `Failed to prepare Confluence content: ${error.message}`
                }]
              };
            }
          }
          
          case 'complete_analysis_workflow': {
            const { 
              filePath, 
              content, 
              searchDirectory, 
              projectKey, 
              confluenceSpaceKey,
              workflowOptions = {}
            } = args;
            
            const workflow = {
              steps: [],
              results: {
                analysis: null,
                jiraSearch: null,
                confluenceSearch: null,
                recommendations: [],
                documentation: null
              },
              summary: null,
              nextActions: []
            };
            
            try {
              // STEP 1: Code Analysis
              workflow.steps.push({ step: 1, name: 'Code Analysis', status: 'starting' });
              console.error('[WORKFLOW] Step 1: Starting code analysis...');
              
              const analysisResult = await this.traversalAnalyzer.analyzeFileIntelligently(
                filePath, content, searchDirectory
              );
              workflow.results.analysis = analysisResult;
              workflow.steps[0].status = 'completed';
              workflow.steps[0].result = `Analysis completed for ${analysisResult.language} file`;
              
              // STEP 2: Jira Search (if enabled)
              if (workflowOptions.searchJira !== false && projectKey) {
                workflow.steps.push({ step: 2, name: 'Jira Search Preparation', status: 'starting' });
                
                const jiraSearchTerms = this.extractJiraSearchTerms(analysisResult, 8);
                workflow.results.jiraSearchTerms = jiraSearchTerms;
                workflow.steps[1].status = 'completed';
                workflow.steps[1].result = `Prepared Jira search terms: ${jiraSearchTerms.primary.join(', ')}`;
                
                workflow.nextActions.push({
                  action: 'search_similar_jira_issues',
                  server: 'jira-confluence-mcp',
                  tool: 'find_similar_issues',
                  params: {
                    referenceIssue: jiraSearchTerms.primary.join(' '),
                    searchScope: 'project',
                    projects: [projectKey],
                    maxResults: 10
                  }
                });
                
                if (workflowOptions.jiraSearchDepth === 'comprehensive') {
                  workflow.nextActions.push({
                    action: 'comprehensive_jira_search',
                    server: 'jira-confluence-mcp', 
                    tool: 'search_jira_project',
                    params: {
                      projectKey: projectKey,
                      query: jiraSearchTerms.combined,
                      maxResults: 15
                    }
                  });
                }
              }
              
              // STEP 3: Confluence Search (if enabled)
              if (workflowOptions.searchConfluence !== false) {
                workflow.steps.push({ step: 3, name: 'Confluence Search Preparation', status: 'starting' });
                
                const confluenceSearchTerms = this.extractConfluenceSearchTerms(
                  analysisResult, 
                  [], 
                  workflowOptions.confluenceSearchScope || 'all'
                );
                workflow.results.confluenceSearchTerms = confluenceSearchTerms;
                workflow.steps[2].status = 'completed';
                workflow.steps[2].result = `Prepared Confluence search terms: ${confluenceSearchTerms.primary}`;
                
                // Add Confluence search actions
                workflow.nextActions.push({
                  action: 'search_confluence_documentation',
                  server: 'jira-confluence-mcp',
                  tool: 'search_confluence',
                  params: {
                    query: confluenceSearchTerms.primary,
                    spaceKey: confluenceSpaceKey || undefined,
                    maxResults: 10
                  }
                });
                
                // Additional technical documentation search
                if (confluenceSearchTerms.technical !== confluenceSearchTerms.primary) {
                  workflow.nextActions.push({
                    action: 'search_technical_docs',
                    server: 'jira-confluence-mcp',
                    tool: 'search_confluence',
                    params: {
                      query: confluenceSearchTerms.technical,
                      spaceKey: confluenceSpaceKey || undefined,
                      maxResults: 5
                    }
                  });
                }
              }
              
              // STEP 4: Documentation Preparation (if enabled)
              if (workflowOptions.createConfluencePage !== false && confluenceSpaceKey) {
                workflow.steps.push({ step: 4, name: 'Documentation Preparation', status: 'starting' });
                
                const documentationPrep = this.prepareConfluencePageContent(
                  analysisResult,
                  [], // Will be filled after Jira search
                  [], // Will be filled after Confluence search
                  'technical_analysis',
                  confluenceSpaceKey,
                  true
                );
                
                workflow.results.documentation = documentationPrep;
                workflow.steps[3].status = 'completed';
                workflow.steps[3].result = `Prepared documentation: ${documentationPrep.title}`;
                
                workflow.nextActions.push({
                  action: 'create_confluence_page',
                  server: 'jira-confluence-mcp',
                  tool: 'create_page',
                  params: {
                    spaceKey: confluenceSpaceKey,
                    title: documentationPrep.title,
                    body: documentationPrep.body,
                    labels: documentationPrep.labels
                  }
                });
              }
              
              // STEP 5: Generate Recommendations
              workflow.steps.push({ step: 5, name: 'Generate Recommendations', status: 'starting' });
              
              workflow.results.recommendations = this.generateWorkflowRecommendations(
                analysisResult, 
                [], 
                workflowOptions
              );
              
              workflow.steps[4].status = 'completed';
              workflow.steps[4].result = `Generated ${workflow.results.recommendations.length} recommendations`;
              
              // Generate workflow summary
              workflow.summary = this.generateWorkflowSummary(workflow, workflowOptions);
              
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify(workflow, null, 2)
                }]
              };
              
            } catch (error) {
              console.error('[WORKFLOW] Error in complete workflow:', error);
              
              const currentStep = workflow.steps[workflow.steps.length - 1];
              if (currentStep) {
                currentStep.status = 'failed';
                currentStep.error = error.message;
              }
              
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    error: `Complete workflow failed: ${error.message}`,
                    partialResults: workflow
                  }, null, 2)
                }]
              };
            }
          }
          case 'prepare_jira_issue_from_analysis': {
            const { analysisResult, userInput = {} } = args;
            
            try {
              const jiraIssueData = this.jiraHelper.prepareJiraIssueData(analysisResult, userInput);
              
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      jiraIssueData,
                      message: 'Jira issue data prepared successfully. Use this data with the Jira MCP server to create the issue.'
                    }, null, 2),
                  },
                ],
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Failed to prepare Jira issue data: ${error.message}`,
                  },
                ],
              };
            }
          }
          case 'validate_table_names':
            response = await this.handleValidateTableNames(args);
            break;
          case 'get_available_tables':
            response = await this.handleGetAvailableTables(args);
            break;
          case 'refresh_table_registry':
            response = await this.handleRefreshTableRegistry(args);
            break;
          case 'get_ai_agent_instructions':
            response = await this.handleGetAIAgentInstructions(args);
            break;		  
          case 'generate_related_content_queries': {
            const { analysisResult } = args;
           
            try {
              const queries = this.jiraHelper.generateRelatedContentQueries(analysisResult);
              
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      queries,
                      totalQueries: queries.length,
                      message: 'Use these queries with the Jira/Confluence MCP server to find related content.'
                    }, null, 2),
                  },
                ],
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Failed to generate related content queries: ${error.message}`,
                  },
                ],
              };
            }
          }

          case 'format_analysis_summary': {
            const { analysisResult } = args;
            
            try {
              const summary = this.jiraHelper.formatAnalysisSummary(analysisResult);
              
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      summary,
                      recommendation: summary.shouldCreateJira ? 
                        'This analysis suggests creating a Jira issue would be beneficial.' :
                        'This analysis may not require a Jira issue, but you can still create one if needed.'
                    }, null, 2),
                  },
                ],
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Failed to format analysis summary: ${error.message}`,
                  },
                ],
              };
            }
          }
		  case 'analyze_and_suggest_jira': {
		  const { filePath, content, searchDirectory, projectKey, skipRelatedSearch = false } = args;
		  
		  try {
		 	 // Step 1: Perform analysis
		 	 const analysisResult = await this.traversalAnalyzer.analyzeFileIntelligently(
		 	 filePath, content, searchDirectory
		 	 );
		 	 
		 	 // Step 2: Format summary for user
		 	 const summary = this.jiraHelper.formatAnalysisSummary(analysisResult);
		 	 
		 	 // Step 3: Prepare Jira data (in case user confirms)
		 	 const jiraData = this.jiraHelper.prepareJiraIssueData(analysisResult);
		 	 
		 	 // Step 4: Generate queries for related content search
		 	 const relatedQueries = this.jiraHelper.generateRelatedContentQueries(analysisResult);
		 	 
		 	 return {
		 	 content: [
		 		 {
		 		 type: 'text',
		 		 text: JSON.stringify({
		 			 step: 'analysis_complete',
		 			 analysisResult,
		 			 summary,
		 			 jiraData: {
		 			 projectKey,
		 			 preparedIssue: jiraData,
		 			 analysisId: jiraData.analysisId
		 			 },
		 			 relatedContentQueries: relatedQueries,
		 			 nextStep: skipRelatedSearch ? 'ready_for_confirmation' : 'search_related_content',
		 			 message: summary.shouldCreateJira 
		 			 ? 'Analysis complete. Issue detected that may benefit from a Jira ticket.'
		 			 : 'Analysis complete. Consider whether this needs a Jira ticket.'
		 		 }, null, 2),
		 		 },
		 	 ],
		 	 };
		  } catch (error) {
		 	 return {
		 	 content: [
		 		 {
		 		 type: 'text',
		 		 text: `Analysis workflow failed: ${error.message}`,
		 		 },
		 	 ],
		 	 };
		  }
		  }
		  case 'confirm_jira_creation': {
		  const { analysisId, userConfirmed, projectKey, customizations = {} } = args;
		  
		  try {
		 	 if (!userConfirmed) {
		 	 return {
		 		 content: [
		 		 {
		 			 type: 'text',
		 			 text: JSON.stringify({
		 			 action: 'cancelled',
		 			 message: 'Jira issue creation cancelled by user.',
		 			 analysisId
		 			 }, null, 2),
		 		 },
		 		 ],
		 	 };
		 	 }
		 	 
		 	 // Get stored analysis
		 	 const storedAnalysis = this.jiraHelper.getAnalysis(analysisId);
		 	 if (!storedAnalysis) {
		 	 throw new Error('Analysis not found. Please run analysis again.');
		 	 }
		 	 
		 	 // Prepare final Jira data with customizations
		 	 const finalJiraData = this.jiraHelper.prepareJiraIssueData(
		 	 storedAnalysis.result, 
		 	 customizations
		 	 );
		 	 
		 	 return {
		 	 content: [
		 		 {
		 		 type: 'text',
		 		 text: JSON.stringify({
		 			 action: 'create_jira_issue',
		 			 projectKey,
		 			 issueData: {
		 			 projectKey,
		 			 issueType: finalJiraData.issueType,
		 			 summary: finalJiraData.summary,
		 			 description: finalJiraData.description,
		 			 priority: finalJiraData.priority,
		 			 labels: finalJiraData.labels,
		 			 components: finalJiraData.components
		 			 },
		 			 analysisId,
		 			 message: 'User confirmed Jira creation. Use this data with the Jira MCP server create_issue tool.',
		 			 instructions: {
		 			 tool: 'create_issue',
		 			 server: 'jira-confluence-mcp',
		 			 note: 'Call the Jira MCP server with the issueData above'
		 			 }
		 		 }, null, 2),
		 		 },
		 	 ],
		 	 };
		  } catch (error) {
		 	 return {
		 	 content: [
		 		 {
		 		 type: 'text',
		 		 text: `Failed to confirm Jira creation: ${error.message}`,
		 		 },
		 	 ],
		 	 };
		  }
		  }
          case 'list_files':
            return await this.handleListFiles(args);
          case 'read_file':
            return await this.handleReadFile(args);
          default:
            return {
              content: [
                {
                  type: 'text',
                  text: `Unknown tool: ${name}`,
                },
              ],
            };
        }

		if (!this.isClientConnected()) {
		  console.error('[MCP] Client disconnected before response validation');
		  return null;
		}

        if (this.tableValidationEnabled && response) {
          const validation = await this.responseValidator.validateResponse(response, {
            autoCorrect: true,
            rejectOnError: false,
            includeInstructions: true
          });
          
          if (!validation.valid && validation.issues) {
            console.error(`[TABLE_VALIDATION] Found ${validation.issues.length} table validation issues in response`);
          }
          return validation.response || response;
        }
		
		// Final client connection check before sending
		if (!this.isClientConnected()) {
		  console.error('[MCP] Client disconnected before sending response');
		  return null;
		}

        return response;		

      } catch (error) {

		// Handle specific error types
		if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
		  console.error('[MCP] Client disconnected during tool execution');
		  return null;
		}
		
		// Log the error for debugging
		console.error(`[MCP] Tool execution error for ${request.params.name}:`, error);
		
		// Check if we can still send error response
		if (!this.isClientConnected()) {
		  console.error('[MCP] Cannot send error response - client disconnected');
		  return null;
		}		  

        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${request.params.name}: ${error.message}`,
            },
          ],
        };
		
		isError: true
      }
    });
  }
  
    // Add security stats endpoint
    async handleGetSecurityStats() {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            pathSecurity: pathValidator.getSecurityStats(),
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    }
  
	extractConfluenceSearchTerms(analysisResult, jiraIssues, searchScope) {
	const terms = {
		primary: '',
		technical: '',
		troubleshooting: '',
		documentation: '',
		keywords: [],
		recommendedSpaces: []
	};
	
	// Extract base terms from analysis
	const baseTerms = [];
	
	// Add technical terms
	if (analysisResult.language) {
		baseTerms.push(analysisResult.language);
		terms.recommendedSpaces.push('DEV', 'TECH', analysisResult.language.toUpperCase());
	}
	
	// Add error types for troubleshooting
	if (analysisResult.explanation) {
		const explanation = analysisResult.explanation.toLowerCase();
		
		const technicalTerms = [
		'exception', 'error', 'null', 'validation', 'configuration',
		'database', 'connection', 'timeout', 'authentication', 'permission'
		];
		
		technicalTerms.forEach(term => {
		if (explanation.includes(term)) {
			baseTerms.push(term);
			terms.keywords.push(term);
		}
		});
		
		// Add class/service names
		const classPattern = /\b[A-Z][a-zA-Z0-9]*(?:Service|Controller|Manager|Handler|Util)\b/g;
		const classMatches = analysisResult.explanation.match(classPattern) || [];
		baseTerms.push(...classMatches.slice(0, 3));
	}
	
	// Add from file name
	if (analysisResult.file) {
		const fileName = analysisResult.file.split('/').pop().replace(/\.(java|js|py|cpp)$/, '');
		baseTerms.push(fileName);
	}
	
	// Add from Jira issues
	jiraIssues.forEach(issue => {
		const issueTerms = issue.summary.split(' ').filter(word => 
		word.length > 3 && !/^(and|the|for|with|from|that|this|when|where)$/i.test(word)
		);
		baseTerms.push(...issueTerms.slice(0, 2));
	});
	
	// Build different search strategies
	const uniqueTerms = [...new Set(baseTerms)];
	
	if (searchScope === 'technical' || searchScope === 'all') {
		terms.technical = uniqueTerms.slice(0, 6).join(' ');
		terms.recommendedSpaces.push('TECH', 'DEV', 'API');
	}
	
	if (searchScope === 'troubleshooting' || searchScope === 'all') {
		const troubleshootingTerms = terms.keywords.concat(
		uniqueTerms.filter(term => 
			/error|exception|fail|issue|problem|fix|solution/i.test(term)
		)
		);
		terms.troubleshooting = troubleshootingTerms.slice(0, 5).join(' ');
		terms.recommendedSpaces.push('SUPPORT', 'KB', 'TROUBLESHOOT');
	}
	
	if (searchScope === 'documentation' || searchScope === 'all') {
		terms.documentation = uniqueTerms.slice(0, 4).join(' ') + ' documentation guide';
		terms.recommendedSpaces.push('DOC', 'GUIDE', 'WIKI');
	}
	
	// Primary search combines the most relevant terms
	terms.primary = uniqueTerms.slice(0, 5).join(' ');
	terms.keywords = uniqueTerms.slice(0, 10);
	terms.recommendedSpaces = [...new Set(terms.recommendedSpaces)];
	
	return terms;
	}
	
	prepareConfluencePageContent(analysisResult, jiraIssues, confluencePages, pageType, spaceKey, includeCodeSnippets) {
	const timestamp = new Date().toISOString().split('T')[0];
	const fileName = analysisResult.file ? analysisResult.file.split('/').pop() : 'Unknown File';
	
	let title, body, labels;
	
	switch (pageType) {
		case 'troubleshooting':
		title = `Troubleshooting: ${fileName} - ${timestamp}`;
		body = this.buildTroubleshootingPageBody(analysisResult, jiraIssues, confluencePages, includeCodeSnippets);
		labels = ['troubleshooting', 'analysis', analysisResult.language, 'automated'];
		break;
		
		case 'issue_documentation':
		title = `Issue Analysis: ${fileName} - ${timestamp}`;
		body = this.buildIssueDocumentationBody(analysisResult, jiraIssues, confluencePages, includeCodeSnippets);
		labels = ['issue-analysis', 'documentation', analysisResult.language, 'automated'];
		break;
		
		case 'knowledge_base':
		title = `Knowledge Base: ${fileName} Analysis - ${timestamp}`;
		body = this.buildKnowledgeBaseBody(analysisResult, jiraIssues, confluencePages, includeCodeSnippets);
		labels = ['knowledge-base', 'analysis', analysisResult.language, 'reference'];
		break;
		
		case 'technical_analysis':
		default:
		title = `Technical Analysis: ${fileName} - ${timestamp}`;
		body = this.buildTechnicalAnalysisBody(analysisResult, jiraIssues, confluencePages, includeCodeSnippets);
		labels = ['technical-analysis', 'code-review', analysisResult.language, 'automated'];
		break;
	}
	
	return {
		title,
		body,
		labels,
		spaceKey,
		pageType,
		metadata: {
		sourceFile: analysisResult.file,
		analysisTimestamp: analysisResult.metadata?.timestamp || new Date().toISOString(),
		language: analysisResult.language,
		relatedJiraIssues: jiraIssues.length,
		relatedConfluencePages: confluencePages.length
		}
	};
	}
	
	buildTechnicalAnalysisBody(analysisResult, jiraIssues, confluencePages, includeCodeSnippets) {
	let body = `# Technical Analysis Report
	
	## Overview
	This page documents the technical analysis performed on **${analysisResult.file || 'code file'}** on ${new Date().toLocaleDateString()}.
	
	## File Information
	| Property | Value |
	|----------|-------|
	| **File** | \`${analysisResult.file || 'Unknown'}\` |
	| **Language** | ${analysisResult.language || 'Unknown'} |
	| **Analysis Type** | Code Traversal & Pattern Analysis |
	| **Lines of Code** | ${analysisResult.metadata?.lineCount || 'Unknown'} |
	
	`;
	
	// Analysis Results Section
	body += `## Analysis Results
	
	### Issue Summary
	${analysisResult.explanation || 'No specific issues detected in the analysis.'}
	
	`;
	
	// Technical Details
	if (analysisResult.resolved) {
		body += `### Technical Details
	
	`;
		if (analysisResult.resolved.constants?.length > 0) {
		body += `**Constants Found (${analysisResult.resolved.summary?.totalConstants || 0}):**
	`;
		analysisResult.resolved.constants.slice(0, 5).forEach(constant => {
			body += `- \`${constant.name}\`: ${constant.value} (Source: ${constant.source})\n`;
		});
		body += `\n`;
		}
		
		if (analysisResult.resolved.arrays?.length > 0) {
		body += `**Data Structures (${analysisResult.resolved.summary?.totalArrays || 0}):**
	`;
		analysisResult.resolved.arrays.slice(0, 5).forEach(array => {
			if (array.type === 'database') {
			body += `- Database Table: \`${array.table}\` (${array.columns?.length || 0} columns)\n`;
			} else {
			body += `- Array/Collection: \`${array.name}\` (${array.operation || 'unknown operation'})\n`;
			}
		});
		body += `\n`;
		}
	}
	
	// Code Snippet Section
	if (includeCodeSnippets && analysisResult.analysis?.snippet) {
		body += `## Code Snippet
	
	\`\`\`${analysisResult.language || 'text'}
	${analysisResult.analysis.snippet}
	\`\`\`
	
	`;
	}
	
	// Recommendations Section
	if (analysisResult.analysis?.recommendations?.length > 0) {
		body += `## Recommendations
	
	`;
		analysisResult.analysis.recommendations.forEach((rec, index) => {
		const priority = rec.priority || 'medium';
		const emoji = priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢';
		
		body += `### ${emoji} ${rec.title || rec.type || `Recommendation ${index + 1}`}
	**Priority:** ${priority.toUpperCase()}
	
	${rec.description || rec.message || 'No description provided.'}
	
	`;
		if (rec.action || rec.suggestion) {
			body += `**Suggested Action:** ${rec.action || rec.suggestion}
	
	`;
		}
		
		if (rec.query) {
			body += `**SQL to verify:**
	\`\`\`sql
	${rec.query}
	\`\`\`
	
	`;
		}
		});
	}
	
	// Related Jira Issues Section
	if (jiraIssues && jiraIssues.length > 0) {
		body += `## Related Jira Issues
	
	Found ${jiraIssues.length} related issue(s):
	
	| Issue Key | Summary | Status | Priority |
	|-----------|---------|--------|----------|
	`;
		jiraIssues.slice(0, 10).forEach(issue => {
		body += `| [${issue.key}] | ${issue.summary} | ${issue.status || 'Unknown'} | ${issue.priority || 'Unknown'} |\n`;
		});
		body += `\n`;
	}
	
	// Related Documentation Section
	if (confluencePages && confluencePages.length > 0) {
		body += `## Related Documentation
	
	Found ${confluencePages.length} related documentation page(s):
	
	`;
		confluencePages.slice(0, 8).forEach(page => {
		body += `- [${page.title}](${page.webUrl || '#'}) (Space: ${page.space || 'Unknown'})\n`;
		if (page.excerpt) {
			body += `  *${page.excerpt.substring(0, 100)}...*\n`;
		}
		});
		body += `\n`;
	}
	
	// Dependencies Section
	if (analysisResult.analysis?.dependencies?.length > 0) {
		body += `## Dependencies Analysis
	
	`;
		const depsByType = {};
		analysisResult.analysis.dependencies.forEach(dep => {
		const type = dep.type || 'unknown';
		if (!depsByType[type]) depsByType[type] = [];
		depsByType[type].push(dep);
		});
		
		Object.entries(depsByType).forEach(([type, deps]) => {
		body += `### ${type.replace(/_/g, ' ').toUpperCase()}
	`;
		deps.slice(0, 5).forEach(dep => {
			body += `- **${dep.name}**: ${dep.sources?.[0]?.context || 'No context available'}\n`;
		});
		body += `\n`;
		});
	}
	
	// Footer
	body += `---
	
	## Metadata
	- **Generated:** ${new Date().toISOString()}
	- **Analysis Engine:** ChatBot Assistant MCP Server
	- **Report Type:** Technical Analysis
	- **Source:** Automated Code Analysis
	
	*This page was automatically generated from code analysis results. For questions or updates, please contact the development team.*
	
	`;
	
	return body;
	}
	
	buildTroubleshootingPageBody(analysisResult, jiraIssues, confluencePages, includeCodeSnippets) {
	let body = `# Troubleshooting Guide: ${analysisResult.file || 'Code Issue'}
	
	## Problem Summary
	${analysisResult.explanation || 'Issue detected during code analysis.'}
	
	## Quick Fix
	`;
	
	// Add quick fixes from recommendations
	if (analysisResult.analysis?.recommendations?.length > 0) {
		const quickFix = analysisResult.analysis.recommendations.find(r => r.priority === 'high') || 
						analysisResult.analysis.recommendations[0];
		body += `**${quickFix.title || quickFix.type}**
	${quickFix.action || quickFix.suggestion || 'See detailed analysis below.'}
	
	`;
	}
	
	body += `## Detailed Analysis
	### Root Cause
	${analysisResult.analysis?.immediateIssue?.rootCause || 'Analysis based on code patterns and dependencies.'}
	
	### Symptoms
	- File: \`${analysisResult.file}\`
	- Language: ${analysisResult.language}
	- Issue detected in automated analysis
	
	`;
	
	if (includeCodeSnippets && analysisResult.analysis?.snippet) {
		body += `### Code Location
	\`\`\`${analysisResult.language || 'text'}
	${analysisResult.analysis.snippet}
	\`\`\`
	
	`;
	}
	
	body += `## Solution Steps
	`;
	
	// Add solution steps from recommendations
	if (analysisResult.analysis?.recommendations?.length > 0) {
		analysisResult.analysis.recommendations.forEach((rec, index) => {
		body += `${index + 1}. **${rec.title || rec.type}** (${rec.priority || 'medium'} priority)
	- ${rec.description || rec.message}
	- Action: ${rec.action || rec.suggestion || 'Review and implement fix'}
	
	`;
		});
	} else {
		body += `1. Review the code analysis details above
	2. Check for similar resolved issues in Jira
	3. Implement recommended fixes
	4. Test the changes
	
	`;
	}
	
	// Add related issues
	if (jiraIssues?.length > 0) {
		body += `## Related Issues
	The following Jira issues may be related to this problem:
	
	`;
		jiraIssues.slice(0, 5).forEach(issue => {
		const statusIcon = issue.status === 'Resolved' ? '✅' : issue.status === 'In Progress' ? '🔄' : '❓';
		body += `- ${statusIcon} [${issue.key}]: ${issue.summary} (${issue.status})\n`;
		});
	}
	
	body += `
	
	---
	*This troubleshooting guide was generated from automated code analysis on ${new Date().toLocaleDateString()}.*
	`;
	
	return body;
	}
	
	buildIssueDocumentationBody(analysisResult, jiraIssues, confluencePages, includeCodeSnippets) {
	return this.buildTechnicalAnalysisBody(analysisResult, jiraIssues, confluencePages, includeCodeSnippets);
	}
	
	buildKnowledgeBaseBody(analysisResult, jiraIssues, confluencePages, includeCodeSnippets) {
	let body = `# Knowledge Base Entry
	
	## Summary
	${analysisResult.explanation || 'Code analysis findings documented for future reference.'}
	
	## Key Findings
	`;
	
	if (analysisResult.analysis?.recommendations?.length > 0) {
		body += `### Technical Insights
	`;
		analysisResult.analysis.recommendations.forEach((rec, index) => {
		body += `**${rec.type || `Finding ${index + 1}`}:** ${rec.message || rec.description}
	- Solution: ${rec.action || rec.suggestion}
	
	`;
		});
	}
	
	// Add patterns and learnings
	body += `### Patterns Observed
	- Language: ${analysisResult.language}
	- File Type: ${analysisResult.file?.split('.').pop()?.toUpperCase() || 'Unknown'}
	- Analysis Method: Code traversal and dependency analysis
	
	`;
	
	if (includeCodeSnippets && analysisResult.analysis?.snippet) {
		body += `### Code Example
	\`\`\`${analysisResult.language || 'text'}
	${analysisResult.analysis.snippet}
	\`\`\`
	
	`;
	}
	
	body += `### Best Practices
	Based on this analysis, consider these best practices:
	
	1. **Code Quality**: Regular automated analysis helps catch issues early
	2. **Dependencies**: Trace data sources and configuration dependencies  
	3. **Documentation**: Keep analysis results for team knowledge sharing
	4. **Testing**: Implement tests for the scenarios identified in analysis
	
	## Cross-References
	`;
	
	if (jiraIssues?.length > 0) {
		body += `### Related Issues
	`;
		jiraIssues.forEach(issue => {
		body += `- [${issue.key}]: ${issue.summary}\n`;
		});
		body += `\n`;
	}
	
	if (confluencePages?.length > 0) {
		body += `### Related Documentation
	`;
		confluencePages.forEach(page => {
		body += `- [${page.title}](${page.webUrl})\n`;
		});
		body += `\n`;
	}
	
	body += `---
	**Entry created:** ${new Date().toLocaleDateString()}  
	**Source:** Automated Code Analysis  
	**Tags:** ${analysisResult.language}, analysis, knowledge-base
	`;
	
	return body;
	}
  
  async handleSmartSearch(args) {
    try {
      const {
        query,
        directories,
        fileTypes = ['all'],
        caseSensitive = false,
        maxResults = 10
      } = args;
  
      const searchDirs = directories || this.getDefaultSearchDirectories();
      
      if (searchDirs.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No search directories configured. Please set DEFAULT_SOURCE_DIR and/or DEFAULT_DOCS_DIR environment variables.',
            },
          ],
        };
      }
  
      const results = await this.searchEngine.smartSearch(query, searchDirs, {
        fileTypes,
        caseSensitive,
        maxResults,
        contextLines: 3
      });
  
      // If no results found, try error log tracing as fallback
      if (!results.results || results.results.length === 0) {
        console.error(`[SMART_SEARCH] No results found. Trying error log trace...`);
        
        try {
          const traceResults = await this.searchEngine.traceErrorLogToSource(query, searchDirs, {
            fileTypes,
            maxResults: 3
          });
          
          // Add trace results to the response
          results.traceFallback = {
            attempted: true,
            results: traceResults,
            message: traceResults === 'No matching source found for the error log.' 
              ? 'Error log trace also found no matches' 
              : 'Found potential matches using error log pattern analysis'
          };
        } catch (traceError) {
          results.traceFallback = {
            attempted: true,
            error: traceError.message,
            message: 'Error log trace fallback failed'
          };
        }
      }
  
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Smart search failed: ${error.message}`,
          },
        ],
      };
    }
  }
  
  async handleSearchSourceCode(args) {
    const { query, directories } = args;
    return await this.handleSmartSearch({
      query,
      directories,
      fileTypes: ['java', 'javascript', 'python', 'cpp', 'csharp', 'web', 'config', 'sql', 'shell'],
      caseSensitive: false,
      maxResults: 5
    });
  }
  
  async handleSearchDocumentation(args) {
    const { query, directories } = args;
    
    const searchDirs = directories || [process.env.DEFAULT_DOCS_DIR, process.env.DEFAULT_SOURCE_DIR].filter(Boolean);
    
    return await this.handleSmartSearch({
      query,
      directories: searchDirs,
      fileTypes: ['docs'],
      caseSensitive: false,
      maxResults: 10
    });
  }
  
  async handleAnalyzeProjectStructure(args) {
    try {
      const { directories } = args;
      const analyzedirs = directories || this.getDefaultSearchDirectories();
      
      if (analyzedirs.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No directories to analyze. Please specify directories or configure DEFAULT_SOURCE_DIR and DEFAULT_DOCS_DIR.',
            },
          ],
        };
      }

      const stats = await DirectoryManager.getDirectoryStats(analyzedirs);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              analysis: stats,
              configuration: DirectoryManager.getConfiguredDirectories(),
              timestamp: new Date().toISOString()
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Project structure analysis failed: ${error.message}`,
          },
        ],
      };
    }
  }

  async handleIntelligentCodeAnalysis(args) {
    try {
      const { filePath, content, searchDirectory } = args;
      
      const result = await this.traversalAnalyzer.analyzeFileIntelligently(
        filePath,
        content,
        searchDirectory
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Intelligent code analysis failed: ${error.message}`,
          },
        ],
      };
    }
  }
  
  async handleListFiles(args) {
    try {
      const {
        directory,
        fileTypes = [],
        maxFiles = 100
      } = args;

      const targetDir = directory || process.env.DEFAULT_SOURCE_DIR;
      
      if (!targetDir) {
        return {
          content: [
            {
              type: 'text',
              text: 'No directory specified and DEFAULT_SOURCE_DIR not configured.',
            },
          ],
        };
      }

      const files = await this.searchEngine.getAllFiles(targetDir);
      const filteredFiles = fileTypes.length > 0 ? 
        this.searchEngine.filterFilesByType(files, fileTypes) : files;

      const result = {
        directory: targetDir,
        totalFiles: files.length,
        filteredFiles: filteredFiles.length,
        files: filteredFiles.slice(0, maxFiles).map(f => ({
          name: f.name,
          path: f.relativePath,
          type: f.fileType,
          extension: f.extension
        }))
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `List files failed: ${error.message}`,
          },
        ],
      };
    }
  }
  
  async handleReadFile(args) {
    try {
      const { path: filePath, maxSize = 1024 * 1024 * 50 } = args; // 50MB default limit
      
      const stats = await fs.stat(filePath);
      if (stats.size > maxSize) {
        return {
          content: [
            {
              type: 'text',
              text: `File is too large: ${Math.round(stats.size / 1024 / 1024)}MB (limit: ${Math.round(maxSize / 1024 / 1024)}MB)`,
            },
          ],
        };
      }

      const content = await fs.readFile(filePath, 'utf8');
      
      return {
        content: [
          {
            type: 'text',
            text: content,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to read file: ${error.message}`,
          },
        ],
      };
    }
  }

  async handleAnalyzeWithTraversal(args) {
    try {
      const { snippet, file, searchDirectory, extraContext } = args;
      
      const searchDir = searchDirectory || this.getDefaultSearchDirectories()[0];
      
      if (!searchDir) {
        return {
          content: [
            {
              type: 'text',
              text: 'No search directory specified and no defaults configured.',
            },
          ],
        };
      }

      const analysis = await this.traversalAnalyzer.analyzeWithTraversal(
        snippet,
        file,
        searchDir,
        extraContext
      );
	  
      if (this.tableValidationEnabled && snippet) {
        const tableValidation = this.tableRegistry.validateTextForTables(snippet);
        if (!tableValidation.valid) {
          analysis.tableValidation = {
            hasIssues: true,
            issues: tableValidation.issues,
            availableTables: this.tableRegistry.getTableList().slice(0, 10)
          };
        }
      }

      // Format the analysis result
      const formattedResult = {
        summary: analysis.immediateIssue,
        dataSourceAnalysis: analysis.dataSourceAnalysis,
        dependencies: analysis.dependencies,
        recommendations: analysis.recommendations,
        traversalPath: analysis.traversalPath
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formattedResult, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Traversal analysis failed: ${error.message}`,
          },
        ],
      };
    }
  }
  
  async handleValidateTableNames(args) {
    const { text, autoCorrect = true } = args;
    
    if (!this.tableValidationEnabled) {
      return {
        content: [{
          type: 'text',
          text: 'Table validation is disabled. Set ENABLE_TABLE_VALIDATION=true to enable.',
        }],
      };
    }
    
    const validation = this.tableRegistry.validateTextForTables(text);
    
    if (validation.valid) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            valid: true,
            message: 'All table references are valid',
            validTables: validation.validTables.map(t => t.table),
          }, null, 2),
        }],
      };
    }
    
    // Build response with issues and suggestions
    const result = {
      valid: false,
      issues: validation.issues,
      suggestions: {},
    };
    
    if (autoCorrect) {
      for (const issue of validation.issues) {
        if (issue.suggestions && issue.suggestions.length > 0) {
          result.suggestions[issue.table] = issue.suggestions;
        }
      }
    }
    
    // Add list of available tables
    result.availableTables = this.tableRegistry.getTableList().slice(0, 20);
    result.totalAvailableTables = this.tableRegistry.tables.size;
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
  
  async handleGetAvailableTables(args) {
    const { pattern, includeMetadata = false } = args;
    
    if (!this.tableValidationEnabled) {
      return {
        content: [{
          type: 'text',
          text: 'Table validation is disabled. Set ENABLE_TABLE_VALIDATION=true to enable.',
        }],
      };
    }
    
    let tables = this.tableRegistry.getTableList();
    
    // Filter by pattern if provided
    if (pattern) {
      const regex = new RegExp(pattern, 'i');
      tables = tables.filter(t => regex.test(t));
    }
    
    const result = {
      tables: tables,
      count: tables.length,
      totalInRegistry: this.tableRegistry.tables.size,
    };
    
    if (includeMetadata) {
      result.metadata = {};
      for (const table of tables.slice(0, 50)) { // Limit metadata to first 50
        const meta = this.tableRegistry.tables.get(table);
        if (meta) {
          result.metadata[table] = {
            sources: Array.from(meta.sources).slice(0, 3),
            sourceCount: meta.sources.size,
            firstSeen: meta.firstSeen,
          };
        }
      }
    }
    
    result.summary = this.tableRegistry.getSummary();
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
  
  async handleRefreshTableRegistry(args) {
    const { directories } = args;
    
    if (!this.tableValidationEnabled) {
      return {
        content: [{
          type: 'text',
          text: 'Table validation is disabled. Set ENABLE_TABLE_VALIDATION=true to enable.',
        }],
      };
    }
    
    try {
      const searchDirs = directories || this.getDefaultSearchDirectories();
      const summary = await this.tableRegistry.refresh(searchDirs);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Table registry refreshed successfully',
            summary: summary,
            statistics: this.responseValidator.getStatistics(),
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Failed to refresh table registry: ${error.message}`,
        }],
      };
    }
  }
  
  async handleGetAIAgentInstructions(args) {
    const { format = 'system_prompt' } = args;
    
    if (!this.tableValidationEnabled) {
      return {
        content: [{
          type: 'text',
          text: 'Table validation is disabled. Set ENABLE_TABLE_VALIDATION=true to enable.',
        }],
      };
    }
    
    const instructions = this.tableRegistry.getAIAgentInstructions();
    
    let result;
    switch (format) {
      case 'system_prompt':
        result = instructions.systemPrompt;
        break;
      case 'full_context':
        result = instructions;
        break;
      case 'summary':
        result = {
          tableCount: instructions.validationContext.availableTables.length,
          sampleTables: instructions.validationContext.availableTables.slice(0, 10),
          rules: [
            'Only use actual table names from source code',
            'Never use fictional or placeholder names',
            'All SQL queries must reference real tables',
            'Ask for clarification if unsure about table names'
          ],
        };
        break;
      default:
        result = instructions.systemPrompt;
    }
    
    return {
      content: [{
        type: 'text',
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      }],
    };
  }

  getDefaultSearchDirectories() {
    return [process.env.DEFAULT_SOURCE_DIR, process.env.DEFAULT_DOCS_DIR].filter(Boolean);
  }
  
  isClientConnected() {
    // Simple check to see if we should continue processing
    try {
      return process.stdout.writable && process.stdin.readable;
    } catch (error) {
      return false;
    }
  }
  
  setupGlobalErrorHandlers() {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[MCP] Unhandled Rejection at:', promise, 'reason:', reason);
      if (reason && (reason.code === 'EPIPE' || reason.code === 'ECONNRESET')) {
        console.error('[MCP] Client connection lost');
        process.exit(0);
      }
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('[MCP] Uncaught Exception:', error);
      if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
        console.error('[MCP] Broken pipe or connection reset');
        process.exit(0);
      } else {
        process.exit(1);
      }
    });
  }
  
  async safeRespond(response) {
    try {
      if (!this.isClientConnected()) {
        console.error('[MCP] Cannot send response - client disconnected');
        return null;
      }
      return response;
    } catch (error) {
      if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
        console.error('[MCP] Client disconnected while sending response');
        return null;
      }
      throw error;
    }
  }

  async run() {
    const transport = new StdioServerTransport();

    // Add error handling for transport
    transport.onError = (error) => {
      if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
        console.error('[MCP] Client disconnected');
        process.exit(0); // Clean exit
      } else {
        console.error('[MCP] Transport error:', error);
      }
    };
    
    // Handle process signals gracefully
    process.on('SIGINT', () => {
      console.error('[MCP] Received SIGINT, shutting down gracefully...');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.error('[MCP] Received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      if (error.code === 'EPIPE') {
        console.error('[MCP] Broken pipe - client disconnected');
        process.exit(0);
      } else {
        console.error('[MCP] Uncaught exception:', error);
        process.exit(1);
      }
    });
	
    await this.server.connect(transport);
	
    // Print version and configuration details
    console.error('='.repeat(60));
    console.error('ChatBot Assistant MCP Server');
    console.error('='.repeat(60));
    console.error(`Version: 3.0.0`);
    console.error(`Name: Chatbot Assistant`);
    console.error(`Started: ${new Date().toISOString()}`);
    console.error(`Node Version: ${process.version}`);
    console.error('='.repeat(60));
    
    // Print configuration status
	console.error('Configuration:');
	console.error(`  Source Directory: ${process.env.DEFAULT_SOURCE_DIR || 'Not configured'}`);
	console.error(`  Docs Directory: ${process.env.DEFAULT_DOCS_DIR || 'Not configured'}`);
	console.error(`  Debug Mode: ${process.env.DEBUG === 'true' ? 'Enabled' : 'Disabled'}`);
	console.error(`  Table Validation: ${this.tableValidationEnabled ? 'Enabled' : 'Disabled'}`);
	
    if (this.tableValidationEnabled && this.tableRegistry.tables.size > 0) {
      console.error(`  Tables Found: ${this.tableRegistry.tables.size}`);
      console.error(`  Auto-refresh: ${this.tableRegistry.refreshInterval > 0 ? `Every ${this.tableRegistry.refreshInterval/60000} minutes` : 'Disabled'}`);
    }
	
    console.error('='.repeat(60));
    
    console.error('ChatBot Assistant MCP Server started successfully and ready to accept requests.');
  }
}

// Start the server
const server = new EnhancedChatbotAssistantServer();
server.run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});