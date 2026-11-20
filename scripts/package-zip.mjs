import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const distDir = path.resolve('dist');
fs.mkdirSync(distDir, { recursive: true });

const stageDir = path.join(distDir, 'stage');
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

const INCLUDE = ['manifest.json', 'icons', 'src'];
for (const item of INCLUDE) {
  fs.cpSync(path.resolve(item), path.join(stageDir, item), { recursive: true });
}

const outZip = path.join(distDir, `ai-bookmark-organizer-v${manifest.version}.zip`);
fs.rmSync(outZip, { force: true });

if (process.platform === 'win32') {
  execFileSync('pwsh', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${path.join(stageDir, '*')}' -DestinationPath '${outZip}' -Force`,
  ], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', outZip, '.'], { cwd: stageDir, stdio: 'inherit' });
}

fs.rmSync(stageDir, { recursive: true, force: true });
console.log('Created Chrome Web Store package:', outZip);
