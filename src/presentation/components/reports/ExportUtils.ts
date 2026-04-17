import { FinanceReport, ReportViewMode } from './types';
import { loadXlsx } from '../../../lib/lazyLoaders';
import { toNumber } from './utils';

export const exportReportToXlsx = async (report: FinanceReport, viewMode: ReportViewMode) => {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  if (viewMode === 'detailed') {
    const detailRows: Array<Array<string | number>> = [
      ['ДЕТАЛИЗИРОВАННЫЙ ОТЧЕТ ПО ПРОДАЖАМ (БИЗНЕС-АНАЛИТИКА)'],
      [`Период: ${new Date(report.currentMonthSales.from).toLocaleDateString('ru-RU')} - ${new Date(report.currentMonthSales.to).toLocaleDateString('ru-RU')}`],
      [],
      ['Товар', 'SKU', 'Кол-во', 'Цена прод.', 'Себест. ед.', 'Сумма прод.', 'Прибыль']
    ];

    let grandTotalQty = 0;
    let grandTotalCostBasis = 0;
    let grandTotalRevenue = 0;
    let grandTotalProfit = 0;

    for (const sale of report.currentMonthSales.saleDetails) {
      for (const item of sale.items) {
        const qty = toNumber(item.quantity);
        const costBasis = toNumber(item.unitCost);
        const revenue = toNumber(item.lineTotal);
        const profit = toNumber(item.lineProfit);

        detailRows.push([
          item.productName,
          item.sku,
          qty,
          toNumber(item.unitPrice),
          costBasis,
          revenue,
          profit
        ]);

        grandTotalQty += qty;
        grandTotalCostBasis += (costBasis * qty);
        grandTotalRevenue += revenue;
        grandTotalProfit += profit;
      }
    }

    // Add Empty spacer row
    detailRows.push([]);
    
    // Add Totals row
    detailRows.push([
      'ИТОГО ПО ОТЧЕТУ',
      '',
      grandTotalQty,
      '',
      grandTotalCostBasis, // Total cost sum
      grandTotalRevenue,   // Total sales sum
      grandTotalProfit     // Total profit sum
    ]);

    const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
    
    // Beautify: Set column widths
    detailSheet['!cols'] = [
      { wch: 45 }, // Товар
      { wch: 15 }, // SKU
      { wch: 10 }, // Кол-во
      { wch: 15 }, // Цена прод.
      { wch: 15 }, // Себест. ед.
      { wch: 18 }, // Сумма прод.
      { wch: 18 }, // Прибыль
    ];

    XLSX.utils.book_append_sheet(wb, detailSheet, 'Детализация');

    // Add Product Totals Sheet
    const productRows: Array<Array<string | number>> = [
      ['ИТОГИ ПО ТОВАРАМ ЗА ПЕРИОД'],
      [],
      ['Товар', 'SKU', 'Продано (ед.)', 'Кол-во продаж', 'Выручка', 'Прибыль']
    ];
    for (const p of report.currentMonthSales.productTotals) {
      productRows.push([
        p.name,
        p.sku,
        p.soldUnits,
        p.salesCount,
        toNumber(p.revenue),
        toNumber(p.profit)
      ]);
    }
    const productSheet = XLSX.utils.aoa_to_sheet(productRows);
    productSheet['!cols'] = [{ wch: 45 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, productSheet, 'По товарам');
  } else {
    // Summary Export
    const summaryData = [
      ['Финансовая сводка деятельности'],
      [],
      ['Показатель', 'Значение'],
      ['Выручка (гросс)', report.kpi.revenueGross],
      ['Возвраты', report.kpi.retailReturnsAmount],
      ['Чистая выручка', report.kpi.netRevenue],
      ['Себестоимость (COGS)', report.kpi.cogs],
      ['Валовая прибыль', report.kpi.grossProfit],
      ['Маржа %', report.kpi.grossMarginPct],
      ['Кредиторская задолженность', report.debts.payableTotal],
      ['Дебиторская задолженность', report.debts.receivableTotal],
      ['Операционная прибыль', report.kpi.operatingProfit],
      ['Денежный поток (Net)', report.cashflow.net],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet['!cols'] = [{ wch: 30 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Сводка');

    const inventoryRows = [
      ['Состояние склада'],
      [],
      ['Товар', 'SKU', 'Остаток', 'Себестоимость', 'Розничная стоимость'],
      ...report.inventory.details.map(d => [
        d.name, d.sku, d.totalStock, d.costValue, d.retailValue
      ])
    ];
    const inventorySheet = XLSX.utils.aoa_to_sheet(inventoryRows);
    inventorySheet['!cols'] = [{ wch: 45 }, { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, inventorySheet, 'Склад');
  }

  XLSX.writeFile(wb, `PharmaPro_Detailed_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
};
