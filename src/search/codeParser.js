const fs = require('fs');

/**
 * Reads code files (Java, C, etc.) and returns their content.
 */
function parseCodeFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return '';
  }
}

module.exports = { parseCodeFile };