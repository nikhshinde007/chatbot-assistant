const { callLLM } = require('../integration/llmClient');

/**
 * LLM-powered: Adjusts response for user's level/preferences.
 */
async function personalizeResponse(user, response) {
  const prompt = `
You are a helpful assistant. Given this response and user profile, rephrase the response to match their experience level and preferences.

User:
${JSON.stringify(user, null, 2)}

Response:
"""
${response}
"""
`;
  return await callLLM(prompt);
}

module.exports = { personalizeResponse };