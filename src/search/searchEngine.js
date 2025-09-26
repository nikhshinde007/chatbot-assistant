const fs = require('fs');
const path = require('path');
const config = require('../config/config');

/**
 * Robust recursive file search with extensive logging and error handling
 */
class RobustSearchEngine {
  constructor() {
    this.debugMode = process.env.DEBUG === 'true' || config.logging.level === 'debug';
    this.maxFileSize = config.files.maxFileSize;
    this.maxDepth = config.search.maxDepth;
    this.processedFiles = 0;
    this.skippedFiles = 0;
    this.errors = [];
    this.allowedPaths = config.files.allowedPaths;
  }

  log(message, data = null) {
    if (this.debugMode) {
      console.log(`[SEARCH] ${message}`, data || '');
    }
  }

  error(message, error = null) {
    const errorMsg = `[SEARCH ERROR] ${message}${error ? ': ' + error.message : ''}`;
    console.error(errorMsg);
    this.errors.push(errorMsg);
  }

  /**
   * Get all files recursively with robust error handling
   */
  getAllFilesSync(dirPath, maxDepth = this.maxDepth, currentDepth = 0) {
    const results = [];
	
    try {
		
      // Validate path is in allowed directories
      const isAllowed = this.allowedPaths.some(allowedPath => {
        const resolvedAllowed = path.resolve(allowedPath);
        const resolvedTarget = path.resolve(dirPath);
        return resolvedTarget.startsWith(resolvedAllowed);
      });
      
      if (!isAllowed) {
        this.error(`Directory not in allowed paths: ${dirPath}`);
        return results;
      }
	  
      // Validate directory exists and is accessible
      if (!fs.existsSync(dirPath)) {
        this.error(`Directory does not exist: ${dirPath}`);
        return results;
      }

      const stat = fs.lstatSync(dirPath);
      if (!stat.isDirectory()) {
        this.error(`Path is not a directory: ${dirPath}`);
        return results;
      }

      // Check depth limit
      if (currentDepth >= maxDepth) {
        this.log(`Max depth reached at: ${dirPath}`);
        return results;
      }

      this.log(`Scanning directory (depth ${currentDepth}): ${dirPath}`);

      // Read directory contents
      let entries;
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch (error) {
        this.error(`Cannot read directory: ${dirPath}`, error);
        return results;
      }

      // Skip directories that should be ignored
      const skipDirs = new Set([
        'node_modules', '.git', '.svn', '.hg', 'target', 'build', 'dist', 
        'bin', 'obj', '.vscode', '.idea', '__pycache__', '.gradle', 
        'vendor', 'coverage', '.nyc_output', 'logs', '.next', 'out',
        'tmp', 'temp', '.cache', '.pytest_cache', '.mypy_cache',
        'bower_components', 'jspm_packages', '.meteor', '.sass-cache'
      ]);

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        try {
          if (entry.isDirectory()) {
            // Skip hidden directories and common build/cache directories
            if (entry.name.startsWith('.') && entry.name !== '.') {
              continue;
            }
            
            if (skipDirs.has(entry.name.toLowerCase())) {
              this.log(`Skipping directory: ${entry.name}`);
              continue;
            }

            // Recursively search subdirectory
            const subResults = this.getAllFilesSync(fullPath, maxDepth, currentDepth + 1);
            results.push(...subResults);
            
          } else if (entry.isFile()) {
            // Add file to results
            results.push({
              path: fullPath,
              relativePath: path.relative(dirPath, fullPath),
              name: entry.name,
              extension: path.extname(entry.name).toLowerCase(),
              directory: path.dirname(fullPath)
            });
          }
          // Ignore symbolic links and other special files
          
        } catch (error) {
          this.error(`Error processing entry: ${fullPath}`, error);
          continue;
        }
      }

    } catch (error) {
      this.error(`Fatal error in directory: ${dirPath}`, error);
    }

