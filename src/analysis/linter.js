const { callLLM } = require('../integration/llmClient');
const fs = require('fs');

/**
 * LLM-powered code review/linting.
 * Reads the code file, prompts LLM for review.
 */
async function runLinter(filePath, lang) {
  const code = fs.readFileSync(filePath, 'utf8');
  const prompt = `
You are an expert ${lang} code reviewer. Review the following code for style, best practices, security, and correctness. List any issues and improvements.

Code:
"""
${code}
"""

Respond with a list of issues and suggestions:
`;
  return await callLLM(prompt);
}

module.exports = { runLinter };