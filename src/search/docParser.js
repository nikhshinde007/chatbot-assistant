const fs = require('fs');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const path = require('path');

async function parseDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function parsePdf(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
}

async function parseDocumentFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    return await parseDocx(filePath);
  } else if (ext === '.pdf') {
    return await parsePdf(filePath);
  } else if (ext === '.doc') {
    return '[.doc parsing not supported. Please convert to .docx]';
  }
  return '';
}

module.exports = { parseDocumentFile };