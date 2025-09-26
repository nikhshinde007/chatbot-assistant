// api-server.js
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import your modules
const { 
  searchInFiles, 
  searchJavaFiles, 
  searchDocumentationFiles, 
  getDirectoryStats, 
  searchAllDirectories,
  testSearchSetup 
} = require('./core/searchEngine');
const { analyzeSnippet } = require('./llm/issueFinder');
const { scanForPitfalls } = require('./llm/proactiveAlerts');
const { runLinter } = require('./llm/linter');
const { analyzeDependencies } = require('./llm/dependencyChecker');
const { searchKnowledgeBase } = require('./llm/kbSearch');
const { getWorkflowFor } = require('./llm/workflowManager');
const { generateCallGraph } = require('./llm/graphGenerator');
const { translate } = require('./llm/translator');
const { analyzeRootCause } = require('./llm/rootCauseAnalyzer');
const { suggestFix } = require('./llm/fixSuggester');
const { extractLogSummary } = require('./core/logParser');

const app = express();
const PORT = process.env.PORT || 3100;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    config: {
      defaultSourceDir: process.env.DEFAULT_SOURCE_DIR || 'not set',
      defaultDocsDir: process.env.DEFAULT_DOCS_DIR || 'not set',
      apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3100'
    }
  });

// Search all configured directories
app.post('/search-all', async (req, res) => {
  try {
    const { query, type = 'all', options = {} } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        error: 'Missing required parameter: query' 
      });
    }

    console.log(`Searching all directories for "${query}" (type: ${type})`);
    const results = await searchAllDirectories(query, { searchType: type, ...options });
    
    res.json(results);
  } catch (error) {
    console.error('Search all error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'search_all_error'
    });
  }

// Directory stats endpoint - enhanced
app.get('/directory-stats', async (req, res) => {
  try {
    const { dir } = req.query;
    let targetDirs;
    
    if (dir) {
      targetDirs = dir;
    } else {
      // Analyze both default directories
      targetDirs = [process.env.DEFAULT_SOURCE_DIR, process.env.DEFAULT_DOCS_DIR].filter(Boolean);
      if (targetDirs.length === 0) {
        return res.status(400).json({ 
          error: 'No directory specified and no default directories set' 
        });
      }
    }

    console.log(`Getting directory stats for:`, targetDirs);
    const stats = await getDirectoryStats(targetDirs);
    
    res.json({
      directories: targetDirs,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Directory stats error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'directory_stats_error'
    });
  }
});

// Test search endpoint - uses new test function
app.get('/test-search', async (req, res) => {
  try {
    console.log('Running comprehensive search test...');
    const testResults = await testSearchSetup();
    res.json(testResults);
  } catch (error) {
    console.error('Test search error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'test_search_error'
    });
  }
});

// Search endpoint - enhanced with robust search
app.post('/search', async (req, res) => {
  try {
    const { query, dir, lang, type = 'all', searchBoth = false, options = {} } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        error: 'Missing required parameter: query' 
      });
    }

    console.log(`Searching for "${query}" (type: ${type}, searchBoth: ${searchBoth})`);
    
    let results;
    
    if (searchBoth) {
      // Search in both DEFAULT_SOURCE_DIR and DEFAULT_DOCS_DIR
      results = await searchAllDirectories(query, { searchType: type, ...options });
    } else {
      // Use provided dir or fall back to DEFAULT_SOURCE_DIR
      const searchDir = dir || process.env.DEFAULT_SOURCE_DIR;
      
      if (!searchDir) {
        return res.status(400).json({ 
          error: 'No directory specified and DEFAULT_SOURCE_DIR not set' 
        });
      }

      console.log(`Searching in directory: ${searchDir}`);
      
      switch (type) {
        case 'java':
          results = await searchJavaFiles(query, searchDir);
          break;
        case 'docs':
          results = await searchDocumentationFiles(query, searchDir);
          break;
        default:
          results = await searchInFiles(query, searchDir, { searchType: type, ...options });
      }
    }
    
    // Optionally translate results if language is specified
    if (lang && lang !== 'en' && results.results) {
      console.log(`Translating ${results.results.length} results to ${lang}`);
      for (let result of results.results) {
        if (result.context) {
          result.context = await translate(result.context, lang);
        }
      }
    }
    
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'search_error'
    });
  }
});

// Analyze log endpoint
app.post('/analyze-log', async (req, res) => {
  try {
    const { log, code = '', doc = '' } = req.body;
    
    if (!log) {
      return res.status(400).json({ 
        error: 'Missing required parameter: log' 
      });
    }

    console.log('Analyzing log...');
    
    // Extract log summary
    const logSummary = extractLogSummary(log);
    
    // Get root cause analysis
    const rootCause = await analyzeRootCause({ code, log, doc });
    
    // Get fix suggestions
    const fixSuggestions = await suggestFix({ code, log, doc });
    
    res.json({
      logSummary,
      rootCause,
      fixSuggestions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Log analysis error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'log_analysis_error'
    });
  }
});

