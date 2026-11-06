import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function getJsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (file === 'node_modules' || file === 'coverage' || file === 'dist') {
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      getJsFiles(fullPath, fileList);
    } else if (file.endsWith('.js')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const targets = [
  path.join(rootDir, 'src'),
  path.join(rootDir, 'db'),
  path.join(rootDir, 'tests'),
  path.join(rootDir, 'scripts'),
];

let checkedCount = 0;
let errorCount = 0;

for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  const files = getJsFiles(target);
  for (const file of files) {
    checkedCount++;
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (res.status !== 0) {
      console.error(`[Lint Error] ${file}:\n${res.stderr}`);
      errorCount++;
    }
  }
}

if (errorCount > 0) {
  console.error(`Lint check failed with ${errorCount} error(s).`);
  process.exit(1);
} else {
  console.log(`[Lint] Clean syntax check passed for ${checkedCount} JavaScript files.`);
  process.exit(0);
}