    return results;
  }

  /**
   * Check if file extension should be searched
   */
  shouldSearchFile(extension, searchType = 'all') {
    const codeExtensions = new Set([
      '.java', '.class', '.jsp', '.jspx', '.properties', '.xml', '.gradle',
      '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '.scss',
      '.py', '.cpp', '.c', '.h', '.hpp', '.cs', '.php', '.rb', '.go',
      '.swift', '.kt', '.scala', '.rs', '.pl', '.r', '.sql', '.sh', '.bat'
    ]);

    const docExtensions = new Set([
      '.md', '.txt', '.rst', '.adoc', '.doc', '.docx', '.pdf', 
      '.rtf', '.tex', '.readme', '.changelog', '.license'
    ]);

    const javaExtensions = new Set([
      '.java', '.jsp', '.jspx', '.properties', '.xml', '.gradle', '.maven'
    ]);

    switch (searchType) {
      case 'java':
        return javaExtensions.has(extension);
      case 'docs':
        return docExtensions.has(extension);
      case 'code':
        return codeExtensions.has(extension);
      default:
        return codeExtensions.has(extension) || docExtensions.has(extension);
    }
  }

  /**
   * Search for text in a single file
   */
  searchInFile(filePath, query, options = {}) {
    const { caseSensitive = false, maxMatches = 10 } = options;
    const results = [];

    try {
      // Check file size
      const stats = fs.statSync(filePath);
      if (stats.size > this.maxFileSize) {
        this.log(`Skipping large file: ${filePath} (${Math.round(stats.size / 1024 / 1024)}MB)`);
        this.skippedFiles++;
        return results;
      }

      // Read file content
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (error) {
        // Try with latin1 encoding for binary files
        try {
          content = fs.readFileSync(filePath, 'latin1');
        } catch (error2) {
          this.error(`Cannot read file: ${filePath}`, error2);
          return results;
        }
      }

      const searchContent = caseSensitive ? content : content.toLowerCase();
      const searchQuery = caseSensitive ? query : query.toLowerCase();
      const lines = content.split('\n');

      let searchIndex = 0;
      let matchCount = 0;

      while (searchIndex < searchContent.length && matchCount < maxMatches) {
        const matchIndex = searchContent.indexOf(searchQuery, searchIndex);
        if (matchIndex === -1) break;

        // Find line number
        const lineNumber = content.substring(0, matchIndex).split('\n').length;
        
        // Extract context around match
        const contextStart = Math.max(0, lineNumber - 3);
        const contextEnd = Math.min(lines.length, lineNumber + 2);
        const context = lines.slice(contextStart, contextEnd).join('\n');

        results.push({
          file: filePath,
          line: lineNumber,
          column: matchIndex - content.lastIndexOf('\n', matchIndex),
          context: context,
          matchIndex: matchIndex,
          beforeContext: content.substring(Math.max(0, matchIndex - 100), matchIndex),
          afterContext: content.substring(matchIndex + query.length, matchIndex + query.length + 100)
        });

        matchCount++;
        searchIndex = matchIndex + query.length;
      }

      this.processedFiles++;
      if (this.processedFiles % 50 === 0) {
        this.log(`Processed ${this.processedFiles} files so far...`);
      }

    } catch (error) {
      this.error(`Error searching file: ${filePath}`, error);
    }

    return results;
  }

  /**
   * Main search function
   */
  async searchInFiles(query, searchPaths, options = {}) {
    const {
      searchType = 'all',
      caseSensitive = false,
      maxResults = 200,
      maxFiles = 5000
    } = options;

    // Reset counters
    this.processedFiles = 0;
    this.skippedFiles = 0;
    this.errors = [];

    this.log(`Starting search for "${query}"`);
    this.log(`Search paths: ${JSON.stringify(searchPaths)}`);
    this.log(`Search type: ${searchType}`);

    // Normalize search paths to array
    const paths = Array.isArray(searchPaths) ? searchPaths : [searchPaths];
    
    // Get all files from all search paths
    const allFiles = [];
    for (const searchPath of paths) {
      if (!searchPath || !fs.existsSync(searchPath)) {
        this.error(`Invalid search path: ${searchPath}`);
        continue;
      }

      this.log(`Getting files from: ${searchPath}`);
      const files = this.getAllFilesSync(searchPath);
      this.log(`Found ${files.length} files in ${searchPath}`);
      allFiles.push(...files);
    }

    this.log(`Total files found: ${allFiles.length}`);

    // Filter files by extension and search type
    const filesToSearch = allFiles.filter(file => {
      return this.shouldSearchFile(file.extension, searchType);
    });

    this.log(`Files to search after filtering: ${filesToSearch.length}`);

    if (filesToSearch.length === 0) {
      return {
        query,
        searchPaths: paths,
        results: [],
        summary: {
          totalFiles: allFiles.length,
          searchedFiles: 0,
          processedFiles: 0,
          skippedFiles: 0,
          errors: this.errors,
          message: 'No files found matching the search criteria'
        }
      };
    }

    // Limit number of files to search
    const limitedFiles = filesToSearch.slice(0, maxFiles);
    if (limitedFiles.length < filesToSearch.length) {
      this.log(`Limited search to ${maxFiles} files (${filesToSearch.length} total)`);
    }

    // Search each file
    const allResults = [];
    for (const file of limitedFiles) {
      if (allResults.length >= maxResults) {
        this.log(`Reached maximum results limit: ${maxResults}`);
        break;
      }

      const fileResults = this.searchInFile(file.path, query, { caseSensitive });
      for (const result of fileResults) {
        result.relativePath = file.relativePath;
        result.fileName = file.name;
        result.extension = file.extension;
      }
      allResults.push(...fileResults);
    }

    this.log(`Search complete. Found ${allResults.length} matches.`);

    return {
      query,
      searchPaths: paths,
      searchType,
      results: allResults.slice(0, maxResults),
      summary: {
        totalFiles: allFiles.length,
        searchedFiles: limitedFiles.length,
        processedFiles: this.processedFiles,
        skippedFiles: this.skippedFiles,
        matchCount: allResults.length,
        errors: this.errors
      }
    };
  }

  /**
   * Get directory statistics
   */
  async getDirectoryStats(dirPaths) {
    const paths = Array.isArray(dirPaths) ? dirPaths : [dirPaths];
    const stats = {
      directories: [],
      totalFiles: 0,
      filesByExtension: {},
      filesByType: { code: 0, docs: 0, other: 0 },
      errors: []
    };

    for (const dirPath of paths) {
      if (!dirPath || !fs.existsSync(dirPath)) {
        stats.errors.push(`Invalid directory: ${dirPath}`);
        continue;
      }

      this.log(`Analyzing directory: ${dirPath}`);
      const files = this.getAllFilesSync(dirPath);
      
      const dirStats = {
        path: dirPath,
        fileCount: files.length,
        extensions: {},
        types: { code: 0, docs: 0, other: 0 }
      };

      for (const file of files) {
        const ext = file.extension || 'no-extension';
        
        // Count by extension
        dirStats.extensions[ext] = (dirStats.extensions[ext] || 0) + 1;
        stats.filesByExtension[ext] = (stats.filesByExtension[ext] || 0) + 1;
        
        // Count by type
        if (this.shouldSearchFile(ext, 'code')) {
          dirStats.types.code++;
          stats.filesByType.code++;
        } else if (this.shouldSearchFile(ext, 'docs')) {
          dirStats.types.docs++;
          stats.filesByType.docs++;
        } else {
          dirStats.types.other++;
          stats.filesByType.other++;
        }
      }

      stats.directories.push(dirStats);
      stats.totalFiles += files.length;
    }

    return stats;
  }
}

