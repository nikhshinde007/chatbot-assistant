/**
 * Analysis Formatter - Formats analysis results for different output formats
 * Handles console, MCP, API, and other output formatting needs
 */
class AnalysisFormatter {
  
  /**
   * Format analysis for console/terminal output
   */
  static formatForConsole(analysis) {
    const colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m'
    };

    let output = '';
    
    // Header with colors
    output += `${colors.bright}${colors.cyan}🔍 Enhanced Code Analysis${colors.reset}\n`;
    output += `${colors.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n\n`;
    
    // Basic info
    output += `${colors.bright}File:${colors.reset} ${analysis.file || 'Unknown'}\n`;
    output += `${colors.bright}Time:${colors.reset} ${analysis.timestamp || new Date().toISOString()}\n\n`;
    
    // Issue summary with colors
    if (analysis.combinedAnalysis?.issue) {
      output += `${colors.bright}${colors.red}🚨 Issue:${colors.reset} ${analysis.combinedAnalysis.issue}\n\n`;
    }
    
    if (analysis.combinedAnalysis?.enhancedRootCause) {
      output += `${colors.bright}${colors.magenta}🎯 Root Cause:${colors.reset}\n`;
      output += `${this.wrapText(analysis.combinedAnalysis.enhancedRootCause, 70)}\n\n`;
    }
    
    // Error codes
    if (analysis.basicAnalysis?.errorCodes?.length > 0) {
      output += `${colors.bright}${colors.yellow}🔢 Error Codes:${colors.reset}\n`;
      analysis.basicAnalysis.errorCodes.forEach(code => {
        output += `  ${colors.red}▶${colors.reset} ${code}\n`;
      });
      output += '\n';
    }
    
    // Trace steps
    if (analysis.traversalAnalysis?.traceSteps?.length > 0) {
      output += `${colors.bright}${colors.blue}🔍 Execution Trace:${colors.reset}\n`;
      analysis.traversalAnalysis.traceSteps.forEach(step => {
        output += `  ${colors.green}${step.step}.${colors.reset} ${step.description}\n`;
        if (step.details) {
          output += `      ${colors.cyan}└─${colors.reset} ${step.details}\n`;
        }
      });
      output += '\n';
    }
    
    // Configuration sources
    if (analysis.traversalAnalysis?.configurations) {
      const configs = Object.entries(analysis.traversalAnalysis.configurations);
      if (configs.length > 0) {
        output += `${colors.bright}${colors.cyan}⚙️  Configuration Sources:${colors.reset}\n`;
        configs.forEach(([configRef, configInfo]) => {
          output += `  ${colors.yellow}▶${colors.reset} ${colors.bright}${configRef}${colors.reset}\n`;
          if (configInfo.sqlQuery) {
            output += `    ${colors.green}Database Query:${colors.reset} ${configInfo.sqlQuery}\n`;
          }
          if (configInfo.tableName) {
            output += `    ${colors.green}Table:${colors.reset} ${configInfo.tableName}\n`;
          }
        });
        output += '\n';
      }
    }
    
    // Recommendations
    if (analysis.combinedAnalysis?.recommendations?.length > 0) {
      output += `${colors.bright}${colors.green}💡 Recommendations:${colors.reset}\n`;
      analysis.combinedAnalysis.recommendations.forEach((rec, index) => {
        const priorityColor = rec.priority === 'high' ? colors.red : 
                            rec.priority === 'medium' ? colors.yellow : colors.green;
        
        output += `  ${priorityColor}${rec.priority.toUpperCase()}:${colors.reset} ${colors.bright}${rec.title}${colors.reset}\n`;
        output += `  ${this.wrapText(rec.description, 65, '  ')}\n`;
        output += `  ${colors.cyan}Action:${colors.reset} ${rec.action}\n`;
        
        if (rec.query) {
          output += `  ${colors.blue}SQL:${colors.reset} ${rec.query}\n`;
        }
        output += '\n';
      });
    }
    
