import mongoose, { Schema } from 'mongoose';

export { mongoose };

/**
 * MongoDB data layer (replaces PostgreSQL/pg).
 * All documents keep a numeric `id` (per-collection sequence) so the API's
 * id fields keep the same shape the client was built against.
 */

const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/warehouse';

export async function connectDB(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });
}

/** Remove Mongo internals from a lean() document before sending it as JSON. */
export function strip<T = any>(doc: any): T {
  if (doc == null) return doc;
  if (Array.isArray(doc)) return doc.map(strip) as any;
  const o = { ...doc };
  delete o._id;
  delete o.__v;
  return o;
}

// ---------------- Sequences ----------------
const sequenceSchema = new Schema({
  name: { type: String, required: true, unique: true },
  value: { type: Number, default: 0 },
});
export const Sequence = mongoose.model('Sequence', sequenceSchema);

export async function nextSequence(name: string, session?: mongoose.ClientSession): Promise<number> {
  const r = (await Sequence.findOneAndUpdate(
    { name },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session }
  ))!;
  return r.value;
}

/** Create a document with the next numeric id of its collection, inside an optional session. */
export async function createWithId(Model: any, data: any, session?: mongoose.ClientSession) {
  const id = await nextSequence(Model.modelName, session);
  const arr = await Model.create([{ ...data, id }], { session });
  return arr[0];
}

/** Run fn inside an Atlas replica-set transaction. */
export async function withTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

// ---------------- Shared helpers ----------------

/** Normalize a DB date value to a YYYY-MM-DD string (same semantics as the pg version). */
export function isoDate(v: any): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

export const todayStr = () => new Date().toISOString().slice(0, 10);

export function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Case-insensitive "contains" regex for ilike-style search. */
export function rx(s: string): RegExp {
  return new RegExp(esc(s), 'i');
}

/** Money rounding helper (2 decimals) — SQL numeric(14,2) equivalent. */
export const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------- Models ----------------

const withId = { id: { type: Number, index: true, unique: true } } as const;

