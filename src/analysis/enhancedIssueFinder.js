const { CodeTraversalEngine } = require('./codeTraversalEngine');
const fs = require('fs');
const path = require('path');

/**
 * Enhanced Issue Finder - Pure logic implementation without LLM
 * Analyzes code issues using static analysis and pattern matching
 */
class EnhancedIssueFinder {
  constructor() {
    this.traversalEngine = new CodeTraversalEngine();
    this.issuePatterns = this.initializeIssuePatterns();
    this.validationPatterns = this.initializeValidationPatterns();
  }

  /**
   * Main analysis method - combines basic analysis with traversal
   */
  async analyzeSnippetWithTraversal(snippet, file, extraContext = "", searchDirectory = null) {
    const analysis = {
      timestamp: new Date().toISOString(),
      file,
      snippet,
      context: extraContext,
      basicAnalysis: null,
      traversalAnalysis: null,
      combinedAnalysis: null,
      readableOutput: null
    };

    try {
      // Step 1: Basic static analysis
      analysis.basicAnalysis = this.performBasicAnalysis(snippet, file, extraContext);
      
      // Step 2: Traversal analysis if search directory provided
      if (searchDirectory) {
        const sourceFiles = await this.getSourceFiles(searchDirectory);
        analysis.traversalAnalysis = await this.performTraversalAnalysis(
          snippet, 
          file, 
          sourceFiles, 
          analysis.basicAnalysis
        );
      }
      
      // Step 3: Combine analyses
      analysis.combinedAnalysis = this.combineAnalyses(
        analysis.basicAnalysis, 
        analysis.traversalAnalysis
      );
      
      // Step 4: Generate readable output
      analysis.readableOutput = this.formatReadableOutput(analysis);
      
      return analysis;
      
    } catch (error) {
      console.error('Error in enhanced analysis:', error);
      return {
        ...analysis,
        error: error.message
      };
    }
  }

  /**
   * Perform basic static analysis of the code snippet
   */
  performBasicAnalysis(snippet, file, extraContext) {
    const analysis = {
      issue: null,
      rootCause: null,
      tips: [],
      errorCodes: [],
      patterns: [],
      codeElements: {}
    };

    // Extract error codes
    analysis.errorCodes = this.extractErrorCodes(snippet);
    
    // Identify code patterns
    analysis.patterns = this.identifyPatterns(snippet);
    
    // Extract code elements
    analysis.codeElements = this.extractCodeElements(snippet);
    
    // Analyze issues based on patterns
    analysis.issue = this.identifyIssue(snippet, analysis.patterns);
    analysis.rootCause = this.identifyRootCause(snippet, analysis.patterns, analysis.codeElements);
    analysis.tips = this.generateBasicTips(snippet, analysis.patterns, analysis.codeElements);
    
    return analysis;
  }

  /**
   * Perform traversal analysis using the traversal engine
   */
  async performTraversalAnalysis(snippet, file, sourceFiles, basicAnalysis) {
    const analysis = {
      dependencies: {},
      configurations: {},
      executionFlow: [],
      traceSteps: []
    };

    try {
      // If we found error codes, trace them
      for (const errorCode of basicAnalysis.errorCodes) {
        const errorAnalysis = await this.traversalEngine.analyzeErrorCode(
          errorCode, 
          sourceFiles,
          { snippet, file }
        );
        
        if (errorAnalysis && !errorAnalysis.error) {
          analysis.dependencies[errorCode] = errorAnalysis;
          analysis.traceSteps.push(...errorAnalysis.traceSteps);
        }
      }
      
      // Trace configuration dependencies
      const configRefs = this.extractConfigurationReferences(snippet);
      for (const configRef of configRefs) {
        const configAnalysis = await this.traceConfigurationReference(configRef, sourceFiles);
        if (configAnalysis) {
          analysis.configurations[configRef] = configAnalysis;
        }
      }
      
    } catch (error) {
      console.error('Error in traversal analysis:', error);
      analysis.error = error.message;
    }

    return analysis;
  }

