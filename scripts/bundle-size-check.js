#!/usr/bin/env node
// bundle-size-check.js
const { execSync } = require('child_process');
const fs = require('fs');

try {
  execSync('npm run build', { stdio: 'inherit' });
  execSync('npm run bundle-analysis', { stdio: 'inherit' });
  const dist = fs.readdirSync('./dist/js');
  let total = 0;
  dist.forEach(f => {
    if (f.endsWith('.js')) {
      const size = fs.statSync(`./dist/js/${f}`).size;
      total += size;
      console.log(`${f}: ${(size/1024).toFixed(1)} KB`);
    }
  });
  console.log(`Total JS (uncompressed): ${(total/1024).toFixed(1)} KB`);
  if (total/1024 > 1000) {
    console.error('⚠️ Bundle size exceeds 1MB!');
    process.exit(1);
  }
} catch (e) {
  process.exit(1);
}
