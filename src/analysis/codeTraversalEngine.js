const fs = require('fs');
const path = require('path');

/**
 * Pure Code Traversal Engine - No LLM, complete static analysis
 * Follows execution paths like an IDE to resolve constants and dependencies
 */
class CodeTraversalEngine {
  constructor() {
    this.cache = new Map();
    this.visitedFiles = new Set();
    this.constantsMap = new Map();
    this.methodDefinitions = new Map();
    this.classDefinitions = new Map();
  }

  /**
   * Main method to analyze any error code and trace its dependencies
   */
  async analyzeErrorCode(errorCode, sourceFiles, originContext = {}) {
    const analysis = {
      errorCode,
      timestamp: new Date().toISOString(),
      executionFlow: [],
      constantResolutions: {},
      configurationSources: {},
      recommendations: [],
      traceSteps: []
    };

    try {
      // Step 1: Find where the error code is used
      const errorUsages = this.findErrorCodeUsage(errorCode, sourceFiles);
      
      // Step 2: For each usage, trace the complete execution flow
      for (const usage of errorUsages) {
        const flowAnalysis = this.traceExecutionFlow(usage, sourceFiles);
        analysis.executionFlow.push(flowAnalysis);
        
        // Step 3: Resolve all dependencies found in this flow
        const dependencies = this.traceDependencies(flowAnalysis, sourceFiles);
        Object.assign(analysis.constantResolutions, dependencies.constants);
        Object.assign(analysis.configurationSources, dependencies.configurations);
        
        // Step 4: Build trace steps
        analysis.traceSteps.push(...this.buildTraceSteps(flowAnalysis, dependencies));
      }
      
      // Step 5: Generate recommendations
      analysis.recommendations = this.generateRecommendations(analysis);
      
      return analysis;
    } catch (error) {
      console.error('Error in code traversal:', error);
      return { error: error.message, errorCode };
    }
  }

  /**
   * Find all usages of an error code in the codebase
   */
  findErrorCodeUsage(errorCode, sourceFiles) {
    const usages = [];
    
    for (const file of sourceFiles) {
      const lines = file.content.split('\n');
      
      lines.forEach((line, index) => {
        if (line.includes(errorCode)) {
          const statement = this.extractCompleteStatement(lines, index);
          const containingMethod = this.findContainingMethod(lines, index);
          const className = this.extractClassName(file.content);
          
          usages.push({
            file: file.path,
            line: index + 1,
            statement,
            containingMethod,
            className,
            context: this.extractStatementContext(lines, index, 5)
          });
        }
      });
    }
    
    return usages;
  }

  /**
   * Trace the complete execution flow for a specific usage
   */
  traceExecutionFlow(usage, sourceFiles) {
    const flow = {
      location: `${usage.className}.${usage.containingMethod}:${usage.line}`,
      statement: usage.statement,
      conditions: this.parseConditions(usage.statement),
      methodCalls: this.parseMethodCalls(usage.statement),
      constants: this.parseConstants(usage.statement),
      variables: this.parseVariables(usage.statement)
    };
    
    return flow;
  }

  /**
   * Trace all dependencies (constants, method calls, configurations)
   */
  traceDependencies(flowAnalysis, sourceFiles) {
    const dependencies = {
      constants: {},
      configurations: {},
      methods: {}
    };
    
    // Trace constants
    for (const constant of flowAnalysis.constants) {
      const resolution = this.resolveConstant(constant, sourceFiles);
      if (resolution) {
        dependencies.constants[constant] = resolution;
      }
    }
    
    // Trace method calls
    for (const methodCall of flowAnalysis.methodCalls) {
      const methodInfo = this.resolveMethodCall(methodCall, sourceFiles);
      if (methodInfo) {
        dependencies.methods[methodCall] = methodInfo;
        
        // If this method call involves configuration, trace it
        if (this.isConfigurationMethod(methodCall)) {
          const configInfo = this.traceConfigurationMethod(methodCall, methodInfo, sourceFiles);
          if (configInfo) {
            dependencies.configurations[methodCall] = configInfo;
          }
        }
      }
    }
    
    return dependencies;
  }

