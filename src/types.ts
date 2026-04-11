export interface BatchMovement {
  id: string;
  type: 'RESTOCK' | 'DISPATCH' | 'ADJUSTMENT';
  quantity: number;
  date: string;
  description: string;
}

export interface Batch {
  id: string;
  quantity: number;
  unit: string;
  costBasis: number;
  supplier: string;
  manufacturedDate: string;
  expiryDate: string;
  status: 'CRITICAL' | 'STABLE' | 'NEAR_EXPIRY';
  movements: BatchMovement[];
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  manufacturer: string;
  countryOfOrigin?: string;
  totalStock: number;
  costPrice: number;
  sellingPrice: number;
  status: 'Active' | 'Low Stock' | 'Out of Stock';
  image: string;
  markingRequired: boolean;
  batches: Batch[];
}

export const MOCK_PRODUCTS: Product[] = [
  {
    id: '1',
    name: 'Amoxicillin 500mg Capsules',
    sku: 'AMX-500-CP',
    category: 'Antibiotics',
    manufacturer: 'Sun Pharma Industries',
    totalStock: 12450,
    costPrice: 4.20,
    sellingPrice: 8.50,
    status: 'Active',
    markingRequired: true,
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAOer3761YJ9ruAAw6BN0JgauWOdr_iHWwWy1FZNYxk4ibcMe7dKAv08k22os4ezmcKXiDsoEOxfNIJkpCIyZM62_-fqOZDJXvBK-4h8TH00wqMmgHc-cLJG_JXDdGoWwpD_jo41kYSzcjiRkMsQ2FoTOrw3_NvDmU-Fl4Gw9URJi9tQW7tVUmIa0fOcom06VJhWk02nv1pGq0dGdvTqXdrhhxnfuB8bj6j6EngBSzvDbWK609qm8fCve42iFPB6Mu6779kV2dA6w',
    batches: [
      {
        id: '#BAT-AMX-2024-001',
        quantity: 4500,
        unit: 'units',
        costBasis: 0.12,
        supplier: 'Global Pharma Corp',
        manufacturedDate: '12 Jan 2024',
        expiryDate: '15 Oct 2024',
        status: 'CRITICAL',
        movements: [
          { id: 'm1', type: 'RESTOCK', quantity: 5000, date: '12 Jan 2024', description: 'Initial stock from Global Pharma' },
          { id: 'm2', type: 'DISPATCH', quantity: 500, date: '20 Feb 2024', description: 'Wholesale Order #102' }
        ]
      },
      {
        id: '#BAT-AMX-2024-042',
        quantity: 7950,
        unit: 'units',
        costBasis: 0.14,
        supplier: 'Sandoz International',
        manufacturedDate: '05 Mar 2024',
        expiryDate: '22 Mar 2026',
        status: 'STABLE',
        movements: [
          { id: 'm3', type: 'RESTOCK', quantity: 8000, date: '05 Mar 2024', description: 'Bulk purchase from Sandoz' },
          { id: 'm4', type: 'DISPATCH', quantity: 50, date: '15 Mar 2024', description: 'Sample distribution' }
        ]
      }
    ]
  },
  {
    id: '2',
    name: 'Paracetamol Paediatric Suspension 125mg/5ml',
    sku: 'AP-PARA-125-LP',
    category: 'Analgesics',
    manufacturer: 'Abbott Healthcare',
    totalStock: 42,
    costPrice: 1.15,
    sellingPrice: 2.45,
    status: 'Low Stock',
    markingRequired: true,
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDuO0ES2OSS0y2AUOIAebdHB7e_j_zvg6fW7lXlKCTOO2yIRlqvhua8BB8GZtWousKEoaHN_Bs53aX8MqWoxretz3JIEEh6l_NdyYBVO3Ss-p90NCWqasWFOX38sfQfgh7sgcBV1J-aATrEkCzOuVjlmDwDoV6nRnNA53QucEbdfrKcdPqF7ynBoRGxceQCGkx6bfMOotLbrpd7r8ucrEcO3eKyYfm0tblrpx-gf1Kg-HJWMJ_v7-B8_BdMsGehl6-JfG1ANCaSUQ',
    batches: [
      {
        id: '#BAT-PARA-V991',
        quantity: 42,
        unit: 'bottles',
        costBasis: 1.15,
        supplier: 'Abbott Labs',
        manufacturedDate: '10 Dec 2023',
        expiryDate: '30 Nov 2024',
        status: 'NEAR_EXPIRY',
        movements: [
          { id: 'm5', type: 'RESTOCK', quantity: 100, date: '10 Dec 2023', description: 'Direct delivery from Abbott' },
          { id: 'm6', type: 'DISPATCH', quantity: 58, date: '05 Jan 2024', description: 'Clinic supply' }
        ]
      }
    ]
  },
  {
    id: '3',
    name: 'Multivitamin & Minerals Forte Capsules',
    sku: 'AP-VIT-FORTE-08',
    category: 'Vitamins',
    manufacturer: 'Pfizer Ltd.',
    totalStock: 5200,
    costPrice: 12.80,
    sellingPrice: 24.00,
    status: 'Active',
    markingRequired: false,
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBImu8vRNULeaIil0dwPn3iw2zBpRnQ1iklHcgRy9szogTYBFjUA-CXd7k8hlP7pU7N7zRnpLLhaVM4Wt11Ix-VMK0EHhl1KkOVbqkIasp43SG3mSZhWNDNgVoyYbMZgxqNc5UMCkzHB-zU66MrYoPbKaeHxTCJA6Ki6pMhNILuphRzH3xEwgEWInR6RtvDLYrm_jprmNEFa_BFm8e0rM2L0DxY1IGXlmvTz_MdbXuyD_N5yqtq2shFGlnJyjdkw3DZBkcmzLZUYQ',
    batches: []
  }
];

