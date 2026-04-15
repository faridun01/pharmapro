#!/usr/bin/env node
// lighthouse-ci.js
const { execSync } = require('child_process');

const url = process.argv[2] || 'http://localhost:3000';
try {
  execSync(`npx lighthouse ${url} --output html --output-path ./lighthouse-report.html --quiet --chrome-flags=--headless`, { stdio: 'inherit' });
  console.log('Lighthouse report saved to lighthouse-report.html');
} catch (e) {
  console.error('Lighthouse run failed:', e.message);
  process.exit(1);
}
