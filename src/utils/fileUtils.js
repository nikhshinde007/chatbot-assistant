const fs = require('fs');
const path = require('path');

/**
 * Recursively gets all files in a directory matching the given extensions.
 */
function getAllFiles(dir, exts, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, exts, fileList);
    } else if (exts.length === 0 || exts.includes(path.extname(fullPath).toLowerCase())) {
      fileList.push(fullPath);
    }
  });
  return fileList;
}

module.exports = { getAllFiles };