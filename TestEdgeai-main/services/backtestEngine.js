// services/backtestEngine.js
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function runBacktestWithCode(code, sessionId) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(__dirname, '../temp');
    const filePath = path.join(tempDir, `strategy_${sessionId}.py`);
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, code);
    
    exec(`python "${filePath}"`, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

module.exports = { runBacktestWithCode };