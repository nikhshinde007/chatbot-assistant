// tableRegistry.js - New module for table name validation and registry
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class TableRegistry {
  constructor() {
    this.tables = new Map(); // Map of table name -> metadata
    this.schemas = new Map(); // Map of schema -> tables
    this.lastRefresh = null;
    this.refreshInterval = 300000; // 5 minutes default
    this.autoRefreshTimer = null;
    this.tablePatterns = {
      // SQL DDL patterns
      createTable: /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi,
      alterTable: /ALTER\s+TABLE\s+[`"]?(\w+)[`"]?/gi,
      dropTable: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi,
      
      // SQL DML patterns
      fromClause: /FROM\s+[`"]?(\w+)[`"]?/gi,
      joinClause: /JOIN\s+[`"]?(\w+)[`"]?/gi,
      intoClause: /INTO\s+[`"]?(\w+)[`"]?/gi,
      updateClause: /UPDATE\s+[`"]?(\w+)[`"]?/gi,
      
      // JPA/Hibernate annotations
      entityAnnotation: /@(?:Entity|Table)\s*\(\s*name\s*=\s*["'](\w+)["']/gi,
      tableAnnotation: /@Table\s*\(\s*name\s*=\s*["'](\w+)["']/gi,
      
      // MyBatis/iBatis
      mybatisTable: /<(?:select|insert|update|delete)[^>]*>.*?(?:FROM|INTO|UPDATE)\s+[`"]?(\w+)[`"]?/gi,
      
      // Migration files
      migrationTable: /(?:create_table|rename_table|drop_table)\s*[:（]?\s*["']?(\w+)["']?/gi,
      
      // Schema files (JSON/YAML)
      schemaDefinition: /"(?:table|tableName|collection)"\s*:\s*["'](\w+)["']/gi,
      
      // Properties/Config files
      tableProperty: /(?:table|entity)\.(\w+)(?:\.|=)/gi,
      datasourceTable: /spring\.jpa\.properties\.hibernate\.default_schema\s*=\s*(\w+)/gi
    };
    
    // Fictional/placeholder table names to reject
    this.fictionalPatterns = [
      /^(table|tbl|test|temp|tmp|sample|example|demo|dummy|foo|bar|placeholder)(_?\d*)?$/i,
      /^(users?|customers?|orders?|products?|items?)$/i, // Too generic without context
      /^[a-z]$/i, // Single letters
      /^(t|tbl|tb)\d+$/i, // t1, tbl2, etc.
      /^(xxx|aaa|bbb|abc|xyz)/i,
      /^(my|your|the)_/i,
      /^untitled/i
    ];
  }

  /**
   * Initialize the registry by scanning source directories
   */
  async initialize(searchDirectories = []) {
    console.error('[TABLE_REGISTRY] Initializing table registry...');
    
    const dirs = searchDirectories.length > 0 ? searchDirectories : this.getDefaultDirectories();
    
    for (const dir of dirs) {
      if (dir && fsSync.existsSync(dir)) {
        await this.scanDirectory(dir);
      }
    }
    
    console.error(`[TABLE_REGISTRY] Found ${this.tables.size} tables`);
    this.lastRefresh = new Date();
    
    // Start auto-refresh if configured
    if (this.refreshInterval > 0) {
      this.startAutoRefresh();
    }
    
    return this.getSummary();
  }

  /**
   * Scan a directory for table definitions
   */
  async scanDirectory(dirPath, depth = 0, maxDepth = 10) {
    if (depth >= maxDepth) return;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          // Skip common non-source directories
          const skipDirs = ['node_modules', '.git', 'target', 'build', 'dist', '.idea', 'vendor'];
          if (!skipDirs.includes(entry.name.toLowerCase())) {
            await this.scanDirectory(fullPath, depth + 1, maxDepth);
          }
        } else if (entry.isFile()) {
          await this.scanFile(fullPath);
        }
      }
    } catch (error) {
      console.error(`[TABLE_REGISTRY] Error scanning directory ${dirPath}:`, error.message);
    }
  }

  /**
   * Scan a file for table definitions
   */
  async scanFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const relevantExtensions = [
      '.sql', '.ddl', '.java', '.js', '.ts', '.py', '.rb', '.php',
      '.xml', '.yaml', '.yml', '.json', '.properties', '.config', '.conf',
      '.migration', '.schema'
    ];
    
    if (!relevantExtensions.includes(ext)) return;
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const tables = this.extractTablesFromContent(content, filePath);
      
      for (const tableName of tables) {
        this.registerTable(tableName, filePath);
      }
    } catch (error) {
      // Silently skip files we can't read
    }
  }

  /**
   * Extract table names from file content
   */
  extractTablesFromContent(content, filePath) {
    const tables = new Set();
    const ext = path.extname(filePath).toLowerCase();
    
    // Select patterns based on file type
    let patterns = [];
    
    if (['.sql', '.ddl'].includes(ext)) {
      patterns = [
        this.tablePatterns.createTable,
        this.tablePatterns.alterTable,
        this.tablePatterns.fromClause,
        this.tablePatterns.joinClause,
        this.tablePatterns.intoClause,
        this.tablePatterns.updateClause
      ];
    } else if (['.java'].includes(ext)) {
      patterns = [
        this.tablePatterns.entityAnnotation,
        this.tablePatterns.tableAnnotation,
        this.tablePatterns.fromClause,
        this.tablePatterns.joinClause
      ];
    } else if (['.xml'].includes(ext)) {
      patterns = [
        this.tablePatterns.mybatisTable,
        this.tablePatterns.fromClause
      ];
    } else if (['.js', '.ts', '.py', '.php', '.rb'].includes(ext)) {
      patterns = [
        this.tablePatterns.fromClause,
        this.tablePatterns.joinClause,
        this.tablePatterns.intoClause,
        this.tablePatterns.updateClause,
        this.tablePatterns.migrationTable
      ];
    } else if (['.yaml', '.yml', '.json'].includes(ext)) {
      patterns = [this.tablePatterns.schemaDefinition];
    } else if (['.properties', '.config', '.conf'].includes(ext)) {
      patterns = [
        this.tablePatterns.tableProperty,
        this.tablePatterns.datasourceTable
      ];
    }
    
    // Apply patterns
    for (const pattern of patterns) {
      pattern.lastIndex = 0; // Reset regex
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1]) {
          const tableName = this.normalizeTableName(match[1]);
          if (this.isValidTableName(tableName)) {
            tables.add(tableName);
          }
        }
      }
    }
    
    return Array.from(tables);
  }

  /**
   * Normalize table name (handle different cases and prefixes)
   */
  normalizeTableName(name) {
    // Remove common prefixes
    let normalized = name.replace(/^(tbl_|table_|tb_)/i, '');
    
    // Convert to lowercase for consistency
    normalized = normalized.toLowerCase();
    
    // Handle schema.table notation
    if (normalized.includes('.')) {
      const parts = normalized.split('.');
      return parts[parts.length - 1];
    }
    
    return normalized;
  }

  /**
   * Check if a table name is valid (not fictional)
   */
  isValidTableName(name) {
    if (!name || name.length < 2) return false;
    
    // Check against fictional patterns
    for (const pattern of this.fictionalPatterns) {
      if (pattern.test(name)) {
        return false;
      }
    }
    
    // Additional checks
    if (name.length > 64) return false; // Too long for most databases
    if (!/^[a-zA-Z]/.test(name)) return false; // Should start with letter
    if (/[^a-zA-Z0-9_]/.test(name)) return false; // Invalid characters
    
    return true;
  }

  /**
   * Register a table in the registry
   */
  registerTable(tableName, source) {
    const normalized = this.normalizeTableName(tableName);
    
    if (!this.tables.has(normalized)) {
      this.tables.set(normalized, {
        name: normalized,
        originalNames: new Set([tableName]),
        sources: new Set([source]),
        firstSeen: new Date(),
        lastSeen: new Date()
      });
    } else {
      const entry = this.tables.get(normalized);
      entry.originalNames.add(tableName);
      entry.sources.add(source);
      entry.lastSeen = new Date();
    }
  }

  /**
   * Validate if a table name exists in the registry
   */
  validateTableName(tableName) {
    const normalized = this.normalizeTableName(tableName);
    
    // Check if it's a fictional name first
    for (const pattern of this.fictionalPatterns) {
      if (pattern.test(normalized)) {
        return {
          valid: false,
          reason: 'fictional',
          message: `"${tableName}" appears to be a fictional/placeholder table name. Please use actual table names from the source code.`,
          suggestions: this.getSuggestions(normalized)
        };
      }
    }
    
    // Check if it exists in registry
    if (!this.tables.has(normalized)) {
      return {
        valid: false,
        reason: 'not_found',
        message: `Table "${tableName}" not found in source code. Available tables: ${this.getTableList().slice(0, 5).join(', ')}...`,
        suggestions: this.getSuggestions(normalized)
      };
    }
    
    return {
      valid: true,
      metadata: this.tables.get(normalized)
    };
  }

  /**
   * Validate all table names in a text/query
   */
  validateTextForTables(text) {
    const issues = [];
    const validTables = [];
    
    // Extract potential table names from text
    const patterns = [
      this.tablePatterns.fromClause,
      this.tablePatterns.joinClause,
      this.tablePatterns.intoClause,
      this.tablePatterns.updateClause
    ];
    
    const foundTables = new Set();
    
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match[1]) {
          foundTables.add(match[1]);
        }
      }
    }
    
    // Validate each found table
    for (const table of foundTables) {
      const validation = this.validateTableName(table);
      if (!validation.valid) {
        issues.push({
          table,
          ...validation
        });
      } else {
        validTables.push({
          table,
          metadata: validation.metadata
        });
      }
    }
    
    return {
      valid: issues.length === 0,
      issues,
      validTables,
      summary: issues.length > 0 
        ? `Found ${issues.length} invalid table reference(s)`
        : 'All table references are valid'
    };
  }

  /**
   * Get suggestions for similar table names
   */
  getSuggestions(tableName, maxSuggestions = 3) {
    const normalized = this.normalizeTableName(tableName);
    const suggestions = [];
    
    // Use Levenshtein distance for similarity
    const distances = [];
    
    for (const [name, metadata] of this.tables) {
      const distance = this.levenshteinDistance(normalized, name);
      distances.push({ name, distance, sources: metadata.sources.size });
    }
    
    // Sort by distance and popularity (number of sources)
    distances.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.sources - a.sources;
    });
    
    // Get top suggestions
    for (let i = 0; i < Math.min(maxSuggestions, distances.length); i++) {
      if (distances[i].distance <= 5) { // Reasonable threshold
        suggestions.push(distances[i].name);
      }
    }
    
    return suggestions;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(a, b) {
    const matrix = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }

  /**
   * Get list of all valid table names
   */
  getTableList() {
    return Array.from(this.tables.keys()).sort();
  }

  /**
   * Get detailed registry summary
   */
  getSummary() {
    return {
      totalTables: this.tables.size,
      tables: this.getTableList(),
      lastRefresh: this.lastRefresh,
      schemas: Array.from(this.schemas.keys()),
      sources: this.getSourcesSummary()
    };
  }

  /**
   * Get summary of sources
   */
  getSourcesSummary() {
    const sources = new Map();
    
    for (const [name, metadata] of this.tables) {
      for (const source of metadata.sources) {
        const ext = path.extname(source).toLowerCase();
        sources.set(ext, (sources.get(ext) || 0) + 1);
      }
    }
    
    return Object.fromEntries(sources);
  }

  /**
   * Refresh the registry
   */
  async refresh(directories = []) {
    console.error('[TABLE_REGISTRY] Refreshing table registry...');
    this.tables.clear();
    this.schemas.clear();
    return await this.initialize(directories);
  }

  /**
   * Start auto-refresh timer
   */
  startAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
    }
    
    this.autoRefreshTimer = setInterval(async () => {
      await this.refresh();
    }, this.refreshInterval);
  }

  /**
   * Stop auto-refresh timer
   */
  stopAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  /**
   * Get default directories from environment
   */
  getDefaultDirectories() {
    return [
      process.env.DEFAULT_SOURCE_DIR,
      process.env.DEFAULT_DOCS_DIR
    ].filter(Boolean);
  }

  /**
   * Create instructions for AI agents
   */
  getAIAgentInstructions() {
    const tables = this.getTableList();
    
    return {
      systemPrompt: `IMPORTANT: Database Table Name Requirements
      
You MUST only use actual table names from the source code. The following ${tables.length} tables are available in the system:

${tables.slice(0, 50).join(', ')}${tables.length > 50 ? `, and ${tables.length - 50} more...` : ''}

STRICT RULES:
1. NEVER use fictional, placeholder, or generic table names like "table1", "users", "products", etc.
2. ONLY reference tables from the list above
3. If you need to reference a table but aren't sure of the exact name, ask for clarification
4. All SQL queries and database references must use these actual table names
5. Table names are case-insensitive but should match the source code conventions

If you attempt to use a non-existent table name, your response will be rejected.`,
      
      validationContext: {
        availableTables: tables,
        totalCount: tables.length,
        lastUpdated: this.lastRefresh,
        strictMode: true
      },
      
      examples: {
        correct: tables.slice(0, 3).map(t => `SELECT * FROM ${t}`),
        incorrect: [
          'SELECT * FROM users -- WRONG: generic placeholder',
          'SELECT * FROM table1 -- WRONG: fictional name',
          'SELECT * FROM my_table -- WRONG: not in source code'
        ]
      }
    };
  }
}

/*
 * Initialize registry from environment configuration
 */
async function initializeFromConfig() {
  const config = require('../config/config');
  const registry = new TableRegistry();
  
  const searchDirs = config.files.allowedPaths.filter(Boolean);
  if (searchDirs.length > 0) {
    await registry.initialize(searchDirs);
    return registry;
  }
  
  console.warn('[TABLE_REGISTRY] No search directories configured');
  return registry;
}

module.exports = { TableRegistry,
                   initializeFromConfig
};