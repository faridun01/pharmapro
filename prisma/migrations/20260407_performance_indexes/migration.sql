-- Performance indexes for common filters and joins
CREATE INDEX "Invoice_status_createdAt_idx" ON "Invoice"("status", "createdAt");
CREATE INDEX "Invoice_customerId_createdAt_idx" ON "Invoice"("customerId", "createdAt");
CREATE INDEX "Invoice_paymentStatus_createdAt_idx" ON "Invoice"("paymentStatus", "createdAt");

CREATE INDEX "InvoiceItem_batchId_idx" ON "InvoiceItem"("batchId");
CREATE INDEX "InvoiceItem_productId_batchId_idx" ON "InvoiceItem"("productId", "batchId");

CREATE INDEX "Batch_status_expiryDate_idx" ON "Batch"("status", "expiryDate");
CREATE INDEX "Batch_productId_status_idx" ON "Batch"("productId", "status");

CREATE INDEX "Payment_customerId_paymentDate_idx" ON "Payment"("customerId", "paymentDate");
CREATE INDEX "Payment_invoiceId_paymentDate_idx" ON "Payment"("invoiceId", "paymentDate");

CREATE INDEX "Receivable_customerId_dueDate_idx" ON "Receivable"("customerId", "dueDate");
CREATE INDEX "Receivable_status_dueDate_idx" ON "Receivable"("status", "dueDate");