  /**
   * Trace a configuration reference to its source
   */
  async traceConfigurationReference(configRef, sourceFiles) {
    const analysis = {
      reference: configRef,
      populationMethod: null,
      dataSource: null,
      sqlQuery: null,
      steps: []
    };

    // Extract property name (e.g., "colPlanList" from "ConfigStore.colPlanList")
    const parts = configRef.split('.');
    const propertyName = parts[parts.length - 1];
    
    // Look for population method
    for (const file of sourceFiles) {
      const content = file.content;
      
      // Look for methods that populate this property
      const populatePatterns = [
        new RegExp(`populate.*${propertyName}.*\\(`, 'gi'),
        new RegExp(`${propertyName}\\s*=`, 'gm'),
        new RegExp(`\\.(${propertyName})\\s*=`, 'gm')
      ];
      
      for (const pattern of populatePatterns) {
        const match = content.match(pattern);
        if (match) {
          analysis.populationMethod = match[0];
          
          // Find the method body
          const methodStart = content.indexOf(match[0]);
          const methodBody = this.extractMethodBody(content, methodStart);
          
          // Look for SQL queries
          const sqlQuery = this.extractSqlQuery(methodBody);
          if (sqlQuery) {
            analysis.sqlQuery = sqlQuery;
            analysis.dataSource = 'database';
            
            // Extract table name
            const tableMatch = sqlQuery.match(/FROM\s+(\w+)/i);
            if (tableMatch) {
              analysis.tableName = tableMatch[1];
            }
          }
          
          // Build steps
          analysis.steps = this.buildConfigurationTraceSteps(configRef, analysis);
          
          return analysis;
        }
      }
    }
    
    return null;
  }

  /**
   * Build trace steps for configuration
   */
  buildConfigurationTraceSteps(configRef, analysis) {
    const steps = [];
    
    steps.push({
      step: 1,
      description: `Configuration accessed: ${configRef}`,
      location: 'Code usage point'
    });
    
    if (analysis.populationMethod) {
      steps.push({
        step: 2,
        description: `Populated by method containing: ${analysis.populationMethod}`,
        location: 'Population method'
      });
    }
    
    if (analysis.dataSource === 'database') {
      steps.push({
        step: 3,
        description: `Data loaded from database table: ${analysis.tableName || 'Unknown table'}`,
        location: 'Database'
      });
      
      if (analysis.sqlQuery) {
        steps.push({
          step: 4,
          description: `SQL Query executed: ${analysis.sqlQuery}`,
          location: 'Database query'
        });
      }
    }
    
    return steps;
  }

  /**
   * Combine basic and traversal analyses
   */
  combineAnalyses(basicAnalysis, traversalAnalysis) {
    const combined = {
      ...basicAnalysis,
      enhancedRootCause: basicAnalysis.rootCause,
      enhancedTips: [...basicAnalysis.tips],
      recommendations: [],
      traceInformation: {}
    };

    if (!traversalAnalysis) {
      return combined;
    }

    // Add traversal information
    combined.traceInformation = {
      dependenciesFound: Object.keys(traversalAnalysis.dependencies || {}),
      configurationsFound: Object.keys(traversalAnalysis.configurations || {}),
      totalTraceSteps: traversalAnalysis.traceSteps?.length || 0
    };

    // Enhanced root cause with traversal info
    if (traversalAnalysis.configurations && Object.keys(traversalAnalysis.configurations).length > 0) {
      const configInfo = Object.values(traversalAnalysis.configurations)[0];
      if (configInfo.sqlQuery) {
        combined.enhancedRootCause = `${basicAnalysis.rootCause} - Data populated from database query: ${configInfo.sqlQuery}`;
      }
    }

    // Generate enhanced recommendations
    combined.recommendations = this.generateEnhancedRecommendations(basicAnalysis, traversalAnalysis);

    return combined;
  }

