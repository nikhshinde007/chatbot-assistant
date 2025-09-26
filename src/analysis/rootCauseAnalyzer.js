const { callLLM } = require('../integration/llmClient');
const { EnhancedTraversalAnalyzer } = require('../analysis/enhancedTraversalAnalyzer');

/**
 * Gets a root cause analysis from code, log, and doc context.
 */
async function analyzeRootCause({ code, log, doc }) {
  const prompt = `
You are a senior software developer specializing in root cause analysis. Analyze the following information to determine the root cause of the issue.

Code:
"""
${code}
"""

Log:
"""
${log}
"""

Documentation:
"""
${doc}
"""

Provide a detailed root cause analysis including:
1. Primary cause of the issue
2. Contributing factors
3. Evidence from the provided information
4. Recommended investigation steps
  `;

  let baseAnalysis;
  try {
    baseAnalysis = await callLLM(prompt);
  } catch (error) {
    throw new Error(`LLM analysis failed: ${error.message}`);
  }

  // Try enhanced traversal if available
  let dataFlowAnalysis = null;
  if (EnhancedTraversalAnalyzer) {
    try {
      const traversalAnalyzer = new EnhancedTraversalAnalyzer();
      dataFlowAnalysis = await traversalAnalyzer.analyzeDataSources(
        code,
        [],
        process.env.DEFAULT_SOURCE_DIR || './src'
      );
    } catch (error) {
      console.warn('Enhanced traversal failed:', error.message);
    }
  }

  return {
    rootCause: baseAnalysis,
    dataFlowAnalysis,
    enhancedAnalysisAvailable: !!EnhancedTraversalAnalyzer,
    timestamp: new Date().toISOString()
  };
}

module.exports = { analyzeRootCause };