  /**
   * Parse conditions from a statement (like if statements)
   */
  parseConditions(statement) {
    const conditions = [];
    
    // Match if conditions
    const ifMatch = statement.match(/if\s*\(\s*([^)]+)\)/);
    if (ifMatch) {
      const condition = ifMatch[1];
      conditions.push({
        type: 'if',
        expression: condition.trim(),
        negated: condition.includes('!')
      });
    }
    
    // Match logical operators
    const logicalOps = statement.match(/(&&|\|\||!)/g) || [];
    
    return conditions;
  }

  /**
   * Parse method calls from a statement
   */
  parseMethodCalls(statement) {
    const methodCalls = [];
    
    // Pattern for method calls: object.method(params) or ClassName.method(params)
    const methodPattern = /([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\(/g;
    let match;
    
    while ((match = methodPattern.exec(statement)) !== null) {
      const fullCall = match[1];
      const parts = fullCall.split('.');
      
      methodCalls.push({
        fullCall,
        object: parts.length > 1 ? parts.slice(0, -1).join('.') : null,
        method: parts[parts.length - 1],
        parameters: this.extractMethodParameters(statement, match.index)
      });
    }
    
    return methodCalls;
  }

  /**
   * Parse constants and static references from a statement
   */
  parseConstants(statement) {
    const constants = [];
    
    // ALL_CAPS constants
    const capsConstantsPattern = /\b[A-Z][A-Z0-9_]{2,}\b/g;
    const capsMatches = statement.match(capsConstantsPattern) || [];
    constants.push(...capsMatches);
    
    // Class.CONSTANT patterns
    const classConstantPattern = /\b[A-Z][a-zA-Z0-9]*\.[A-Z][A-Z0-9_]*\b/g;
    const classConstantMatches = statement.match(classConstantPattern) || [];
    constants.push(...classConstantMatches);
    
    // ConfigStore/Const references
    const configPattern = /\b(ConfigStore|Const)\.[a-zA-Z][a-zA-Z0-9_]*/g;
    const configMatches = statement.match(configPattern) || [];
    constants.push(...configMatches);
    
    return [...new Set(constants)];
  }

  /**
   * Parse variables from a statement
   */
  parseVariables(statement) {
    const variables = [];
    
    // Variable.method() patterns
    const varMethodPattern = /\b([a-z][a-zA-Z0-9_]*)\.[a-zA-Z]/g;
    let match;
    
    while ((match = varMethodPattern.exec(statement)) !== null) {
      variables.push(match[1]);
    }
    
    return [...new Set(variables)];
  }

  /**
   * Resolve a constant to its definition and value
   */
  resolveConstant(constant, sourceFiles) {
    // Check cache first
    if (this.constantsMap.has(constant)) {
      return this.constantsMap.get(constant);
    }
    
    const resolution = {
      name: constant,
      value: null,
      source: null,
      type: null,
      definition: null
    };
    
    for (const file of sourceFiles) {
      const content = file.content;
      
      // Look for static/final declarations
      const patterns = [
        new RegExp(`static\\s+final\\s+\\w+\\s+${this.escapeRegex(constant)}\\s*=\\s*([^;]+);`, 'gm'),
        new RegExp(`public\\s+static\\s+final\\s+\\w+\\s+${this.escapeRegex(constant)}\\s*=\\s*([^;]+);`, 'gm'),
        new RegExp(`private\\s+static\\s+final\\s+\\w+\\s+${this.escapeRegex(constant)}\\s*=\\s*([^;]+);`, 'gm'),
        new RegExp(`static\\s+\\w+\\s+${this.escapeRegex(constant)}\\s*=\\s*([^;]+);`, 'gm')
      ];
      
      for (const pattern of patterns) {
        const match = pattern.exec(content);
        if (match) {
          resolution.value = match[1].trim().replace(/^["']|["']$/g, '');
          resolution.source = file.path;
          resolution.type = 'static_constant';
          resolution.definition = match[0].trim();
          break;
        }
      }
      
      if (resolution.value) break;
    }
    
    // Cache the result
    this.constantsMap.set(constant, resolution);
    return resolution;
  }

  /**
   * Resolve a method call to its definition
   */
  resolveMethodCall(methodCall, sourceFiles) {
    const methodInfo = {
      call: methodCall.fullCall,
      definition: null,
      source: null,
      returnType: null,
      parameters: methodCall.parameters,
      body: null
    };
    
    for (const file of sourceFiles) {
      const content = file.content;
      
      // Look for method definition
      const methodName = methodCall.method;
      const methodPattern = new RegExp(
        `(?:public|private|protected)?\\s*(?:static)?\\s*\\w+\\s+${methodName}\\s*\\([^)]*\\)\\s*\\{`,
        'gm'
      );
      
      const match = methodPattern.exec(content);
      if (match) {
        methodInfo.definition = match[0];
        methodInfo.source = file.path;
        methodInfo.body = this.extractMethodBody(content, match.index);
        break;
      }
    }
    
    return methodInfo;
  }

  /**
   * Check if a method call involves configuration
   */
  isConfigurationMethod(methodCall) {
    const configPatterns = [
      /ConfigStore\./,
      /\.populate\w+/,
      /\.get\w+List/,
      /\.load\w+/
    ];
    
    return configPatterns.some(pattern => pattern.test(methodCall.fullCall));
  }

  /**
   * Trace configuration method to find data source
   */
  traceConfigurationMethod(methodCall, methodInfo, sourceFiles) {
    if (!methodInfo || !methodInfo.body) {
      return null;
    }
    
    const configInfo = {
      method: methodCall.fullCall,
      source: methodInfo.source,
      dataSource: null,
      sqlQuery: null,
      populationSteps: []
    };
    
    // Look for SQL queries in method body
    const sqlPatterns = [
      /"(SELECT[\s\S]*?)"/gi,
      /'(SELECT[\s\S]*?)'/gi,
      /SELECT[\s\S]*?(?="|'|;|\)|$)/gi
    ];
    
    for (const pattern of sqlPatterns) {
      const matches = methodInfo.body.match(pattern);
      if (matches) {
        configInfo.sqlQuery = matches[0].replace(/^["']|["']$/g, '').trim();
        configInfo.dataSource = 'database';
        break;
      }
    }
    
    // Look for jdbcTemplate usage
    if (methodInfo.body.includes('jdbcTemplate')) {
      configInfo.dataSource = 'database';
      
      // Extract table names from SQL or method context
      if (configInfo.sqlQuery) {
        const tableMatch = configInfo.sqlQuery.match(/FROM\s+(\w+)/i);
        if (tableMatch) {
          configInfo.tableName = tableMatch[1];
        }
      }
    }
    
    // Build population steps
    configInfo.populationSteps = this.buildConfigurationSteps(methodCall, methodInfo, configInfo);
    
    return configInfo;
  }

  /**
   * Build step-by-step trace for configuration population
   */
  buildConfigurationSteps(methodCall, methodInfo, configInfo) {
    const steps = [];
    
    steps.push({
      step: 1,
      description: `Configuration accessed: ${methodCall.fullCall}`,
      location: 'Usage point'
    });
    
    if (methodInfo.definition) {
      steps.push({
        step: 2,
        description: `Resolved to method: ${methodInfo.definition}`,
        location: methodInfo.source
      });
    }
    
    if (configInfo.dataSource === 'database') {
      steps.push({
        step: 3,
        description: 'Data loaded from database',
        location: configInfo.tableName || 'Database table'
      });
      
      if (configInfo.sqlQuery) {
        steps.push({
          step: 4,
          description: `SQL Query: ${configInfo.sqlQuery}`,
          location: 'Database query'
        });
      }
    }
    
    return steps;
  }

  /**
   * Build complete trace steps for the analysis
   */
  buildTraceSteps(flowAnalysis, dependencies) {
    const steps = [];
    let stepNumber = 1;
    
    // Add error location
    steps.push({
      step: stepNumber++,
      type: 'error_location',
      description: `Error occurs at: ${flowAnalysis.location}`,
      details: flowAnalysis.statement
    });
    
    // Add condition analysis
    if (flowAnalysis.conditions.length > 0) {
      steps.push({
        step: stepNumber++,
        type: 'condition',
        description: 'Condition that failed:',
        details: flowAnalysis.conditions[0].expression
      });
    }
    
    // Add dependency traces
    for (const [name, config] of Object.entries(dependencies.configurations)) {
      if (config.populationSteps) {
        steps.push(...config.populationSteps.map(ps => ({
          ...ps,
          step: stepNumber++,
          type: 'configuration_trace'
        })));
      }
    }
    
    return steps;
  }

  /**
   * Generate recommendations based on analysis
   */
  generateRecommendations(analysis) {
    const recommendations = [];
    
    // Database-related recommendations
    for (const [name, config] of Object.entries(analysis.configurationSources)) {
      if (config.sqlQuery) {
        recommendations.push({
          type: 'database_verification',
          priority: 'high',
          title: `Verify ${name} data source`,
          description: `Check if database query returns expected data`,
          action: `Execute and verify: ${config.sqlQuery}`,
          query: config.sqlQuery,
          table: config.tableName
        });
      }
    }
    
    // Constant validation recommendations
    for (const [name, constant] of Object.entries(analysis.constantResolutions)) {
      if (constant.value) {
        recommendations.push({
          type: 'constant_check',
          priority: 'medium',
          title: `Verify constant value: ${name}`,
          description: `Current value: ${constant.value}`,
          action: `Check if constant ${name} = "${constant.value}" is correct`,
          source: constant.source
        });
      }
    }
    
    // Input validation recommendations
    if (analysis.executionFlow.some(flow => 
      flow.methodCalls.some(mc => mc.method.includes('Valid') || mc.method.includes('Check'))
    )) {
      recommendations.push({
        type: 'input_validation',
        priority: 'high',
        title: 'Verify input data format',
        description: 'Validation failed - check input data structure',
        action: 'Review input data format and expected values'
      });
    }
    
    return recommendations;
  }

  // Utility methods
  extractCompleteStatement(lines, lineIndex) {
    let statement = lines[lineIndex].trim();
    let startIndex = lineIndex;
    let endIndex = lineIndex;
    
    // Look backward for statement start
    while (startIndex > 0) {
      const prevLine = lines[startIndex - 1].trim();
      if (prevLine.match(/^\s*(if|while|for|return|}\s*else)/)) {
        statement = prevLine + ' ' + statement;
        startIndex--;
        break;
      } else if (prevLine.endsWith('{') || prevLine.endsWith(';') || prevLine === '') {
        break;
      }
      startIndex--;
    }
    
    // Look forward for statement end
    while (endIndex < lines.length - 1 && !statement.includes(';') && !statement.includes('{')) {
      endIndex++;
      statement += ' ' + lines[endIndex].trim();
    }
    
    return statement.replace(/\s+/g, ' ').trim();
  }

  findContainingMethod(lines, lineIndex) {
    for (let i = lineIndex; i >= 0; i--) {
      const line = lines[i].trim();
      const methodMatch = line.match(/^\s*(?:public|private|protected).*?\s+(\w+)\s*\(/);
      if (methodMatch) {
        return methodMatch[1];
      }
    }
    return 'unknown';
  }

  extractClassName(content) {
    const classMatch = content.match(/class\s+(\w+)/);
    return classMatch ? classMatch[1] : 'Unknown';
  }

  extractStatementContext(lines, lineIndex, contextSize) {
    const start = Math.max(0, lineIndex - contextSize);
    const end = Math.min(lines.length, lineIndex + contextSize + 1);
    return lines.slice(start, end);
  }

  extractMethodParameters(statement, methodStartIndex) {
    const parenStart = statement.indexOf('(', methodStartIndex);
    if (parenStart === -1) return [];
    
    const parenEnd = statement.indexOf(')', parenStart);
    if (parenEnd === -1) return [];
    
    const paramsStr = statement.slice(parenStart + 1, parenEnd).trim();
    if (!paramsStr) return [];
    
    return paramsStr.split(',').map(p => p.trim());
  }

  extractMethodBody(content, methodStartIndex) {
    let braceCount = 0;
    let inMethod = false;
    let body = '';
    
    for (let i = methodStartIndex; i < content.length; i++) {
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

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

module.exports = { CodeTraversalEngine };