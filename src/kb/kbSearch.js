const { callLLM } = require('../integration/llmClient');

/**
 * LLM-powered KB search: Suggests relevant links, docs, SO, etc.
 */
async function searchKnowledgeBase(query) {
  const prompt = `
You are a technical search assistant. Given the following query, suggest the most relevant documentation links, Stack Overflow threads, or GitHub Issues.

Query:
${query}

Respond with a list of URLs and one-line descriptions:
`;
  return await callLLM(prompt);
}

module.exports = { searchKnowledgeBase };