  /**
   * Generate enhanced recommendations based on both analyses
   */
  generateEnhancedRecommendations(basicAnalysis, traversalAnalysis) {
    const recommendations = [];

    // Database verification recommendations
    if (traversalAnalysis && traversalAnalysis.configurations) {
      for (const [configRef, configInfo] of Object.entries(traversalAnalysis.configurations)) {
        if (configInfo.sqlQuery) {
          recommendations.push({
            type: 'database_verification',
            priority: 'high',
            title: `Verify ${configRef} data`,
            description: `Check if database returns expected values for ${configRef}`,
            action: `Execute: ${configInfo.sqlQuery}`,
            query: configInfo.sqlQuery,
            table: configInfo.tableName
          });
        }
      }
    }

    // Validation recommendations
    if (basicAnalysis.patterns.includes('validation_failure')) {
      recommendations.push({
        type: 'input_validation',
        priority: 'high',
        title: 'Verify input data format',
        description: 'Validation failed - input data may not match expected format',
        action: 'Check input data structure, format, and values'
      });
    }

    // Constant verification recommendations
    if (basicAnalysis.codeElements.constants && basicAnalysis.codeElements.constants.length > 0) {
      for (const constant of basicAnalysis.codeElements.constants) {
        recommendations.push({
          type: 'constant_verification',
          priority: 'medium',
          title: `Verify constant: ${constant}`,
          description: `Check if constant ${constant} has the expected value`,
          action: `Review definition and value of ${constant}`
        });
      }
    }

    return recommendations;
  }

  /**
   * Format readable output
   */
  formatReadableOutput(analysis) {
    let output = `# 🔍 Enhanced Code Analysis\n\n`;
    output += `**File:** ${analysis.file}\n`;
    output += `**Analysis Time:** ${analysis.timestamp}\n\n`;

    // Issue summary
    if (analysis.combinedAnalysis.issue) {
      output += `## 🚨 Issue Identified\n`;
      output += `${analysis.combinedAnalysis.issue}\n\n`;
    }

    // Root cause
    if (analysis.combinedAnalysis.enhancedRootCause) {
      output += `## 🎯 Root Cause\n`;
      output += `${analysis.combinedAnalysis.enhancedRootCause}\n\n`;
    }

    // Code snippet
    output += `## 📝 Code Snippet\n`;
    output += `\`\`\`java\n${analysis.snippet}\n\`\`\`\n\n`;

    // Error codes found
    if (analysis.basicAnalysis.errorCodes.length > 0) {
      output += `## 🔢 Error Codes Found\n`;
      analysis.basicAnalysis.errorCodes.forEach(code => {
        output += `- \`${code}\`\n`;
      });
      output += `\n`;
    }

    // Trace information
    if (analysis.traversalAnalysis && analysis.traversalAnalysis.traceSteps.length > 0) {
      output += `## 🔍 Execution Trace\n`;
      analysis.traversalAnalysis.traceSteps.forEach(step => {
        output += `${step.step}. ${step.description}\n`;
        if (step.details) {
          output += `   Details: ${step.details}\n`;
        }
      });
      output += `\n`;
    }

    // Configuration sources
    if (analysis.traversalAnalysis && analysis.traversalAnalysis.configurations) {
      output += `## ⚙️ Configuration Sources\n`;
      for (const [configRef, configInfo] of Object.entries(analysis.traversalAnalysis.configurations)) {
        output += `**${configRef}:**\n`;
        if (configInfo.sqlQuery) {
          output += `- Data Source: Database\n`;
          output += `- Query: \`${configInfo.sqlQuery}\`\n`;
          if (configInfo.tableName) {
            output += `- Table: \`${configInfo.tableName}\`\n`;
          }
        }
      }
      output += `\n`;
    }

    // Recommendations
    if (analysis.combinedAnalysis.recommendations.length > 0) {
      output += `## 💡 Recommendations\n\n`;
      analysis.combinedAnalysis.recommendations.forEach(rec => {
        output += `### ${rec.priority.toUpperCase()}: ${rec.title}\n`;
        output += `${rec.description}\n\n`;
        output += `**Action:** ${rec.action}\n`;
        if (rec.query) {
          output += `**SQL to verify:**\n\`\`\`sql\n${rec.query}\n\`\`\`\n`;
        }
        output += `\n`;
      });
    }

    // Tips
    if (analysis.combinedAnalysis.enhancedTips.length > 0) {
      output += `## 📋 Additional Tips\n`;
      analysis.combinedAnalysis.enhancedTips.forEach(tip => {
        output += `- ${tip}\n`;
      });
    }

    return output;
  }

