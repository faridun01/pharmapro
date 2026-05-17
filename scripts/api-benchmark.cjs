#!/usr/bin/env node
// api-benchmark.cjs
const axios = require('axios');
const endpoints = [
  '/api/health',
  '/api/products',
  '/api/invoices',
  '/api/reports/metrics/dashboard',
];
const base = 'http://localhost:3921';
(async () => {
  for (const ep of endpoints) {
    const url = base + ep;
    const t0 = Date.now();
    try {
      const res = await axios.get(url);
      const t1 = Date.now();
      console.log(`${ep}: ${t1-t0} ms, status ${res.status}`);
    } catch (e) {
      console.error(`${ep}: ERROR`, e.response?.status || e.message);
    }
  }
})();
