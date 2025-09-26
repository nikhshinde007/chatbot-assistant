const { callLLM } = require('../integration/llmClient');

/**
 * LLM-powered: Translates text to target language.
 */
async function translate(text, lang) {
  const prompt = `
You are a translator. Translate the following text into ${lang}. Keep code blocks unchanged.

Text:
"""
${text}
"""
`;
  return await callLLM(prompt);
}

module.exports = { translate };