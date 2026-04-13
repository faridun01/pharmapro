import { FinanceReport, ReportViewMode } from './types';
import { loadXlsx } from '../../../lib/lazyLoaders';
import { toNumber } from './utils';

export const exportReportToXlsx = async (report: FinanceReport, viewMode: ReportViewMode) => {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  if (viewMode === 'detailed') {
    const detailRows: Array<Array<string | number>> = [
      ['Детализированный отчет по продажам'],
      [`Период: ${new Date(report.currentMonthSales.from).toLocaleDateString('ru-RU')} - ${new Date(report.currentMonthSales.to).toLocaleDateString('ru-RU')}`],
      [],
      ['Время', 'Накладная', 'Покупатель', 'Товар', 'SKU', 'Кол-во', 'Цена', 'Сумма', 'Прибыль']
    ];

    for (const sale of report.currentMonthSales.saleDetails) {
      for (const item of sale.items) {
        detailRows.push([
          new Date(sale.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          sale.invoiceNo,
          sale.customer,
          item.productName,
          item.sku,
          toNumber(item.quantity),
          toNumber(item.unitPrice),
          toNumber(item.lineTotal),
          toNumber(item.lineProfit)
        ]);
      }
    }

    const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
    XLSX.utils.book_append_sheet(wb, detailSheet, 'Детализация');
  } else {
    // Summary Export
    const summaryData = [
      ['Показатель', 'Значение'],
      ['Выручка (гросс)', report.kpi.revenueGross],
      ['Возвраты', report.kpi.customerReturnsAmount],
      ['Чистая выручка', report.kpi.netRevenue],
      ['Себестоимость', report.kpi.cogs],
      ['Валовая прибыль', report.kpi.grossProfit],
      ['Маржа %', report.kpi.grossMarginPct],
      ['Дебиторская задолженность', report.debts.receivableTotal],
      ['Кредиторская задолженность', report.debts.payableTotal],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Сводка');

    const inventoryRows = [
      ['Товар', 'SKU', 'Остаток', 'Продано', 'Себестоимость (всего)', 'Розничная стоимость (всего)'],
      ...report.inventory.details.map(d => [
        d.name, d.sku, d.totalStock, d.soldUnits, d.costValue, d.retailValue
      ])
    ];
    const inventorySheet = XLSX.utils.aoa_to_sheet(inventoryRows);
    XLSX.utils.book_append_sheet(wb, inventorySheet, 'Склад');
  }

  XLSX.writeFile(wb, `PharmaPro_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
};
