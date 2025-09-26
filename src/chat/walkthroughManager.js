const { callLLM } = require('../integration/llmClient');

/**
 * LLM-powered: Next best step in chat.
 */
async function getNextStep(context) {
  const prompt = `
You are a conversational diagnostic assistant. Given the current context (state) of a troubleshooting session, suggest the next best question or action for the user.

Context:
${JSON.stringify(context, null, 2)}

Respond with a short actionable prompt, e.g., "Have you tried restarting the server?"
`;
  return await callLLM(prompt);
}

module.exports = { getNextStep };