  // Pattern recognition methods
  initializeIssuePatterns() {
    return [
      {
        name: 'validation_failure',
        pattern: /if\s*\(\s*!\s*.*Valid.*\)/i,
        description: 'Validation check failed'
      },
      {
        name: 'null_check_failure',
        pattern: /if\s*\(.*\s*==\s*null\)/i,
        description: 'Null value encountered'
      },
      {
        name: 'range_check_failure',
        pattern: /if\s*\(.*\s*[<>]=?\s*.*\)/,
        description: 'Range validation failed'
      },
      {
        name: 'configuration_check',
        pattern: /ConfigStore\.\w+/,
        description: 'Configuration dependency detected'
      },
      {
        name: 'error_logging',
        pattern: /LOGGER\.(info|error|warn).*ERROR/i,
        description: 'Error being logged'
      }
    ];
  }

  initializeValidationPatterns() {
    return [
      {
        name: 'string_validation',
        pattern: /isValid.*String/i,
        description: 'String format validation'
      },
      {
        name: 'choice_validation',
        pattern: /isValid.*Choice/i,
        description: 'Value choice validation'
      },
      {
        name: 'numeric_validation',
        pattern: /isValid.*(Int|Float|Double|Number)/i,
        description: 'Numeric validation'
      },
      {
        name: 'date_validation',
        pattern: /isValid.*Date/i,
        description: 'Date format validation'
      }
    ];
  }

  // Utility methods
  extractErrorCodes(snippet) {
    const errorPattern = /\b[A-Z]+ERROR-\d+\b|\b[A-Z]+ERR-\d+\b/g;
    return snippet.match(errorPattern) || [];
  }

  identifyPatterns(snippet) {
    const foundPatterns = [];
    
    for (const pattern of this.issuePatterns) {
      if (pattern.pattern.test(snippet)) {
        foundPatterns.push(pattern.name);
      }
    }
    
    return foundPatterns;
  }

  extractCodeElements(snippet) {
    return {
      methodCalls: this.extractMethodCalls(snippet),
      constants: this.extractConstants(snippet),
      variables: this.extractVariables(snippet),
      conditions: this.extractConditions(snippet)
    };
  }

