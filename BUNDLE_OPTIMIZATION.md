# Bundle Optimization Guide

## Current Heavy Dependencies

### 1. **tesseract.js** (~9 MB)
- **Current use**: OCR for invoice PDF scanning
- **Problem**: Very large library with WASM binaries
- **Alternatives**:
  - **Google Cloud Vision API** (already using @google/genai) - outsource OCR to backend
  - **Cloud-based OCR services** - reduce client-side payload
  - **Lazy load tesseract** - only load when OCR modal opens (not on initial bundle)

**Recommendation**: Move OCR processing to backend or lazy-load the library.

```typescript
// Lazy load only when needed
const loadTesseract = () => import('tesseract.js').then(m => m.default);
```

### 2. **jspdf + jspdf-autotable** (~300 KB combined)
- **Current use**: PDF generation for reports and invoices
- **Problem**: Large and slow PDF generation
- **Alternatives**:
  - **Backend PDF generation** (more efficient)
  - **html2canvas + jspdf for simpler use cases**
  - **Server-side rendering** with headless browser

**Recommendation**: Generate PDFs on backend (faster, smaller bundle).

### 3. **recharts** (~250 KB)
- **Current use**: Financial reports charts
- **Problem**: Full charting library for simple line/bar charts
- **Alternatives**:
  - **Chart.js** (~60 KB) - lighter alternative
  - **ApexCharts** (~150 KB) - more performant
  - **Native SVG charts** - custom implementation for simple needs
  - **Lightweight alternative**: `@nivo/line` or custom solution

**Recommendation**: Consider Chart.js for smaller footprint or move charts to backend-rendered images.

### 4. **@google/genai** (~150 KB)
- **Current use**: Google Gemini API integration
- **Problem**: Network dependency, adds to bundle
- **Alternatives**:
  - **Backend API wrapper** - call your own backend endpoint instead
  - **Lazy load** - only when AI features are used

**Recommendation**: Create backend proxy endpoint to reduce client-side dependency.

### 5. **xlsx** (~180 KB)
- **Current use**: Excel import/export
- **Problem**: Processing on client is memory-heavy for large files
- **Alternatives**:
  - **Backend processing** - upload and process on server
  - **Lazy load** - only when modal opens
  - **simple-excel** (~50 KB) for basic operations

**Recommendation**: Lazy-load with import(), or move complex operations to backend.

## Optimization Strategies

### Immediate (implement now)
- ✅ Minify + Tree-shake for production
- ✅ Code splitting by vendor
- ✅ Disable sourcemaps in production
- ✅ Remove console logs in production
- ✅ Lazy load modals with import()

### Short-term (this sprint)
- Move PDF generation to backend
- Lazy-load ocr features
- Replace recharts with Chart.js or custom solution
- Create backend proxy for AI features

### Long-term (future optimization)
- Move all heavy processing to backend
- Build mobile-optimized version
- Consider micro-frontend architecture
- Implement Service Worker caching

## Recommended Bundle Targets

- **Initial JS**: < 300 KB (before gzip)
- **Total with vendor**: < 1 MB (before gzip)
- **After gzip**: < 300 KB total

Current estimate: 1.2-1.5 MB (unminified) → 350-450 KB (minified+gzip)

## Monitoring

Run `npm run bundle-analysis` after each build to track bundle size.

### Expected Sizes:
```
dist/js/vendor-react.*.js          ~200 KB gzipped
dist/js/vendor-charts.*.js         ~80 KB gzipped
dist/js/vendor-ocr.*.js            ~5 MB (lazy-loaded)
dist/js/vendor-pdf.*.js            ~100 KB gzipped (lazy-loaded)
dist/js/vendor-excel.*.js          ~50 KB gzipped (lazy-loaded)
dist/js/main.*.js                  ~150 KB gzipped
```

## Build Commands

```bash
# Development - fast, no minification
npm run dev

# Production - full optimization
npm run build:prod

# Analyze bundle
npm run bundle-analysis

# Check types
npm run type-check
```
