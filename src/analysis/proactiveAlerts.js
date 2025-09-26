const { callLLM } = require('../integration/llmClient');

/**
 * LLM-powered: Scans codebase for risky patterns.
 */
async function scanForPitfalls(files) {
  const fileSummaries = files.map(f => `${f.name}:\n${f.content.slice(0, 500)}`).join('\n---\n');
  const prompt = `
You are a static analyzer. Scan the following code files for common pitfalls, deprecated APIs, or dangerous usage.

Files:
${fileSummaries}

Respond with a list of warnings, file names, and improvement suggestions:
`;
  return await callLLM(prompt);
}

module.exports = { scanForPitfalls };