// Scan for pitfalls endpoint
app.post('/scan-pitfalls', async (req, res) => {
  try {
    const { files } = req.body;
    
    if (!files || !Array.isArray(files)) {
      return res.status(400).json({ 
        error: 'Missing required parameter: files (array)' 
      });
    }

    console.log(`Scanning ${files.length} files for pitfalls...`);
    const warnings = await scanForPitfalls(files);
    
    res.json({
      filesScanned: files.length,
      warnings,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Pitfall scan error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'pitfall_scan_error'
    });
  }
});

// Lint code endpoint
app.post('/lint', async (req, res) => {
  try {
    const { filePath, lang } = req.body;
    
    if (!lang) {
      return res.status(400).json({ 
        error: 'Missing required parameter: lang' 
      });
    }

    // Use provided filePath or construct from DEFAULT_SOURCE_DIR
    let targetFilePath = filePath;
    if (!targetFilePath && process.env.DEFAULT_SOURCE_DIR) {
      return res.status(400).json({ 
        error: 'No filePath specified and cannot construct from DEFAULT_SOURCE_DIR without filename' 
      });
    } else if (!targetFilePath) {
      return res.status(400).json({ 
        error: 'Missing required parameter: filePath and DEFAULT_SOURCE_DIR not set' 
      });
    }

    console.log(`Linting ${targetFilePath} (${lang})...`);
    const lintResults = await runLinter(targetFilePath, lang);
    
    res.json({
      filePath: targetFilePath,
      language: lang,
      results: lintResults,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Linting error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'linting_error'
    });
  }
});

// Analyze dependencies endpoint
app.post('/deps', async (req, res) => {
  try {
    const { filePath } = req.body;
    
    // Use provided filePath or look for common dependency files in DEFAULT_SOURCE_DIR
    let targetFilePath = filePath;
    if (!targetFilePath && process.env.DEFAULT_SOURCE_DIR) {
      // Try common dependency file names
      const commonDepFiles = ['package.json', 'requirements.txt', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json'];
      const path = require('path');
      const fs = require('fs');
      
      for (const depFile of commonDepFiles) {
        const testPath = path.join(process.env.DEFAULT_SOURCE_DIR, depFile);
        if (fs.existsSync(testPath)) {
          targetFilePath = testPath;
          break;
        }
      }
    }
    
    if (!targetFilePath) {
      return res.status(400).json({ 
        error: 'No dependency file found. Specify filePath or ensure DEFAULT_SOURCE_DIR contains package.json, requirements.txt, etc.' 
      });
    }

    console.log(`Analyzing dependencies in ${targetFilePath}...`);
    const analysis = await analyzeDependencies(targetFilePath);
    
    res.json({
      filePath: targetFilePath,
      analysis,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Dependency analysis error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'dependency_analysis_error'
    });
  }
});

// Knowledge base search endpoint
app.post('/kb', async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ 
        error: 'Missing required parameter: query' 
      });
    }

    console.log(`Searching knowledge base for: ${query}`);
    const results = await searchKnowledgeBase(query);
    
    res.json({
      query,
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('KB search error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'kb_search_error'
    });
  }
});

// Workflow endpoint
app.post('/workflow', async (req, res) => {
  try {
    const { errorType, context = '' } = req.body;
    
    if (!errorType) {
      return res.status(400).json({ 
        error: 'Missing required parameter: errorType' 
      });
    }

    console.log(`Getting workflow for error type: ${errorType}`);
    const workflow = await getWorkflowFor(errorType, JSON.stringify(context));
    
    res.json({
      errorType,
      context,
      workflow,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Workflow error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'workflow_error'
    });
  }
});

// Visualize code endpoint
app.post('/visualize', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ 
        error: 'Missing required parameter: code' 
      });
    }

    console.log('Generating code visualization...');
    const mermaidGraph = await generateCallGraph(code);
    
    res.json({
      mermaidGraph,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Visualization error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'visualization_error'
    });
  }
});

// Translate endpoint
app.post('/translate', async (req, res) => {
  try {
    const { text, lang } = req.body;
    
    if (!text || !lang) {
      return res.status(400).json({ 
        error: 'Missing required parameters: text and lang' 
      });
    }

    console.log(`Translating text to ${lang}...`);
    const translation = await translate(text, lang);
    
    res.json({
      originalText: text,
      targetLanguage: lang,
      translation,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ 
      error: error.message,
      type: 'translation_error'
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Chatbot Assistant API Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log('Available endpoints:');
  console.log('  POST /search - Search code files');
  console.log('  POST /analyze-log - Analyze error logs');
  console.log('  POST /scan-pitfalls - Scan for code issues');
  console.log('  POST /lint - Lint code files');
  console.log('  POST /deps - Analyze dependencies');
  console.log('  POST /kb - Search knowledge base');
  console.log('  POST /workflow - Get troubleshooting workflows');
  console.log('  POST /visualize - Generate code visualizations');
  console.log('  POST /translate - Translate text');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down Chatbot Assistant API Server...');
  process.exit(0);
});

module.exports = app;