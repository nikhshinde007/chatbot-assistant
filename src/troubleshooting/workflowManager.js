const { callLLM } = require('../integration/llmClient');

/**
 * LLM-powered: Suggests a step-by-step workflow for diagnosis/fix.
 */
async function getWorkflowFor(errorType, context = "") {
  const prompt = `
You are an expert troubleshooter. For this error type "${errorType}", and the following context, generate a step-by-step diagnostic or repair workflow.

Context:
${context}

Respond as a numbered checklist:
`;
  return await callLLM(prompt);
}

module.exports = { getWorkflowFor };