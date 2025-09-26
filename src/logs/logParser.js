/**
 * LLM-powered: Extracts and summarizes error patterns, stack traces, and suggests error types.
 */
function extractLogSummary(logContent) {
  // Simple regex for stack traces and errors; pass full context to LLM for diagnosis
  const stackTraces = [...logContent.matchAll(/at\s[^\n]+:\d+:\d+/g)].map(m => m[0]);
  const errors = [...logContent.matchAll(/(Exception|Error|FAIL|Segmentation fault).*/gi)].map(m => m[0]);
  return { stackTraces, errors, logBody: logContent.slice(0, 2000) }; // limit raw log for prompt
}

module.exports = { extractLogSummary };