const User = mongoose.model(
  'User',
  new Schema({
    ...withId,
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, default: null },
    password_hash: { type: String, required: true },
    role: { type: String, enum: ['super_admin', 'accountant', 'staff'], required: true },
    is_active: { type: Boolean, default: true },
    permissions: { type: [String], default: [] }, // replaces user_permissions table (staff only)
    last_login_at: { type: Date, default: null },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const Customer = mongoose.model(
  'Customer',
  new Schema({
    ...withId,
    name: { type: String, required: true },
    phone: { type: String, default: null },
    national_id: { type: String, default: null },
    address: { type: String, default: null },
    notes: { type: String, default: null },
    photo_url: { type: String, default: null },
    is_active: { type: Boolean, default: true },
    created_by: { type: Number, default: null },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const Category = mongoose.model(
  'Category',
  new Schema({
    ...withId,
    name: { type: String, required: true },
    name_ar: { type: String, default: null },
    description: { type: String, default: null },
    created_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const Warehouse = mongoose.model(
  'Warehouse',
  new Schema({
    ...withId,
    name: { type: String, required: true },
    name_ar: { type: String, default: null },
    location: { type: String, default: null },
    is_default: { type: Boolean, default: false },
    created_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const Item = mongoose.model(
  'Item',
  new Schema({
    ...withId,
    name: { type: String, required: true },
    name_ar: { type: String, default: null },
    sku: { type: String, default: null },
    barcode: { type: String, default: null },
    category_id: { type: Number, default: null },
    brand: { type: String, default: null },
    model: { type: String, default: null },
    cost_price: { type: Number, default: 0 },
    selling_price: { type: Number, default: 0 },
    quantity: { type: Number, default: 0, min: 0 },
    min_stock_level: { type: Number, default: 0 },
    warehouse_id: { type: Number, default: null },
    track_serials: { type: Boolean, default: false },
    photo_url: { type: String, default: null },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const ItemUnit = mongoose.model(
  'ItemUnit',
  new Schema({
    ...withId,
    item_id: { type: Number, required: true },
    serial: { type: String, required: true },
    status: { type: String, enum: ['in_stock', 'assigned', 'returned', 'void'], default: 'in_stock' },
    warehouse_id: { type: Number, default: null },
    assignment_id: { type: Number, default: null },
    created_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);
ItemUnit.schema.index({ item_id: 1, serial: 1 }, { unique: true });

const StockMovement = mongoose.model(
  'StockMovement',
  new Schema({
    ...withId,
    item_id: { type: Number, required: true },
    movement_type: { type: String, enum: ['purchase', 'assignment', 'return', 'adjustment', 'transfer'], required: true },
    quantity: { type: Number, required: true },
    from_warehouse_id: { type: Number, default: null },
    to_warehouse_id: { type: Number, default: null },
    unit_serial: { type: String, default: null },
    reference_type: { type: String, default: null },
    reference_id: { type: Number, default: null },
    reason: { type: String, default: null },
    performed_by: { type: Number, default: null },
    created_at: { type: Date, default: () => new Date() },
  })
);

const Assignment = mongoose.model(
  'Assignment',
  new Schema({
    ...withId,
    customer_id: { type: Number, required: true },
    item_id: { type: Number, default: null },
    item_text: { type: String, default: null },
    quantity: { type: Number, default: 1 },
    unit_price: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    credited_amount: { type: Number, default: 0 },
    serial_numbers: { type: String, default: null },
    assigned_at: { type: String, required: true }, // YYYY-MM-DD
    returned_at: { type: Date, default: null },
    status: { type: String, enum: ['taken', 'returned', 'voided'], default: 'taken' },
    void_reason: { type: String, default: null },
    notes: { type: String, default: null },
    created_by: { type: Number, default: null },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const Payment = mongoose.model(
  'Payment',
  new Schema({
    ...withId,
    customer_id: { type: Number, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: ['cash', 'transfer', 'other'], default: 'cash' },
    paid_at: { type: String, required: true }, // YYYY-MM-DD
    receipt_number: { type: String, default: null, unique: true, sparse: true },
    received_by: { type: Number, default: null },
    notes: { type: String, default: null },
    status: { type: String, enum: ['active', 'voided'], default: 'active' },
    void_reason: { type: String, default: null },
    transaction_id: { type: Number, default: null },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const Account = mongoose.model(
  'Account',
  new Schema({
    ...withId,
    name: { type: String, required: true },
    name_ar: { type: String, default: null },
    type: { type: String, enum: ['cash', 'bank'], required: true },
    balance: { type: Number, default: 0 },
    is_active: { type: Boolean, default: true },
    created_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const TransactionCategory = mongoose.model(
  'TransactionCategory',
  new Schema({
    ...withId,
    name: { type: String, required: true },
    name_ar: { type: String, default: null },
    kind: { type: String, enum: ['income', 'expense', 'both'], default: 'both' },
    is_default: { type: Boolean, default: false },
    created_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const Transfer = mongoose.model(
  'Transfer',
  new Schema({
    ...withId,
    from_account_id: { type: Number, required: true },
    to_account_id: { type: Number, required: true },
    amount: { type: Number, required: true },
    occurred_at: { type: String, required: true }, // YYYY-MM-DD
    notes: { type: String, default: null },
    created_by: { type: Number, default: null },
    created_at: { type: Date, default: () => new Date() },
  })
);

const Transaction = mongoose.model(
  'Transaction',
  new Schema({
    ...withId,
    type: { type: String, enum: ['income', 'expense'], required: true },
    amount: { type: Number, required: true },
    category_id: { type: Number, default: null },
    occurred_at: { type: String, required: true }, // YYYY-MM-DD
    method: { type: String, enum: ['cash', 'transfer', 'other'], default: 'cash' },
    account_id: { type: Number, default: null },
    reference: { type: String, default: null },
    customer_id: { type: Number, default: null },
    payment_id: { type: Number, default: null },
    transfer_id: { type: Number, default: null },
    notes: { type: String, default: null },
    attachment_path: { type: String, default: null },
    status: { type: String, enum: ['active', 'voided'], default: 'active' },
    void_reason: { type: String, default: null },
    created_by: { type: Number, default: null },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const ClosedPeriod = mongoose.model(
  'ClosedPeriod',
  new Schema({
    period: { type: String, required: true, unique: true }, // YYYY-MM-01
    closed_by: { type: Number, default: null },
    closed_at: { type: Date, default: () => new Date() },
  })
);

const DailyClose = mongoose.model(
  'DailyClose',
  new Schema({
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD
    counted_amount: { type: Number, default: 0 },
    system_closing: { type: Number, default: 0 },
    difference: { type: Number, default: 0 },
    note: { type: String, default: null },
    closed_by: { type: Number, default: null },
    created_at: { type: Date, default: () => new Date() },
  })
);

const InstallmentPlan = mongoose.model(
  'InstallmentPlan',
  new Schema({
    ...withId,
    customer_id: { type: Number, required: true },
    total_amount: { type: Number, required: true },
    installments_count: { type: Number, required: true },
    start_date: { type: String, required: true }, // YYYY-MM-DD
    interval_days: { type: Number, default: 30 },
    status: { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' },
    notes: { type: String, default: null },
    created_by: { type: Number, default: null },
    created_at: { type: Date, default: () => new Date() },
    deleted_at: { type: Date, default: null },
  })
);

const InstallmentSchedule = mongoose.model(
  'InstallmentSchedule',
  new Schema({
    ...withId,
    plan_id: { type: Number, required: true },
    installment_no: { type: Number, required: true },
    due_date: { type: String, required: true }, // YYYY-MM-DD
    amount: { type: Number, required: true },
    paid_amount: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  })
);

const AuditLog = mongoose.model(
  'AuditLog',
  new Schema({
    ...withId,
    user_id: { type: Number, default: null },
    user_name: { type: String, default: null },
    action: { type: String, required: true },
    entity: { type: String, default: null },
    entity_id: { type: String, default: null },
    old_value: { type: Schema.Types.Mixed, default: null },
    new_value: { type: Schema.Types.Mixed, default: null },
    search_blob: { type: String, default: '' }, // lowercased values+json for ilike-style search
    ip: { type: String, default: null },
    user_agent: { type: String, default: null },
    created_at: { type: Date, default: () => new Date() },
  })
);

const Setting = mongoose.model(
  'Setting',
  new Schema({
    id: { type: Number, required: true, unique: true }, // always 1
    company_name: { type: String, default: 'مستودع النيل' },
    company_name_en: { type: String, default: 'Nile Warehouse' },
    company_phone: { type: String, default: null },
    company_address: { type: String, default: null },
    logo_url: { type: String, default: null },
    currency: { type: String, default: 'EGP' },
    tax_enabled: { type: Boolean, default: false },
    tax_rate: { type: Number, default: 14 },
    receipt_footer: { type: String, default: null },
    notifications: { type: Schema.Types.Mixed, default: { low_stock: true, overdue_installments: true } },
    updated_at: { type: Date, default: () => new Date() },
  })
);

const PasswordReset = mongoose.model(
  'PasswordReset',
  new Schema({
    ...withId,
    user_id: { type: Number, required: true },
    token_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
    used_at: { type: Date, default: null },
    created_at: { type: Date, default: () => new Date() },
  })
);

export {
  User,
  Customer,
  Category,
  Warehouse,
  Item,
  ItemUnit,
  StockMovement,
  Assignment,
  Payment,
  Account,
  TransactionCategory,
  Transfer,
  Transaction,
  ClosedPeriod,
  DailyClose,
  InstallmentPlan,
  InstallmentSchedule,
  AuditLog,
  Setting,
  PasswordReset,
};

// ---------------- Computed balances (customer_balances view equivalent) ----------------

export interface CustomerBalance {
  total_taken: number;
  total_returned: number;
  total_paid: number;
  balance: number;
}

/**
 * Server-computed customer balances:
 * balance = (assignments charged − return credits) − payments received.
 * Returns a Map keyed by numeric customer id.
 */
export async function balanceMap(customerIds?: number[]): Promise<Map<number, CustomerBalance>> {
  const custMatch: any = { status: { $ne: 'voided' }, deleted_at: null };
  if (customerIds) custMatch.customer_id = { $in: customerIds };
  const [aRows, pRows] = await Promise.all([
    Assignment.aggregate([
      { $match: custMatch },
      { $group: { _id: '$customer_id', total_taken: { $sum: '$amount' }, total_returned: { $sum: '$credited_amount' } } },
    ]),
    Payment.aggregate([
      { $match: { ...custMatch, status: 'active' } },
      { $group: { _id: '$customer_id', total_paid: { $sum: '$amount' } } },
    ]),
  ]);
  const map = new Map<number, CustomerBalance>();
  const ensure = (id: number) => {
    if (!map.has(id)) map.set(id, { total_taken: 0, total_returned: 0, total_paid: 0, balance: 0 });
    return map.get(id)!;
  };
  for (const r of aRows) {
    const b = ensure(r._id);
    b.total_taken = r.total_taken;
    b.total_returned = r.total_returned;
  }
  for (const r of pRows) {
    const b = ensure(r._id);
    b.total_paid = r.total_paid;
  }
  for (const b of map.values()) b.balance = r2(b.total_taken - b.total_returned - b.total_paid);
  return map;
}

/** Single-customer balance (0 when the customer has no financial history). */
export async function customerBalance(customerId: number): Promise<CustomerBalance> {
  const m = await balanceMap([customerId]);
  return m.get(customerId) ?? { total_taken: 0, total_returned: 0, total_paid: 0, balance: 0 };
}

/**
 * Customers with at least one overdue installment
 * (active plan, unpaid schedule row past its due date).
 */
export async function overdueCustomerSet(): Promise<Set<number>> {
  const rows = await InstallmentPlan.aggregate([
    { $match: { status: 'active', deleted_at: null } },
    {
      $lookup: {
        from: 'installmentschedules',
        localField: 'id',
        foreignField: 'plan_id',
        as: 's',
        pipeline: [
          {
            $match: {
              status: { $ne: 'paid' },
              $expr: {
                $and: [{ $lt: ['$paid_amount', '$amount'] }, { $lt: ['$due_date', todayStr()] }],
              },
            },
          },
        ],
      },
    },
    { $match: { 's.0': { $exists: true } } },
    { $group: { _id: '$customer_id' } },
  ]);
  return new Set(rows.map((r: any) => r._id));
}
