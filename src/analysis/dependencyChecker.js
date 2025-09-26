const fs = require('fs');
const { callLLM } = require('../integration/llmClient');

/**
 * LLM-powered: Checks dependency/environment files for problems.
 */
async function analyzeDependencies(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const prompt = `
You are a build and environment expert. Analyze this dependency/configuration file for problems, outdated versions, or missing dependencies. Suggest improvements.

File (${filePath}):
"""
${content}
"""
`;
  return await callLLM(prompt);
}

module.exports = { analyzeDependencies };