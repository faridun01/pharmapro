# PharmaPro Wholesale DB Migration Plan

## Goal

Evolve the current pharmacy desktop schema into a full wholesale pharmacy schema without breaking the existing sales, returns, write-off, OCR, and warehouse flows in one step.

## Phase 1: Additive schema changes

These changes are safe because they mostly add new tables and optional fields:

- add product master-data lookups
- add customer master-data
- add purchase invoice entities
- add generic payments
- add receivable/payable entities
- extend product and batch records with wholesale fields

## Phase 2: Dual-write transition

Update backend services so new operations write to both:

- current tables used by UI
- new wholesale/accounting tables

This keeps the app working while reports and screens are migrated.

## Phase 3: Move business flows

Move these flows to new entities:

1. purchase import -> `PurchaseInvoice` + `PurchaseInvoiceItem`
2. wholesale sale -> `Customer` + `Invoice.customerId`
3. debt/payment tracking -> `Payment` + `Receivable` + `Payable`
4. reservation -> `Reservation`

## Phase 4: Normalize stock model

Gradually stop relying on product-level aggregate stock as the only source of truth:

- keep `Product.totalStock` as cached aggregate
- use `Batch.currentQty`, `Batch.reservedQty`, `Batch.availableQty`
- later introduce balance rebuild jobs or DB-level consistency checks

## Recommended implementation order

1. add schema and migration
2. update seed/bootstrap data
3. update purchase import flow
4. update customer-aware sales flow
5. update payment/debt flow
6. build reports from new financial tables

## Compatibility notes

- keep `Invoice.customer` string for now
- add `Invoice.customerId` in parallel
- keep `Batch.quantity` and `Batch.costBasis` for existing code
- add `Batch.initialQty`, `Batch.currentQty`, `Batch.purchasePrice` and migrate logic gradually

## Next backend changes after schema update

- `sales.service.ts` should create/update `Receivable` when payment is not fully settled
- OCR import should create a `PurchaseInvoice`
- supplier returns should affect `Payable`
- customer returns should affect `Receivable` or refund records depending on flow
