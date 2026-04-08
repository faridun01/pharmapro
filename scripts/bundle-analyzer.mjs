#!/usr/bin/env node

/**
 * Bundle Size Analyzer
 * Analyzes the built bundle and reports on largest chunks
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const manifestPath = path.join(distDir, '.vite', 'manifest.json');

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function analyzeBundle() {
  console.log('\n📊 Bundle Analysis\n');
  console.log(`Scanning: ${distDir}\n`);

  if (!fs.existsSync(distDir)) {
    console.log('❌ dist folder not found. Run "npm run build" first.\n');
    process.exit(1);
  }

  const files = [];
  
  function walkDir(currentPath, fileList) {
    const files = fs.readdirSync(currentPath);
    
    for (const file of files) {
      const filePath = path.join(currentPath, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        walkDir(filePath, fileList);
      } else {
        const relPath = path.relative(distDir, filePath);
        fileList.push({
          path: relPath,
          size: stat.size,
          ext: path.extname(file),
        });
      }
    }
  }

  walkDir(distDir, files);

  // Group by extension
  const byType = {};
  const byFile = [];
  let totalSize = 0;

  for (const file of files) {
    const type = file.ext || 'other';
    if (!byType[type]) {
      byType[type] = { count: 0, size: 0 };
    }
    byType[type].count++;
    byType[type].size += file.size;
    totalSize += file.size;
    byFile.push(file);
  }

  // Sort by size
  byFile.sort((a, b) => b.size - a.size);

  console.log('📁 Bundle Composition by Type:\n');
  Object.entries(byType)
    .sort((a, b) => b[1].size - a[1].size)
    .forEach(([type, data]) => {
      const pct = ((data.size / totalSize) * 100).toFixed(1);
      console.log(`  ${type || 'other'}: ${formatBytes(data.size)} (${pct}%) - ${data.count} files`);
    });

  console.log(`\n📊 Total Bundle Size: ${formatBytes(totalSize)}\n`);

  console.log('🔝 Top 15 Largest Files:\n');
  byFile.slice(0, 15).forEach((file, idx) => {
    const pct = ((file.size / totalSize) * 100).toFixed(1);
    console.log(`  ${idx + 1}. ${file.path} (${formatBytes(file.size)}) ${pct}%`);
  });

  // Warnings for large files
  console.log('\n⚠️  Size Recommendations:\n');
  
  const largeChunks = byFile.filter(f => f.size > 500 * 1024);
  if (largeChunks.length > 0) {
    console.log('  Large chunks (>500KB):');
    largeChunks.forEach(f => {
      console.log(`    - ${f.path} (${formatBytes(f.size)})`);
    });
  }

  const jsSize = (byType['.js'] || {}).size || 0;
  const jsPercent = ((jsSize / totalSize) * 100).toFixed(1);
  console.log(`\n  JS Total: ${formatBytes(jsSize)} (${jsPercent}% of bundle)`);

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Collect files referenced by blocking <script type="module"> tags.
    // In the Vite manifest, isEntry chunks become blocking <script> tags.
    // Their `imports` become <link rel="modulepreload"> (parallel fetch, not blocking parse).
    const blockingFiles = new Set();
    const preloadFiles = new Set();

    const collectChunkFiles = (manifestKey, depth = 0) => {
      const chunk = manifest[manifestKey];
      if (!chunk || !chunk.file) return;
      const file = chunk.file.replace(/\\/g, '/');
      if (depth === 0) {
        // Entry chunk itself: blocking script
        if (!blockingFiles.has(file)) {
          blockingFiles.add(file);
          for (const imported of chunk.imports || []) {
            collectChunkFiles(imported, depth + 1);
          }
        }
      } else {
        // Static imports of entry: modulepreload (parallel, not blocking)
        if (!preloadFiles.has(file) && !blockingFiles.has(file)) {
          preloadFiles.add(file);
          for (const imported of chunk.imports || []) {
            collectChunkFiles(imported, depth + 1);
          }
        }
      }
    };

    Object.keys(manifest)
      .filter((key) => manifest[key]?.isEntry)
      .forEach((key) => collectChunkFiles(key));

    const allInitialFiles = new Set([...blockingFiles, ...preloadFiles]);
    const blockingJsSize = byFile
      .filter((f) => f.ext === '.js' && blockingFiles.has(f.path.replace(/\\/g, '/')))
      .reduce((sum, f) => sum + f.size, 0);
    const preloadJsSize = byFile
      .filter((f) => f.ext === '.js' && preloadFiles.has(f.path.replace(/\\/g, '/')))
      .reduce((sum, f) => sum + f.size, 0);
    const initialJsSize = blockingJsSize + preloadJsSize;
    const asyncJsSize = Math.max(0, jsSize - initialJsSize);

    console.log(`  Blocking JS  : ${formatBytes(blockingJsSize)}  ← parse/exec before first paint`);
    console.log(`  Modulepreload: ${formatBytes(preloadJsSize)}  ← fetched in parallel, needed second`);
    console.log(`  Initial JS   : ${formatBytes(initialJsSize)}  ← total before lazy chunks`);
    console.log(`  Async JS     : ${formatBytes(asyncJsSize)}  ← on-demand`);

    if (blockingJsSize > 250 * 1024) {
      console.log('    ⚠️  Blocking JS exceeds 250 KB; consider further entry-point splitting');
    }
  } else if (jsSize > 500 * 1024) {
    console.log('    ⚠️  Consider code splitting or lazy loading');
  }

  const cssSize = (byType['.css'] || {}).size || 0;
  if (cssSize > 100 * 1024) {
    console.log(`  CSS: ${formatBytes(cssSize)}`);
    console.log('    ⚠️  Consider purging unused Tailwind styles\n');
  }

  console.log('✅ Build complete!\n');
}

analyzeBundle();
