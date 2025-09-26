// responseValidator.js - Module for validating and correcting responses
const { TableRegistry } = require('../registry/tableRegistry');

class ResponseValidator {
  constructor(tableRegistry) {
    this.tableRegistry = tableRegistry;
    this.validationStats = {
      totalValidations: 0,
      issuesFound: 0,
      issuesCorrected: 0,
      rejectedResponses: 0
    };
  }

  /**
   * Validate a response before sending it back
   */
  async validateResponse(response, options = {}) {
    const { 
      autoCorrect = true, 
      rejectOnError = false,
      includeInstructions = true 
    } = options;
    
    this.validationStats.totalValidations++;
    
    // Extract text content from response
    const textContent = this.extractTextContent(response);
    
    if (!textContent) {
      return { valid: true, response };
    }
    
    // Validate table names in the content
    const validation = this.tableRegistry.validateTextForTables(textContent);
    
    if (validation.valid) {
      return { valid: true, response };
    }
    
    this.validationStats.issuesFound++;
    
    // Handle invalid tables
    if (rejectOnError) {
      this.validationStats.rejectedResponses++;
      return {
        valid: false,
        error: this.buildErrorMessage(validation),
        response: null
      };
    }
    
    // Try to auto-correct if enabled
    if (autoCorrect) {
      const corrected = this.attemptAutoCorrection(response, validation);
      if (corrected.success) {
        this.validationStats.issuesCorrected++;
        
        // Add note about correction
        if (includeInstructions) {
          corrected.response = this.addCorrectionNote(corrected.response, validation);
        }
        
        return {
          valid: true,
          corrected: true,
          response: corrected.response,
          corrections: corrected.corrections
        };
      }
    }
    
    // Add warning to response if we can't correct
    if (includeInstructions) {
      response = this.addValidationWarning(response, validation);
    }
    
    return {
      valid: false,
      response,
      issues: validation.issues
    };
  }

  /**
   * Extract text content from various response formats
   */
  extractTextContent(response) {
    if (typeof response === 'string') {
      return response;
    }
    
    if (response.content) {
      if (Array.isArray(response.content)) {
        return response.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n');
      }
      if (typeof response.content === 'string') {
        return response.content;
      }
    }
    
    if (response.text) {
      return response.text;
    }
    
    if (response.data) {
      return JSON.stringify(response.data);
    }
    
    return JSON.stringify(response);
  }

  /**
   * Build error message for invalid tables
   */
  buildErrorMessage(validation) {
    let message = `\n⚠️ Table Validation Failed\n`;
    message += `${'='.repeat(50)}\n`;
    
    for (const issue of validation.issues) {
      message += `\n❌ Invalid table: "${issue.table}"\n`;
      message += `   Reason: ${issue.message}\n`;
      
      if (issue.suggestions && issue.suggestions.length > 0) {
        message += `   Did you mean: ${issue.suggestions.join(', ')}?\n`;
      }
    }
    
    message += `\n${'='.repeat(50)}\n`;
    message += `✅ Available tables in source code:\n`;
    
    const tables = this.tableRegistry.getTableList();
    const displayTables = tables.slice(0, 20);
    
    for (let i = 0; i < displayTables.length; i += 4) {
      const row = displayTables.slice(i, i + 4);
      message += `   ${row.join(', ')}\n`;
    }
    
    if (tables.length > 20) {
      message += `   ... and ${tables.length - 20} more\n`;
    }
    
    return message;
  }

  /**
   * Attempt to auto-correct invalid table names
   */
  attemptAutoCorrection(response, validation) {
    const corrections = [];
    let correctedContent = this.extractTextContent(response);
    
    for (const issue of validation.issues) {
      if (issue.suggestions && issue.suggestions.length > 0) {
        // Use the first suggestion
        const replacement = issue.suggestions[0];
        const regex = new RegExp(`\\b${issue.table}\\b`, 'gi');
        
        correctedContent = correctedContent.replace(regex, replacement);
        corrections.push({
          original: issue.table,
          replacement,
          reason: issue.reason
        });
      }
    }
    
    if (corrections.length === 0) {
      return { success: false };
    }
    
    // Rebuild response with corrected content
    const correctedResponse = this.rebuildResponse(response, correctedContent);
    
    return {
      success: true,
      response: correctedResponse,
      corrections
    };
  }

  /**
   * Rebuild response with corrected content
   */
  rebuildResponse(originalResponse, correctedContent) {
    if (typeof originalResponse === 'string') {
      return correctedContent;
    }
    
    const response = JSON.parse(JSON.stringify(originalResponse)); // Deep clone
    
    if (response.content) {
      if (Array.isArray(response.content)) {
        // Update text content items
        response.content = response.content.map(item => {
          if (item.type === 'text') {
            return { ...item, text: correctedContent };
          }
          return item;
        });
      } else if (typeof response.content === 'string') {
        response.content = correctedContent;
      }
    } else if (response.text) {
      response.text = correctedContent;
    } else if (response.data) {
      try {
        response.data = JSON.parse(correctedContent);
      } catch {
        response.data = correctedContent;
      }
    }
    
    return response;
  }

  /**
   * Add correction note to response
   */
  addCorrectionNote(response, validation) {
    const note = {
      type: 'validation_note',
      message: 'Table names were automatically corrected to match source code.',
      corrections: validation.issues.map(i => ({
        invalid: i.table,
        suggestion: i.suggestions?.[0] || 'no suggestion'
      }))
    };
    
    if (typeof response === 'object' && response.content && Array.isArray(response.content)) {
      response.content.unshift({
        type: 'text',
        text: `ℹ️ Note: Table names were auto-corrected to match actual source code tables.\n`
      });
    }
    
    return response;
  }

  /**
   * Add validation warning to response
   */
  addValidationWarning(response, validation) {
    const warning = this.buildErrorMessage(validation);
    
    if (typeof response === 'string') {
      return warning + '\n' + response;
    }
    
    if (response.content && Array.isArray(response.content)) {
      response.content.unshift({
        type: 'text',
        text: warning
      });
    }
    
    return response;
  }

  /**
   * Get validation statistics
   */
  getStatistics() {
    return {
      ...this.validationStats,
      successRate: this.validationStats.totalValidations > 0 
        ? ((this.validationStats.totalValidations - this.validationStats.issuesFound) / this.validationStats.totalValidations * 100).toFixed(2) + '%'
        : 'N/A',
      correctionRate: this.validationStats.issuesFound > 0
        ? (this.validationStats.issuesCorrected / this.validationStats.issuesFound * 100).toFixed(2) + '%'
        : 'N/A'
    };
  }

  /**
   * Reset statistics
   */
  resetStatistics() {
    this.validationStats = {
      totalValidations: 0,
      issuesFound: 0,
      issuesCorrected: 0,
      rejectedResponses: 0
    };
  }
}

module.exports = { ResponseValidator };