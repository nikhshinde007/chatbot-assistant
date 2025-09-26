const { callLLM } = require('../integration/llmClient');

/**
 * LLM-powered: Generates a mermaid call graph from code snippet.
 */
async function generateCallGraph(code) {
  const prompt = `
You are a code visualizer. Analyze this code and generate a Mermaid.js call graph diagram showing main functions and their relationships.

Code:
"""
${code}
"""

Respond only with the Mermaid graph code block.
`;
  return await callLLM(prompt);
}

module.exports = { generateCallGraph };