  extractMethodCalls(snippet) {
    const methodPattern = /\b\w+\.\w+\s*\(/g;
    const matches = snippet.match(methodPattern) || [];
    return matches.map(m => m.replace(/\s*\($/, ''));
  }

  extractConstants(snippet) {
    const constantPattern = /\b[A-Z][A-Z0-9_]{2,}\b/g;
    const configPattern = /\b(ConfigStore|Const)\.\w+/g;
    
    const constants = snippet.match(constantPattern) || [];
    const configs = snippet.match(configPattern) || [];
    
    return [...constants, ...configs];
  }

  extractVariables(snippet) {
    const varPattern = /\b[a-z]\w*\./g;
    const matches = snippet.match(varPattern) || [];
    return matches.map(m => m.replace('.', ''));
  }

  extractConditions(snippet) {
    const conditionPattern = /if\s*\(\s*([^)]+)\)/g;
    const matches = snippet.match(conditionPattern) || [];
    return matches.map(m => m.replace(/if\s*\(\s*|\s*\)$/g, ''));
  }

  extractConfigurationReferences(snippet) {
    const configPattern = /\b(ConfigStore|Const)\.\w+/g;
    return snippet.match(configPattern) || [];
  }

  identifyIssue(snippet, patterns) {
    if (patterns.includes('validation_failure')) {
      return 'Validation check failed in conditional statement';
    }
    if (patterns.includes('error_logging')) {
      return 'Error condition detected and being logged';
    }
    if (patterns.includes('null_check_failure')) {
      return 'Null value check failed';
    }
    if (patterns.includes('range_check_failure')) {
      return 'Range or boundary check failed';
    }
    return 'Code issue detected based on pattern analysis';
  }

  identifyRootCause(snippet, patterns, codeElements) {
    let cause = 'Analysis based on code patterns: ';
    
    if (patterns.includes('validation_failure')) {
      if (codeElements.methodCalls.some(mc => mc.includes('ConfigStore'))) {
        cause += 'Input value does not exist in configuration data list';
      } else {
        cause += 'Input value does not match expected format or constraints';
      }
    } else if (patterns.includes('configuration_check')) {
      cause += 'Configuration data may not be properly loaded or available';
    } else {
      cause += 'Conditional check failed, review logic and input data';
    }
    
    return cause;
  }

  generateBasicTips(snippet, patterns, codeElements) {
    const tips = [];
    
    if (patterns.includes('validation_failure')) {
      tips.push('Verify input data format matches expected validation rules');
      tips.push('Check if validation method parameters are correct');
    }
    
    if (patterns.includes('configuration_check')) {
      tips.push('Ensure configuration data is properly loaded before use');
      tips.push('Check database connectivity and query execution');
    }
    
    if (codeElements.constants.length > 0) {
      tips.push('Verify constant values are defined and have expected values');
    }
    
    if (codeElements.methodCalls.length > 0) {
      tips.push('Check method call parameters and return values');
    }
    
    return tips;
  }

  async getSourceFiles(searchDirectory) {
    const files = [];
    
    try {
      await this.scanDirectoryForJavaFiles(searchDirectory, files);
    } catch (error) {
      console.error('Error scanning directory:', error);
    }
    
    return files;
  }

  async scanDirectoryForJavaFiles(dirPath, files) {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory() && !this.shouldSkipDirectory(entry.name)) {
        await this.scanDirectoryForJavaFiles(fullPath, files);
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        try {
          const content = await fs.promises.readFile(fullPath, 'utf8');
          files.push({ path: fullPath, content, name: entry.name });
        } catch (error) {
          console.warn(`Could not read file ${fullPath}:`, error.message);
        }
      }
    }
  }

  shouldSkipDirectory(dirName) {
    const skipDirs = ['node_modules', '.git', 'target', 'build', '.idea', '.vscode'];
    return skipDirs.includes(dirName);
  }

  extractMethodBody(content, startIndex) {
    let braceCount = 0;
    let inMethod = false;
    let body = '';
    
    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];
      
      if (char === '{') {
        braceCount++;
        inMethod = true;
      }
      
      if (inMethod) {
        body += char;
      }
      
      if (char === '}') {
        braceCount--;
        if (braceCount === 0 && inMethod) {
          break;
        }
      }
    }
    
    return body;
  }

  extractSqlQuery(methodBody) {
    const sqlPatterns = [
      /"(SELECT[\s\S]*?)"/gi,
      /'(SELECT[\s\S]*?)'/gi,
      /SELECT[\s\S]*?(?="|'|;|\))/gi
    ];
    
    for (const pattern of sqlPatterns) {
      const match = methodBody.match(pattern);
      if (match) {
        return match[0].replace(/^["']|["']$/g, '').trim();
      }
    }
    
    return null;
  }
}

module.exports = { EnhancedIssueFinder };