export const SALES_DATA = [
  { name: '01 Oct', value: 4000 },
  { name: '04 Oct', value: 4500 },
  { name: '07 Oct', value: 6000 },
  { name: '10 Oct', value: 5500 },
  { name: '13 Oct', value: 7000 },
  { name: '16 Oct', value: 6500 },
  { name: '19 Oct', value: 8000 },
  { name: '22 Oct', value: 7500 },
  { name: '25 Oct', value: 9000 },
  { name: '28 Oct', value: 8500 },
  { name: '31 Oct', value: 9500 },
  { name: 'Today', value: 10000 },
];

export const RECENT_ACTIVITY = [
  {
    id: 1,
    type: 'sale',
    title: 'Wholesale Order #4421 Processed',
    description: 'Buyer: City General Pharmacy • 12 line items',
    amount: 2410.00,
    time: '2 mins ago',
    status: 'success'
  },
  {
    id: 2,
    type: 'adjustment',
    title: 'Stock Adjustment: Ibuprofen 200mg',
    description: 'Reason: Damaged in transit • Quantity -40',
    amount: -120.00,
    time: '45 mins ago',
    status: 'error'
  },
  {
    id: 3,
    type: 'restock',
    title: 'New Batch Received: Vitamin D3',
    description: 'Supplier: NaturePharma Ltd • +500 units',
    amount: null,
    time: '3 hours ago',
    status: 'restock'
  }
];

export interface Invoice {
  id: string;
  buyer: string;
  date: string;
  amount: number;
  status: 'Paid' | 'Pending' | 'Overdue';
  items: number;
}

export const MOCK_INVOICES: Invoice[] = [
  { id: 'INV-2023-001', buyer: 'City General Pharmacy', date: '24 Oct 2023', amount: 2410.00, status: 'Paid', items: 12 },
  { id: 'INV-2023-002', buyer: 'HealthPlus Clinic', date: '23 Oct 2023', amount: 1250.50, status: 'Pending', items: 5 },
  { id: 'INV-2023-003', buyer: 'Green Valley Meds', date: '22 Oct 2023', amount: 3800.00, status: 'Overdue', items: 24 },
  { id: 'INV-2023-004', buyer: 'Metro Wellness', date: '21 Oct 2023', amount: 950.00, status: 'Paid', items: 3 },
];

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  category: string;
  rating: number;
  lastOrder: string;
}

export const MOCK_SUPPLIERS: Supplier[] = [
  { id: 'SUP-001', name: 'Global Pharma Corp', contact: 'John Smith', category: 'Antibiotics', rating: 4.8, lastOrder: '12 Oct 2023' },
  { id: 'SUP-002', name: 'Sandoz International', contact: 'Elena Rodriguez', category: 'Generics', rating: 4.5, lastOrder: '05 Oct 2023' },
  { id: 'SUP-003', name: 'Novo Nordisk', contact: 'Hans Nielsen', category: 'Insulin', rating: 4.9, lastOrder: '20 Sep 2023' },
  { id: 'SUP-004', name: 'NaturePharma Ltd', contact: 'Sarah Lee', category: 'Vitamins', rating: 4.2, lastOrder: '15 Oct 2023' },
];

export const BATCH_LIST = MOCK_PRODUCTS.flatMap(p => p.batches.map(b => ({ ...b, productName: p.name })));

export interface Notification {
  id: string;
  title: string;
  message: string;
  time: string;
  type: 'expiry' | 'stock' | 'system';
  read: boolean;
}

export const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: '1',
    title: 'Batch Expiry Alert',
    message: 'Amoxicillin Batch #BAT-AMX-2024-001 expires in 15 days.',
    time: '5 mins ago',
    type: 'expiry',
    read: false
  },
  {
    id: '2',
    title: 'Low Stock Warning',
    message: 'Paracetamol Paediatric Suspension is below critical level (42 units).',
    time: '2 hours ago',
    type: 'stock',
    read: false
  },
  {
    id: '3',
    title: 'System Update',
    message: 'PharmaPro v2.4.0 successfully deployed.',
    time: '1 day ago',
    type: 'system',
    read: true
  }
];