// Create singleton instance
const searchEngine = new RobustSearchEngine();

// Export functions
module.exports = {
  searchInFiles: async (query, dir, options = {}) => {
    return await searchEngine.searchInFiles(query, dir, options);
  },
  
  searchJavaFiles: async (query, dir) => {
    return await searchEngine.searchInFiles(query, dir, { searchType: 'java' });
  },
  
  searchDocumentationFiles: async (query, dir) => {
    return await searchEngine.searchInFiles(query, dir, { searchType: 'docs' });
  },
  
  getDirectoryStats: async (dir) => {
    return await searchEngine.getDirectoryStats(dir);
  },
  
  getAllFiles: (dir) => {
    return searchEngine.getAllFilesSync(dir);
  },

  // New function to search both source and docs directories
  searchAllDirectories: async (query, options = {}) => {
    const searchPaths = [];
    
    if (process.env.DEFAULT_SOURCE_DIR) {
      searchPaths.push(process.env.DEFAULT_SOURCE_DIR);
    }
    
    if (process.env.DEFAULT_DOCS_DIR && process.env.DEFAULT_DOCS_DIR !== process.env.DEFAULT_SOURCE_DIR) {
      searchPaths.push(process.env.DEFAULT_DOCS_DIR);
    }
    
    if (searchPaths.length === 0) {
      throw new Error('No search directories configured. Set DEFAULT_SOURCE_DIR and/or DEFAULT_DOCS_DIR');
    }
    
    return await searchEngine.searchInFiles(query, searchPaths, options);
  },

  // Test function to verify setup
  testSearchSetup: async () => {
    const results = {
      timestamp: new Date().toISOString(),
      sourceDir: process.env.DEFAULT_SOURCE_DIR,
      docsDir: process.env.DEFAULT_DOCS_DIR,
      tests: {}
    };

    // Test directory access
    const dirsToTest = [process.env.DEFAULT_SOURCE_DIR, process.env.DEFAULT_DOCS_DIR].filter(Boolean);
    
    for (const dir of dirsToTest) {
      const dirName = dir === process.env.DEFAULT_SOURCE_DIR ? 'DEFAULT_SOURCE_DIR' : 'DEFAULT_DOCS_DIR';
      
      try {
        const stats = await searchEngine.getDirectoryStats(dir);
        results.tests[dirName] = {
          accessible: true,
          totalFiles: stats.totalFiles,
          javaFiles: stats.filesByExtension['.java'] || 0,
          docFiles: (stats.filesByExtension['.md'] || 0) + (stats.filesByExtension['.txt'] || 0),
          directories: stats.directories.length
        };
        
        // Test search for common patterns
        if (stats.filesByExtension['.java'] > 0) {
          const javaResults = await searchEngine.searchInFiles('public class', dir, { searchType: 'java', maxResults: 5 });
          results.tests[dirName].javaSearchTest = {
            query: 'public class',
            matches: javaResults.results.length,
            sampleFiles: javaResults.results.slice(0, 3).map(r => r.relativePath)
          };
        }
        
      } catch (error) {
        results.tests[dirName] = {
          accessible: false,
          error: error.message
        };
      }
    }

    return results;
  }
};