    return output;
  }

  /**
   * Format analysis for MCP tool response
   */
  static formatForMCP(analysis) {
    const response = {
      content: [
        {
          type: 'text',
          text: this.formatReadableText(analysis)
        }
      ],
      metadata: {
        analysisType: 'enhanced_with_traversal',
        timestamp: analysis.timestamp,
        file: analysis.file,
        errorCodes: analysis.basicAnalysis?.errorCodes || [],
        configurationsFound: analysis.combinedAnalysis?.traceInformation?.configurationsFound || [],
        recommendationsCount: analysis.combinedAnalysis?.recommendations?.length || 0,
        hasTraversalData: !!(analysis.traversalAnalysis && Object.keys(analysis.traversalAnalysis).length > 0)
      }
    };

    // Add error if present
    if (analysis.error) {
      response.error = analysis.error;
      response.content[0].text = `Analysis Error: ${analysis.error}\n\n` + response.content[0].text;
    }

    return response;
  }

  /**
   * Format analysis for API response
   */
  static formatForAPI(analysis) {
    return {
      success: !analysis.error,
      timestamp: analysis.timestamp,
      data: {
        file: analysis.file,
        snippet: analysis.snippet,
        context: analysis.context,
        basicAnalysis: analysis.basicAnalysis,
        traversalAnalysis: analysis.traversalAnalysis,
        combinedAnalysis: analysis.combinedAnalysis,
        summary: this.generateSummary(analysis)
      },
      error: analysis.error || null
    };
  }

  /**
   * Format analysis for JSON export
   */
  static formatForJSON(analysis, pretty = true) {
    const jsonData = {
      metadata: {
        version: '1.0',
        timestamp: analysis.timestamp,
        file: analysis.file,
        analysisType: 'enhanced_code_analysis'
      },
      analysis: {
        basic: analysis.basicAnalysis,
        traversal: analysis.traversalAnalysis,
        combined: analysis.combinedAnalysis
      },
      recommendations: analysis.combinedAnalysis?.recommendations || [],
      summary: this.generateSummary(analysis)
    };

    return pretty ? JSON.stringify(jsonData, null, 2) : JSON.stringify(jsonData);
  }

  /**
   * Format analysis for HTML report
   */
  static formatForHTML(analysis) {
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Analysis Report - ${analysis.file || 'Unknown File'}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { border-bottom: 3px solid #007acc; padding-bottom: 20px; margin-bottom: 30px; }
        .title { color: #007acc; margin: 0; font-size: 28px; }
        .meta { color: #666; margin-top: 10px; }
        .section { margin: 25px 0; }
        .section-title { color: #333; font-size: 20px; margin-bottom: 15px; padding-bottom: 5px; border-bottom: 2px solid #eee; }
        .issue { background: #fff5f5; border-left: 4px solid #e53e3e; padding: 15px; margin: 15px 0; border-radius: 4px; }
        .root-cause { background: #f7fafc; border-left: 4px solid #4299e1; padding: 15px; margin: 15px 0; border-radius: 4px; }
        .code { background: #2d3748; color: #e2e8f0; padding: 20px; border-radius: 6px; overflow-x: auto; font-family: 'Consolas', 'Monaco', monospace; font-size: 14px; line-height: 1.4; }
        .error-code { background: #fed7d7; color: #c53030; padding: 4px 8px; border-radius: 4px; font-family: monospace; font-weight: bold; }
        .trace-step { background: #f7fafc; margin: 8px 0; padding: 12px; border-radius: 4px; border-left: 3px solid #4299e1; }
        .config-item { background: #f0fff4; border: 1px solid #9ae6b4; padding: 12px; margin: 10px 0; border-radius: 4px; }
        .sql-query { background: #1a202c; color: #e2e8f0; padding: 15px; border-radius: 4px; font-family: monospace; font-size: 13px; overflow-x: auto; }
        .recommendation { border: 1px solid #e2e8f0; border-radius: 6px; margin: 15px 0; overflow: hidden; }
        .rec-header { padding: 12px 15px; font-weight: bold; }
        .rec-high { background: #fed7d7; color: #c53030; }
        .rec-medium { background: #fefcbf; color: #d69e2e; }
        .rec-low { background: #c6f6d5; color: #38a169; }
        .rec-content { padding: 15px; }
        .badge { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .badge-error { background: #fed7d7; color: #c53030; }
        .badge-config { background: #e6fffa; color: #00a3c4; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1 class="title">🔍 Code Analysis Report</h1>
            <div class="meta">
                <strong>File:</strong> ${analysis.file || 'Unknown'} | 
                <strong>Analysis Time:</strong> ${analysis.timestamp || new Date().toISOString()}
            </div>
        </div>
`;

    // Issue section
    if (analysis.combinedAnalysis?.issue) {
      html += `
        <div class="section">
            <h2 class="section-title">🚨 Issue Identified</h2>
            <div class="issue">
                ${analysis.combinedAnalysis.issue}
            </div>
        </div>
`;
    }

    // Root cause
    if (analysis.combinedAnalysis?.enhancedRootCause) {
      html += `
        <div class="section">
            <h2 class="section-title">🎯 Root Cause</h2>
            <div class="root-cause">
                ${analysis.combinedAnalysis.enhancedRootCause}
            </div>
        </div>
`;
    }

    // Code snippet
    if (analysis.snippet) {
      html += `
        <div class="section">
            <h2 class="section-title">📝 Code Snippet</h2>
            <pre class="code">${this.escapeHtml(analysis.snippet)}</pre>
        </div>
`;
    }

    // Error codes
    if (analysis.basicAnalysis?.errorCodes?.length > 0) {
      html += `
        <div class="section">
            <h2 class="section-title">🔢 Error Codes Found</h2>
`;
      analysis.basicAnalysis.errorCodes.forEach(code => {
        html += `<span class="error-code">${code}</span> `;
      });
      html += `
        </div>
`;
    }

    // Execution trace
    if (analysis.traversalAnalysis?.traceSteps?.length > 0) {
      html += `
        <div class="section">
            <h2 class="section-title">🔍 Execution Trace</h2>
`;
      analysis.traversalAnalysis.traceSteps.forEach(step => {
        html += `
            <div class="trace-step">
                <strong>${step.step}.</strong> ${step.description}
                ${step.details ? `<br><small style="color: #666;">Details: ${step.details}</small>` : ''}
            </div>
`;
      });
      html += `
        </div>
`;
    }

    // Configuration sources
    if (analysis.traversalAnalysis?.configurations) {
      const configs = Object.entries(analysis.traversalAnalysis.configurations);
      if (configs.length > 0) {
        html += `
        <div class="section">
            <h2 class="section-title">⚙️ Configuration Sources</h2>
`;
        configs.forEach(([configRef, configInfo]) => {
          html += `
            <div class="config-item">
                <strong>${configRef}</strong>
                ${configInfo.sqlQuery ? `<div style="margin-top: 10px;"><strong>SQL Query:</strong><div class="sql-query">${configInfo.sqlQuery}</div></div>` : ''}
                ${configInfo.tableName ? `<div><strong>Table:</strong> ${configInfo.tableName}</div>` : ''}
            </div>
`;
        });
        html += `
        </div>
`;
      }
    }

    // Recommendations
    if (analysis.combinedAnalysis?.recommendations?.length > 0) {
      html += `
        <div class="section">
            <h2 class="section-title">💡 Recommendations</h2>
`;
      analysis.combinedAnalysis.recommendations.forEach(rec => {
        const headerClass = `rec-${rec.priority}`;
        html += `
            <div class="recommendation">
                <div class="rec-header ${headerClass}">
                    ${rec.priority.toUpperCase()}: ${rec.title}
                </div>
                <div class="rec-content">
                    <p>${rec.description}</p>
                    <p><strong>Action:</strong> ${rec.action}</p>
                    ${rec.query ? `<div><strong>SQL to verify:</strong><div class="sql-query">${rec.query}</div></div>` : ''}
                </div>
            </div>
`;
      });
      html += `
        </div>
`;
    }

    html += `
    </div>
</body>
</html>
`;

    return html;
  }

  /**
   * Format analysis for markdown documentation
   */
  static formatForMarkdown(analysis) {
    let md = `# 🔍 Enhanced Code Analysis\n\n`;
    
    md += `**File:** \`${analysis.file || 'Unknown'}\`\n`;
    md += `**Analysis Time:** ${analysis.timestamp || new Date().toISOString()}\n\n`;
    
    if (analysis.combinedAnalysis?.issue) {
      md += `## 🚨 Issue Summary\n\n`;
      md += `${analysis.combinedAnalysis.issue}\n\n`;
    }
    
    if (analysis.combinedAnalysis?.enhancedRootCause) {
      md += `## 🎯 Root Cause\n\n`;
      md += `${analysis.combinedAnalysis.enhancedRootCause}\n\n`;
    }
    
    if (analysis.snippet) {
      md += `## 📝 Code Snippet\n\n`;
      md += `\`\`\`java\n${analysis.snippet}\n\`\`\`\n\n`;
    }
    
    if (analysis.basicAnalysis?.errorCodes?.length > 0) {
      md += `## 🔢 Error Codes Found\n\n`;
      analysis.basicAnalysis.errorCodes.forEach(code => {
        md += `- \`${code}\`\n`;
      });
      md += `\n`;
    }
    
    if (analysis.traversalAnalysis?.traceSteps?.length > 0) {
      md += `## 🔍 Execution Trace\n\n`;
      analysis.traversalAnalysis.traceSteps.forEach(step => {
        md += `${step.step}. ${step.description}\n`;
        if (step.details) {
          md += `   - Details: ${step.details}\n`;
        }
      });
      md += `\n`;
    }
    
    if (analysis.traversalAnalysis?.configurations) {
      const configs = Object.entries(analysis.traversalAnalysis.configurations);
      if (configs.length > 0) {
        md += `## ⚙️ Configuration Sources\n\n`;
        configs.forEach(([configRef, configInfo]) => {
          md += `**${configRef}:**\n`;
          if (configInfo.sqlQuery) {
            md += `- Data Source: Database\n`;
            md += `- Query: \`${configInfo.sqlQuery}\`\n`;
          }
          if (configInfo.tableName) {
            md += `- Table: \`${configInfo.tableName}\`\n`;
          }
          md += `\n`;
        });
      }
    }
    
    if (analysis.combinedAnalysis?.recommendations?.length > 0) {
      md += `## 💡 Recommendations\n\n`;
      analysis.combinedAnalysis.recommendations.forEach(rec => {
        md += `### ${rec.priority.toUpperCase()}: ${rec.title}\n\n`;
        md += `${rec.description}\n\n`;
        md += `**Action:** ${rec.action}\n\n`;
        if (rec.query) {
          md += `**SQL to verify:**\n\`\`\`sql\n${rec.query}\n\`\`\`\n\n`;
        }
      });
    }
    
    return md;
  }

  /**
   * Generate a concise summary of the analysis
   */
  static generateSummary(analysis) {
    const summary = {
      hasIssue: !!(analysis.combinedAnalysis?.issue),
      errorCodesFound: analysis.basicAnalysis?.errorCodes?.length || 0,
      configurationsTraced: Object.keys(analysis.traversalAnalysis?.configurations || {}).length,
      recommendationsGenerated: analysis.combinedAnalysis?.recommendations?.length || 0,
      hasTraversalData: !!(analysis.traversalAnalysis && Object.keys(analysis.traversalAnalysis).length > 0),
      analysisSuccessful: !analysis.error
    };

    // Generate text summary
    let textSummary = 'Analysis completed';
    if (summary.hasIssue) {
      textSummary += ` - Issue identified`;
    }
    if (summary.errorCodesFound > 0) {
      textSummary += ` - ${summary.errorCodesFound} error code(s) found`;
    }
    if (summary.configurationsTraced > 0) {
      textSummary += ` - ${summary.configurationsTraced} configuration(s) traced`;
    }
    if (summary.recommendationsGenerated > 0) {
      textSummary += ` - ${summary.recommendationsGenerated} recommendation(s) generated`;
    }

    summary.textSummary = textSummary;
    return summary;
  }

  /**
   * Format readable text (used internally by other formatters)
   */
  static formatReadableText(analysis) {
    let output = `# 🔍 Enhanced Code Analysis\n\n`;
    output += `**File:** ${analysis.file || 'Unknown'}\n`;
    output += `**Analysis Time:** ${analysis.timestamp || new Date().toISOString()}\n\n`;

    if (analysis.combinedAnalysis?.issue) {
      output += `## 🚨 Issue Summary\n`;
      output += `${analysis.combinedAnalysis.issue}\n\n`;
    }

    if (analysis.combinedAnalysis?.enhancedRootCause) {
      output += `## 🎯 Root Cause\n`;
      output += `${analysis.combinedAnalysis.enhancedRootCause}\n\n`;
    }

    if (analysis.snippet) {
      output += `## 📝 Code Snippet\n`;
      output += `\`\`\`java\n${analysis.snippet}\n\`\`\`\n\n`;
    }

    if (analysis.basicAnalysis?.errorCodes?.length > 0) {
      output += `## 🔢 Error Codes Found\n`;
      analysis.basicAnalysis.errorCodes.forEach(code => {
        output += `- \`${code}\`\n`;
      });
      output += `\n`;
    }

    if (analysis.traversalAnalysis?.traceSteps?.length > 0) {
      output += `## 🔍 Execution Trace\n`;
      analysis.traversalAnalysis.traceSteps.forEach(step => {
        output += `${step.step}. ${step.description}\n`;
        if (step.details) {
          output += `   Details: ${step.details}\n`;
        }
      });
      output += `\n`;
    }

    if (analysis.traversalAnalysis?.configurations) {
      const configs = Object.entries(analysis.traversalAnalysis.configurations);
      if (configs.length > 0) {
        output += `## ⚙️ Configuration Sources\n`;
        configs.forEach(([configRef, configInfo]) => {
          output += `**${configRef}:**\n`;
          if (configInfo.sqlQuery) {
            output += `- Data Source: Database\n`;
            output += `- Query: \`${configInfo.sqlQuery}\`\n`;
          }
          if (configInfo.tableName) {
            output += `- Table: \`${configInfo.tableName}\`\n`;
          }
          output += `\n`;
        });
      }
    }

    if (analysis.combinedAnalysis?.recommendations?.length > 0) {
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

    if (analysis.combinedAnalysis?.enhancedTips?.length > 0) {
      output += `## 📋 Additional Tips\n`;
      analysis.combinedAnalysis.enhancedTips.forEach(tip => {
        output += `- ${tip}\n`;
      });
    }

    return output;
  }

  /**
   * Utility function to wrap text to specified width
   */
  static wrapText(text, width, indent = '') {
    const words = text.split(' ');
    let lines = [];
    let currentLine = indent;

    words.forEach(word => {
      if ((currentLine + word).length > width) {
        lines.push(currentLine);
        currentLine = indent + word;
      } else {
        currentLine += (currentLine === indent ? '' : ' ') + word;
      }
    });

    if (currentLine.length > indent.length) {
      lines.push(currentLine);
    }

    return lines.join('\n');
  }

  /**
   * Utility function to escape HTML characters
   */
  static escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, char => map[char]);
  }

  /**
   * Get appropriate formatter based on output type
   */
  static getFormatter(outputType) {
    const formatters = {
      'console': this.formatForConsole,
      'mcp': this.formatForMCP,
      'api': this.formatForAPI,
      'json': this.formatForJSON,
      'html': this.formatForHTML,
      'markdown': this.formatForMarkdown,
      'text': this.formatReadableText
    };

    return formatters[outputType] || this.formatReadableText;
  }

  /**
   * Format analysis using specified output type
   */
  static format(analysis, outputType = 'text', options = {}) {
    const formatter = this.getFormatter(outputType);
    return formatter.call(this, analysis, options);
  }
}

module.exports = { AnalysisFormatter };