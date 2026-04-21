const { execSync } = require('child_process');
const fs = require('fs');

async function runPython(filePath) {
  // ─── DEBUG: Log file content for debugging ───────────────────────────────
  const rawContent = fs.readFileSync(filePath, 'utf-8');
  console.log('=== FILE DEBUG INFO ===');
  console.log('File size:', rawContent.length, 'bytes');
  console.log('First 500 chars (with escape codes):');
  console.log(JSON.stringify(rawContent.substring(0, 500)));
  console.log('Lines around line 12:');
  const lines = rawContent.split('\n');
  for (let i = 8; i <= 15 && i < lines.length; i++) {
    console.log(`Line ${i + 1}: ${JSON.stringify(lines[i])}`);
  }
  console.log('=== END DEBUG ===');
  
  // ─── SYNTAX CHECK FIRST ────────────────────────────────────────────────────
  try {
    execSync(`python -m py_compile "${filePath}"`, { encoding: 'utf-8' });
    console.log('✅ Python syntax validation passed');
  } catch (syntaxError) {
    console.error('❌ Python syntax validation failed:');
    console.error(syntaxError.stderr || syntaxError.message);
    throw new Error(`Syntax Error: ${syntaxError.stderr || syntaxError.message}`);
  }
  
  // ─── RUN IF SYNTAX OK ──────────────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const python = spawn('python', [filePath], {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    let output = '';
    let errorOutput = '';
    
    python.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    python.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(errorOutput || `Process exited with code ${code}`));
      }
    });
    
    python.on('error', (err) => {
      reject(err);
    });
  });
}

module.exports = runPython;