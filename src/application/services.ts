import { 
  Product, 
  Batch, 
  BatchMovement, 
  MovementType, 
  IProductRepository, 
  ILogger, 
  IInvoiceRepository, 
  Invoice, 
  InvoiceItem,
  ISupplierRepository,
  Supplier
} from '../core/domain';

/**
 * Data Transfer Objects (DTOs)
 */
export interface SaleItemDTO {
  productId: string;
  quantity: number;
  sellingPrice: number;
}

export interface TransactionDTO {
  items: SaleItemDTO[];
  discountAmount: number;
  taxAmount: number;
  total: number;
  paymentType: 'CASH' | 'CARD' | 'CREDIT';
  customer?: string;
  customerId?: string;
  paidAmount?: number;
  userId: string;
  date: Date;
}

/**
 * Inventory Service - Orchestrates inventory use cases.
 */
export class InventoryService {
  constructor(
    private productRepository: IProductRepository,
    private logger: ILogger
  ) {}

  async restock(productId: string, batchData: Omit<Batch, 'movements' | 'status'>): Promise<void> {
    const product = await this.productRepository.getById(productId);
    if (!product) throw new Error(`Product ${productId} not found`);

    const newMovement: BatchMovement = {
      id: `m-${Date.now()}`,
      type: 'RESTOCK',
      quantity: batchData.quantity,
      date: new Date(),
      description: `Restock from supplier: ${batchData.supplierName || 'Unknown'}`
    };

    const newBatch: Batch = {
      ...batchData,
      status: this.calculateBatchStatus(batchData.expiryDate),
      movements: [newMovement]
    };

    product.batches.push(newBatch);
    product.totalStock += batchData.quantity;
    product.status = product.totalStock > product.minStock ? 'Active' : 'Low Stock';

    await this.productRepository.update(product);
    this.logger.info(`Restocked product ${product.name}`, { productId, quantity: batchData.quantity });
  }

  async writeOff(productId: string, batchId: string, quantity: number, reason: string, userId: string): Promise<void> {
    const product = await this.productRepository.getById(productId);
    if (!product) throw new Error(`Product ${productId} not found`);

    const batch = product.batches.find(b => b.id === batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    if (batch.quantity < quantity) throw new Error(`Insufficient stock in batch ${batchId}`);

    batch.quantity -= quantity;
    product.totalStock -= quantity;
    
    batch.movements.push({
      id: `m-${Date.now()}`,
      type: 'WRITE_OFF',
      quantity: quantity,
      date: new Date(),
      description: `Write-off: ${reason}`,
      userId
    });

    product.status = product.totalStock <= 0 ? 'Out of Stock' : product.totalStock < product.minStock ? 'Low Stock' : 'Active';
    
    await this.productRepository.update(product);
    this.logger.warn(`Write-off processed for ${product.name}`, { productId, batchId, quantity, reason });
  }

  private calculateBatchStatus(expiryDate: Date): 'CRITICAL' | 'STABLE' | 'NEAR_EXPIRY' | 'EXPIRED' {
    const now = new Date();
    const diffDays = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'EXPIRED';
    if (diffDays <= 30) return 'CRITICAL';
    if (diffDays <= 90) return 'NEAR_EXPIRY';
    return 'STABLE';
  }
}

/**
 * POS Service - Handles sales transactions using FEFO logic.
 */
export class POSService {
  constructor(
    private productRepository: IProductRepository,
    private invoiceRepository: IInvoiceRepository,
    private logger: ILogger
  ) {}

  async processTransaction(transaction: TransactionDTO): Promise<Invoice> {
    const invoiceItems: InvoiceItem[] = [];
    
    for (const item of transaction.items) {
      const product = await this.productRepository.getById(item.productId);
      if (!product) throw new Error(`Product ${item.productId} not found`);

      if (product.prescription) {
        // In a real app, we'd check if a prescription was uploaded/verified
        this.logger.info(`Prescription check required for ${product.name}`);
      }

      if (product.totalStock < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      let remainingToDeduct = item.quantity;
      product.totalStock -= item.quantity;

      // FEFO: Sort batches by expiry date (earliest first, but NOT expired)
      const validBatches = product.batches.filter(b => b.expiryDate > new Date() && b.quantity > 0);
      const sortedBatches = [...validBatches].sort((a, b) => 
        a.expiryDate.getTime() - b.expiryDate.getTime()
      );

      if (sortedBatches.reduce((acc, b) => acc + b.quantity, 0) < item.quantity) {
        throw new Error(`Insufficient non-expired stock for ${product.name}`);
      }

      for (const batch of sortedBatches) {
        if (remainingToDeduct <= 0) break;

        const deduct = Math.min(batch.quantity, remainingToDeduct);
        if (deduct > 0) {
          batch.quantity -= deduct;
          batch.movements.push({
            id: `m-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            type: 'DISPATCH',
            quantity: deduct,
            date: new Date(),
            description: `POS Sale - Invoice ${transaction.customer || 'Walk-in'}`,
            userId: transaction.userId
          });
          
          invoiceItems.push({
            id: `ii-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            productId: product.id,
            batchId: batch.id,
            productName: product.name,
            batchNo: batch.batchNumber,
            quantity: deduct,
            unitPrice: item.sellingPrice,
            totalPrice: deduct * item.sellingPrice
          });

          remainingToDeduct -= deduct;
        }
      }

      product.status = product.totalStock <= 0 ? 'Out of Stock' : product.totalStock < product.minStock ? 'Low Stock' : 'Active';
      await this.productRepository.update(product);
    }

    const invoice: Invoice = {
      id: `inv-${Date.now()}`,
      invoiceNo: `INV-${Date.now().toString().slice(-6)}`,
      customer: transaction.customer,
      totalAmount: transaction.total,
      taxAmount: transaction.taxAmount,
      discount: transaction.discountAmount,
      paymentType: transaction.paymentType,
      status: 'PAID',
      userId: transaction.userId,
      items: invoiceItems,
      createdAt: new Date()
    };

    await this.invoiceRepository.save(invoice);
    this.logger.info('Transaction processed successfully', { invoiceNo: invoice.invoiceNo, total: transaction.total });
    
    return invoice;
  }
}
