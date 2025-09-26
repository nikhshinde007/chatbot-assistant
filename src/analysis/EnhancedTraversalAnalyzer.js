const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { CodeTraversalEngine } = require('./codeTraversalEngine');
const { TraversalCache } = require('../utils/cache');

// Enhanced Traversal Analyzer Class
class EnhancedTraversalAnalyzer {
  constructor(searchEngine) {
    this.searchEngine = searchEngine;
    this.debugMode = process.env.DEBUG === 'true';
    this.maxTraversalDepth = 10;
    this.visitedFiles = new Set();
    this.dependencyGraph = new Map();
    this.configurationSources = new Map();
    this.queryPatterns = {
      // SQL query patterns
      select: /SELECT\s+.*?\s+FROM\s+(\w+)/gi,
      insert: /INSERT\s+INTO\s+(\w+)/gi,
      update: /UPDATE\s+(\w+)/gi,
      jdbcQuery: /jdbcTemplate\.(query|queryForObject|queryForList|update)\s*\([^)]*\)/gi,
      namedQuery: /namedParameterJdbcTemplate\.(query|queryForObject|update)\s*\([^)]*\)/gi,
      
      // Configuration and constants
      configAccess: /ConfigStore\.\w+/g,
      constantDef: /(?:const|final|static)\s+\w+\s*=\s*[^;]+/gi,
      enumDef: /enum\s+\w+\s*\{[^}]+\}/gi,
      
      // Array/List population patterns
      arrayInit: /(?:new\s+\w+\[\]|Arrays\.asList|List\.of|ArrayList|HashMap|Map\.of)/gi,
      arrayAdd: /(\w+)\.(add|put|push|addAll|putAll)\s*\([^)]+\)/gi,
      mapGet: /(\w+)\.get\s*\([^)]+\)/gi,
      
      // Property/Environment patterns
      envVar: /process\.env\.\w+|System\.getenv\([^)]+\)/gi,
      propertyFile: /\.properties|\.yml|\.yaml|\.json|\.xml/i,
      
      // Method calls and dependencies
      methodCall: /(\w+)\s*\.\s*(\w+)\s*\(/g,
      importStatement: /(?:import|require)\s+[^;]+/gi,
      classRef: /(?:extends|implements)\s+(\w+)/gi
    };
  }

  log(message, data = null) {
    if (this.debugMode) {
      // FIXED: Use console.error instead of console.log for MCP server logging
      console.error(`[TRAVERSAL] ${message}`, data ? JSON.stringify(data, null, 2) : '');
    }
  }

  /**
   * Analyze code with enhanced traversal to trace dependencies and data sources
   */
  async analyzeWithTraversal(snippet, file, searchDirectory, extraContext) {
    this.visitedFiles.clear();
    this.dependencyGraph.clear();
    this.configurationSources.clear();
    
    const analysis = {
      primaryFile: file,
      snippet: snippet,
      dependencies: [],
      dataSourceAnalysis: {
        arrays: [],
        constants: [],
        queries: [],
        configurations: [],
        externalSources: []
      },
      traversalPath: [],
      recommendations: []
    };

    try {
      // Step 1: Analyze the snippet for immediate issues and references
      const immediateAnalysis = await this.analyzeSnippet(snippet, file, extraContext);
      analysis.immediateIssue = immediateAnalysis;
      
      // Step 2: Extract identifiers and references from the snippet
      const references = this.extractReferences(snippet);
      analysis.references = references;
      
      // Step 3: Perform deep traversal to find data sources
      if (searchDirectory) {
        await this.performDeepTraversal(
          file,
          searchDirectory,
          references,
          analysis,
          0
        );
      }
      
      // Step 4: Analyze query patterns and data population
      analysis.dataSourceAnalysis = await this.analyzeDataSources(
        snippet,
        analysis.dependencies,
        searchDirectory
      );
      
      // Step 5: Generate recommendations based on findings
      analysis.recommendations = this.generateRecommendations(analysis);
      
      return analysis;
      
    } catch (error) {
      this.log('Error in traversal analysis', error);
      analysis.error = error.message;
      return analysis;
    }
  }

  /**
   * Extract all identifiers and references from code snippet
   */
  extractReferences(snippet) {
    const references = {
      variables: new Set(),
      methods: new Set(),
      classes: new Set(),
      tables: new Set(),
      constants: new Set(),
      configurations: new Set()
    };

    // Extract variable names
    const varMatches = snippet.match(/\b([A-Z_]+|[a-z][a-zA-Z0-9]*)\b/g) || [];
    varMatches.forEach(v => {
      if (v === v.toUpperCase() && v.length > 2) {
        references.constants.add(v);
      } else {
        references.variables.add(v);
      }
    });

    // Extract method calls
    const methodMatches = [...snippet.matchAll(this.queryPatterns.methodCall)];
    methodMatches.forEach(match => {
      references.methods.add(match[2]);
      references.classes.add(match[1]);
    });

    // Extract SQL table names
    const tableMatches = [
      ...snippet.matchAll(this.queryPatterns.select),
      ...snippet.matchAll(this.queryPatterns.insert),
      ...snippet.matchAll(this.queryPatterns.update)
    ];
    tableMatches.forEach(match => {
      if (match[1]) references.tables.add(match[1].toUpperCase());
    });

    // Extract ConfigStore references
    const configMatches = snippet.match(this.queryPatterns.configAccess) || [];
    configMatches.forEach(config => {
      references.configurations.add(config);
    });

    return references;
  }

  /**
   * Perform deep traversal through dependencies
   */
  async performDeepTraversal(currentFile, searchDir, references, analysis, depth) {
    if (depth >= this.maxTraversalDepth || this.visitedFiles.has(currentFile)) {
      return;
    }
    
    this.visitedFiles.add(currentFile);
    analysis.traversalPath.push({ file: currentFile, depth });

    // Search for each type of reference
    for (const variable of references.variables) {
      await this.traceVariableSource(variable, searchDir, analysis);
    }

    for (const constant of references.constants) {
      await this.traceConstantDefinition(constant, searchDir, analysis);
    }

    for (const config of references.configurations) {
      await this.traceConfigurationSource(config, searchDir, analysis);
    }

    for (const table of references.tables) {
      await this.traceDatabaseSchema(table, searchDir, analysis);
    }
  }

  /**
   * Trace where a variable gets its data
   */
  async traceVariableSource(variable, searchDir, analysis) {
    const patterns = [
      `${variable}\\s*=\\s*`, // Assignment
      `${variable}\\.add`, // List population
      `${variable}\\.put`, // Map population
      `populate.*${variable}`, // Population methods
      `load.*${variable}`, // Loading methods
      `init.*${variable}`, // Initialization methods
      `set${variable}`, // Setter methods
      `${variable}\\s*=.*query`, // Query assignment
      `${variable}\\s*=.*SELECT` // Direct SQL assignment
    ];

    for (const pattern of patterns) {
      const results = await this.searchEngine.smartSearch(
        pattern,
        [searchDir],
        { fileTypes: ['java', 'javascript'], maxResults: 10 }
      );

      if (results.results && results.results.length > 0) {
        analysis.dependencies.push({
          type: 'variable_source',
          name: variable,
          pattern: pattern,
          sources: results.results.map(r => ({
            file: r.file,
            line: r.line,
            context: r.context
          }))
        });
      }
    }
  }

  /**
   * Trace constant definitions
   */
  async traceConstantDefinition(constant, searchDir, analysis) {
    const patterns = [
      `static.*final.*${constant}`,
      `const.*${constant}`,
      `public.*static.*${constant}`,
      `${constant}\\s*=\\s*["\']`, // String constant
      `${constant}\\s*=\\s*\\d+`, // Numeric constant
      `enum.*\\{[^}]*${constant}` // Enum value
    ];

    for (const pattern of patterns) {
      const results = await this.searchEngine.smartSearch(
        pattern,
        [searchDir],
        { fileTypes: ['java', 'javascript', 'config'], maxResults: 5 }
      );

      if (results.results && results.results.length > 0) {
        analysis.dependencies.push({
          type: 'constant_definition',
          name: constant,
          pattern: pattern,
          sources: results.results.map(r => ({
            file: r.file,
            line: r.line,
            context: r.context,
            value: this.extractConstantValue(r.context, constant)
          }))
        });
      }
    }
  }

  /**
   * Trace configuration sources (ConfigStore, properties, etc.)
   */
  async traceConfigurationSource(config, searchDir, analysis) {
    const configName = config.replace('ConfigStore.', '');
    
    // Search for where this configuration is populated
    const patterns = [
      `${configName}.*populate`,
      `${configName}.*put`,
      `${configName}.*add`,
      `SELECT.*INTO.*${configName}`,
      `${configName}.*=.*query`,
      `load.*${configName}`,
      `init.*${configName}`
    ];

    for (const pattern of patterns) {
      const results = await this.searchEngine.smartSearch(
        pattern,
        [searchDir],
        { fileTypes: ['java', 'javascript'], maxResults: 10 }
      );

      if (results.results && results.results.length > 0) {
        // Also search for the SQL queries that populate this config
        for (const result of results.results) {
          const sqlPattern = this.extractSQLFromContext(result.context);
          if (sqlPattern) {
            analysis.dependencies.push({
              type: 'configuration_source',
              name: config,
              sqlQuery: sqlPattern,
              source: {
                file: result.file,
                line: result.line,
                context: result.context
              }
            });
          }
        }
      }
    }

    // Search in property files
    const propResults = await this.searchEngine.smartSearch(
      configName,
      [searchDir],
      { fileTypes: ['config'], maxResults: 5 }
    );

    if (propResults.results && propResults.results.length > 0) {
      analysis.dependencies.push({
        type: 'property_file',
        name: config,
        sources: propResults.results.map(r => ({
          file: r.file,
          line: r.line,
          context: r.context
        }))
      });
    }
  }

  /**
   * Trace database schema and related queries
   */
  async traceDatabaseSchema(table, searchDir, analysis) {
    // Search for CREATE TABLE statements
    const schemaPatterns = [
      `CREATE\\s+TABLE\\s+${table}`,
      `ALTER\\s+TABLE\\s+${table}`,
      `${table}.*PRIMARY\\s+KEY`,
      `FOREIGN\\s+KEY.*${table}`
    ];

    for (const pattern of schemaPatterns) {
      const results = await this.searchEngine.smartSearch(
        pattern,
        [searchDir],
        { fileTypes: ['sql', 'java', 'docs'], maxResults: 10 }
      );

      if (results.results && results.results.length > 0) {
        analysis.dependencies.push({
          type: 'database_schema',
          table: table,
          pattern: pattern,
          sources: results.results.map(r => ({
            file: r.file,
            line: r.line,
            context: r.context,
            columns: this.extractTableColumns(r.context)
          }))
        });
      }
    }

    // Search for queries using this table
    const queryPatterns = [
      `SELECT.*FROM\\s+${table}`,
      `INSERT\\s+INTO\\s+${table}`,
      `UPDATE\\s+${table}`,
      `DELETE\\s+FROM\\s+${table}`
    ];

    for (const pattern of queryPatterns) {
      const results = await this.searchEngine.smartSearch(
        pattern,
        [searchDir],
        { fileTypes: ['java', 'javascript'], maxResults: 10 }
      );

      if (results.results && results.results.length > 0) {
        analysis.dependencies.push({
          type: 'database_query',
          table: table,
          pattern: pattern,
          queries: results.results.map(r => ({
            file: r.file,
            line: r.line,
            query: this.extractSQLFromContext(r.context),
            context: r.context
          }))
        });
      }
    }
  }

  /**
   * Analyze data sources in detail
   */
  async analyzeDataSources(snippet, dependencies, searchDir) {
    const dataSources = {
      arrays: [],
      constants: [],
      queries: [],
      configurations: [],
      externalSources: []
    };

    // Analyze arrays and collections
    const arrayMatches = [...snippet.matchAll(this.queryPatterns.arrayAdd)];
    for (const match of arrayMatches) {
      const arrayName = match[1];
      const operation = match[2];
      
      // Find where this array is initialized
      const initSearch = await this.searchEngine.smartSearch(
        `${arrayName}.*=.*new`,
        [searchDir],
        { fileTypes: ['java', 'javascript'], maxResults: 10 }
      );

      dataSources.arrays.push({
        name: arrayName,
        operation: operation,
        initialization: initSearch.results.map(r => ({
          file: r.file,
          line: r.line,
          context: r.context
        }))
      });
    }

    // Analyze SQL queries
    const queryMatches = [
      ...snippet.matchAll(this.queryPatterns.jdbcQuery),
      ...snippet.matchAll(this.queryPatterns.namedQuery)
    ];
    
    for (const match of queryMatches) {
      const queryContext = match[0];
      const sqlQuery = this.extractSQLFromContext(queryContext);
      if (sqlQuery) {
        dataSources.queries.push({
          type: 'jdbc_query',
          query: sqlQuery,
          context: queryContext,
          tables: this.extractTablesFromSQL(sqlQuery)
        });
      }
    }

    // Analyze configuration access
    const configMatches = snippet.match(this.queryPatterns.configAccess) || [];
    for (const config of configMatches) {
      // Find the population logic for this config
      const populateSearch = await this.searchEngine.smartSearch(
        `${config.replace('ConfigStore.', '')}.*populate`,
        [searchDir],
        { fileTypes: ['java'], maxResults: 5 }
      );

      dataSources.configurations.push({
        name: config,
        populationLogic: populateSearch.results.map(r => ({
          file: r.file,
          line: r.line,
          context: r.context
        }))
      });
    }

    // Analyze external sources (environment variables, property files)
    const envMatches = snippet.match(this.queryPatterns.envVar) || [];
    for (const env of envMatches) {
      dataSources.externalSources.push({
        type: 'environment_variable',
        name: env,
        usage: 'Check system environment or Docker configuration'
      });
    }

    return dataSources;
  }

  /**
   * Extract SQL query from code context
   */
  extractSQLFromContext(context) {
    // Try to extract SQL query from the context
    const sqlPatterns = [
      /"([^"]*(?:SELECT|INSERT|UPDATE|DELETE)[^"]*)"/i,
      /'([^']*(?:SELECT|INSERT|UPDATE|DELETE)[^']*)'/i,
      /`([^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*)`/i,
      /"""([^]*?(?:SELECT|INSERT|UPDATE|DELETE)[^]*?)"""/i
    ];

    for (const pattern of sqlPatterns) {
      const match = context.match(pattern);
      if (match && match[1]) {
        return match[1].replace(/\s+/g, ' ').trim();
      }
    }

    return null;
  }

  /**
   * Extract table names from SQL query
   */
  extractTablesFromSQL(sql) {
    const tables = new Set();
    const patterns = [
      /FROM\s+(\w+)/gi,
      /JOIN\s+(\w+)/gi,
      /INTO\s+(\w+)/gi,
      /UPDATE\s+(\w+)/gi
    ];

    for (const pattern of patterns) {
      const matches = [...sql.matchAll(pattern)];
      matches.forEach(match => {
        if (match[1]) tables.add(match[1]);
      });
    }

    return Array.from(tables);
  }

  /**
   * Extract column names from CREATE TABLE statement
   */
  extractTableColumns(context) {
    const columns = [];
    const columnPattern = /^\s*(\w+)\s+(\w+(?:\([^)]+\))?)/gm;
    const matches = [...context.matchAll(columnPattern)];
    
    matches.forEach(match => {
      if (match[1] && !['CREATE', 'TABLE', 'PRIMARY', 'FOREIGN', 'KEY', 'CONSTRAINT'].includes(match[1].toUpperCase())) {
        columns.push({
          name: match[1],
          type: match[2]
        });
      }
    });

    return columns;
  }

  /**
   * Extract constant value from context
   */
  extractConstantValue(context, constantName) {
    const patterns = [
      new RegExp(`${constantName}\\s*=\\s*"([^"]+)"`),
      new RegExp(`${constantName}\\s*=\\s*'([^']+)'`),
      new RegExp(`${constantName}\\s*=\\s*(\\d+)`),
      new RegExp(`${constantName}\\s*=\\s*([\\w.]+)`)
    ];

    for (const pattern of patterns) {
      const match = context.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Generate recommendations based on analysis
   */
  generateRecommendations(analysis) {
    const recommendations = [];

    // Check for uninitialized arrays/collections
    if (analysis.dataSourceAnalysis.arrays.length > 0) {
      analysis.dataSourceAnalysis.arrays.forEach(array => {
        if (array.initialization.length === 0) {
          recommendations.push({
            type: 'uninitialized_collection',
            message: `Array/Collection '${array.name}' is being used but initialization not found`,
            suggestion: `Search for where '${array.name}' is created or passed as parameter`
          });
        }
      });
    }

    // Check for missing configuration sources
    if (analysis.dataSourceAnalysis.configurations.length > 0) {
      analysis.dataSourceAnalysis.configurations.forEach(config => {
        if (config.populationLogic.length === 0) {
          recommendations.push({
            type: 'missing_configuration',
            message: `Configuration '${config.name}' used but population logic not found`,
            suggestion: 'Check ConfigStore initialization, database queries, or property files'
          });
        }
      });
    }

    // Check for SQL-related issues
    if (analysis.dataSourceAnalysis.queries.length > 0) {
      analysis.dataSourceAnalysis.queries.forEach(query => {
        if (!query.query || query.tables.length === 0) {
          recommendations.push({
            type: 'incomplete_query',
            message: 'SQL query found but appears incomplete or malformed',
            suggestion: 'Verify the SQL query syntax and table references'
          });
        }
      });
    }

    // Check for external dependencies
    if (analysis.dataSourceAnalysis.externalSources.length > 0) {
      recommendations.push({
        type: 'external_dependencies',
        message: `Found ${analysis.dataSourceAnalysis.externalSources.length} external dependencies (env vars, properties)`,
        suggestion: 'Ensure all environment variables and property files are properly configured'
      });
    }

    // Check for circular dependencies
    if (analysis.traversalPath.length > 5) {
      const files = analysis.traversalPath.map(p => p.file);
      const uniqueFiles = new Set(files);
      if (uniqueFiles.size < files.length) {
        recommendations.push({
          type: 'potential_circular_dependency',
          message: 'Detected potential circular dependency in file references',
          suggestion: 'Review the dependency chain to avoid circular references'
        });
      }
    }

    return recommendations;
  }

  /**
   * Main analysis method for compatibility
   */
  async analyzeSnippet(snippet, file, extraContext = "") {
    const prompt = `
You are an expert code and document diagnostician. Given the following code or documentation snippet (with some extra context):

File: ${file}
Snippet:
"""
${snippet}
"""

${extraContext ? "Extra context:\n" + extraContext : ""}

Detect if there is an issue, explain the likely root cause, and give clear actionable tips or code suggestions to fix it.
Respond with: issue description, root cause analysis, and actionable fix suggestions.
`;

    // Simulate LLM analysis (in real implementation, call actual LLM)
    return {
      issue: "Potential data source issue detected",
      rootCause: "Variables or configurations may not be properly initialized",
      tips: "Use traversal analysis to trace data sources and initialization"
    };
  }
}

module.exports = { EnhancedTraversalAnalyzer };