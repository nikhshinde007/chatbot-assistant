const { callLLM } = require('../integration/llmClient');

/**
 * LLM-powered fix suggestion module.
 */
async function suggestFix({ code, log, doc }) {
  const prompt = `
You are a code repair assistant. Given this code, error log, and documentation, suggest one or more code fixes or configuration changes.
Be concise and provide code snippets where appropriate.

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

Respond with fix suggestions and code snippets:
`;
  return await callLLM(prompt);
}

module.exports = { suggestFix };