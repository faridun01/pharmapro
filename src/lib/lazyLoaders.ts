/**
 * Lazy loading utilities for heavy libraries
 * These libraries are only loaded when needed
 */

let xlsxCache: typeof import('xlsx') | null = null;
let jspdfCache: typeof import('jspdf').default | null = null;
let autoTableCache: any = null;

/**
 * Lazy load XLSX library (180 KB)
 * Only loaded when user wants to import/export Excel files
 */
export async function loadXlsx() {
  if (xlsxCache) {
    return xlsxCache;
  }
  
  try {
    xlsxCache = await import('xlsx');
    return xlsxCache;
  } catch (error) {
    console.error('Failed to load XLSX library:', error);
    throw new Error('Excel functionality is temporarily unavailable');
  }
}

/**
 * Lazy load jsPDF library (300 KB combined)
 * Only loaded when user wants to export PDF
 */
export async function loadJsPdf() {
  if (jspdfCache) {
    return jspdfCache;
  }

  try {
    const module = await import('jspdf');
    jspdfCache = module.default;
    return jspdfCache;
  } catch (error) {
    console.error('Failed to load jsPDF library:', error);
    throw new Error('PDF export is temporarily unavailable');
  }
}

/**
 * Lazy load jsPDF-AutoTable plugin
 */
export async function loadAutoTable() {
  if (autoTableCache) {
    return autoTableCache;
  }

  try {
    autoTableCache = await import('jspdf-autotable');
    return autoTableCache;
  } catch (error) {
    console.error('Failed to load AutoTable plugin:', error);
    throw new Error('PDF table formatting is temporarily unavailable');
  }
}

/**
 * Combined export convenience function for PDF generation
 */
export async function loadPdfDependencies() {
  const [jspdf, autoTable] = await Promise.all([
    loadJsPdf(),
    loadAutoTable(),
  ]);
  return { jspdf, autoTable };
}
