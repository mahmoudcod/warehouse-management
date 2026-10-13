-- =============================================================
-- Warehouse Management System — initial schema
-- =============================================================
create extension if not exists "pgcrypto";

-- ---------- Staff / system users ----------
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  phone text,
  password_hash text not null,
  role text not null check (role in ('super_admin', 'accountant', 'staff')),
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Custom permissions for 'staff' users: one row per "module.action"
create table user_permissions (
  user_id uuid not null references users(id) on delete cascade,
  permission text not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references users(id),
  primary key (user_id, permission)
);

-- ---------- Customers ----------
create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  national_id text,
  address text,
  notes text,
  photo_url text,
  is_active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_customers_name on customers (name);
create index idx_customers_phone on customers (phone);

-- ---------- Inventory ----------
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_ar text,
  description text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_ar text,
  location text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_ar text,
  sku text unique,
  barcode text,
  category_id uuid references categories(id),
  brand text,
  model text,
  cost_price numeric(14,2) not null default 0,
  selling_price numeric(14,2) not null default 0,
  quantity numeric(14,2) not null default 0 check (quantity >= 0),
  min_stock_level numeric(14,2) not null default 0,
  warehouse_id uuid references warehouses(id),
  track_serials boolean not null default false,
  photo_url text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_items_name on items (name);
create index idx_items_sku on items (sku);
create index idx_items_category on items (category_id);

-- Individual serial-numbered units
create table item_units (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id),
  serial text not null,
  status text not null default 'in_stock' check (status in ('in_stock', 'assigned', 'returned', 'void')),
  warehouse_id uuid references warehouses(id),
  assignment_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (item_id, serial)
);
create index idx_item_units_serial on item_units (serial);

-- Every stock change: purchases in, assigned out, returns, adjustments, transfers
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id),
  movement_type text not null check (movement_type in ('purchase', 'assignment', 'return', 'adjustment', 'transfer')),
  quantity numeric(14,2) not null, -- signed: positive = in, negative = out
  from_warehouse_id uuid references warehouses(id),
  to_warehouse_id uuid references warehouses(id),
  unit_serial text,
  reference_type text,
  reference_id uuid,
  reason text,
  performed_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index idx_movements_item on stock_movements (item_id, created_at desc);
create index idx_movements_type on stock_movements (movement_type);

-- ---------- Assignments (devices taken by customers) ----------
create table assignments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  item_id uuid references items(id),
  item_text text, -- free-text name when not from inventory
  quantity numeric(14,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0, -- total charged to the customer
  credited_amount numeric(14,2) not null default 0, -- reversed on return
  serial_numbers text,
  assigned_at date not null default current_date,
  returned_at timestamptz,
  status text not null default 'taken' check (status in ('taken', 'returned', 'voided')),
  void_reason text,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_assignments_customer on assignments (customer_id, assigned_at desc);
create index idx_assignments_status on assignments (status);

-- ---------- Payments ----------
create table payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  amount numeric(14,2) not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash', 'transfer', 'other')),
  paid_at date not null default current_date,
  receipt_number text unique,
  received_by uuid references users(id),
  notes text,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  transaction_id uuid, -- linked accounting income entry (fk added below)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_payments_customer on payments (customer_id, paid_at desc);

-- ---------- Accounting ----------
create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_ar text,
  type text not null check (type in ('cash', 'bank')),
  balance numeric(14,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table transaction_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_ar text,
  kind text not null default 'both' check (kind in ('income', 'expense', 'both')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table transfers (
  id uuid primary key default gen_random_uuid(),
  from_account_id uuid not null references accounts(id),
  to_account_id uuid not null references accounts(id),
  amount numeric(14,2) not null check (amount > 0),
  occurred_at date not null default current_date,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('income', 'expense')),
  amount numeric(14,2) not null check (amount > 0),
  category_id uuid references transaction_categories(id),
  occurred_at date not null default current_date,
  method text not null default 'cash' check (method in ('cash', 'transfer', 'other')),
  account_id uuid references accounts(id),
  reference text,
  customer_id uuid references customers(id),
  payment_id uuid references payments(id),
  transfer_id uuid references transfers(id),
  notes text,
  attachment_path text,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table payments add constraint fk_payments_transaction foreign key (transaction_id) references transactions(id);
create index idx_transactions_date on transactions (occurred_at desc);
create index idx_transactions_type on transactions (type, status);
create index idx_transactions_account on transactions (account_id);

-- Closed/locked accounting months (first day of month)
create table closed_periods (
  period date primary key,
  closed_by uuid references users(id),
  closed_at timestamptz not null default now()
);

-- Daily cash-close snapshots
create table daily_closes (
  date date primary key,
  counted_amount numeric(14,2) not null default 0,
  system_closing numeric(14,2) not null default 0,
  difference numeric(14,2) not null default 0,
  note text,
  closed_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ---------- Installments ----------
create table installment_plans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  total_amount numeric(14,2) not null check (total_amount > 0),
  installments_count integer not null check (installments_count > 0),
  start_date date not null default current_date,
  interval_days integer not null default 30,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_plans_customer on installment_plans (customer_id);

create table installment_schedule (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references installment_plans(id) on delete cascade,
  installment_no integer not null,
  due_date date not null,
  amount numeric(14,2) not null,
  paid_amount numeric(14,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'paid'))
);

-- ---------- Audit log (immutable) ----------
create table audit_logs (
  id bigserial primary key,
  user_id uuid,
  user_name text,
  action text not null,
  entity text,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index idx_audit_created on audit_logs (created_at desc);
create index idx_audit_user on audit_logs (user_id);
create index idx_audit_entity on audit_logs (entity, entity_id);

create or replace function prevent_mutation() returns trigger as $$
begin
  raise exception 'audit_logs is immutable';
end;
$$ language plpgsql;

create trigger audit_logs_immutable
  before update or delete on audit_logs
  for each row execute function prevent_mutation();

-- ---------- Sequences (receipt numbers etc.) ----------
create table sequences (
  name text primary key,
  value bigint not null default 0
);
insert into sequences (name) values ('receipt');

-- ---------- Settings (single row) ----------
create table settings (
  id integer primary key default 1 check (id = 1),
  company_name text not null default 'مستودع النيل',
  company_name_en text not null default 'Nile Warehouse',
  company_phone text,
  company_address text,
  logo_url text,
  currency text not null default 'EGP',
  tax_enabled boolean not null default false,
  tax_rate numeric(5,2) not null default 14,
  receipt_footer text,
  notifications jsonb not null default '{"low_stock": true, "overdue_installments": true}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into settings (id) values (1);

-- ---------- Password resets ----------
create table password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Server-computed customer balances ----------
-- balance = (assignments charged, minus return credits) − payments received.
-- Never computed on the client.
create or replace view customer_balances as
select
  c.id as customer_id,
  coalesce((select sum(a.amount) from assignments a
    where a.customer_id = c.id and a.status <> 'voided' and a.deleted_at is null), 0)::float8 as total_taken,
  coalesce((select sum(a.credited_amount) from assignments a
    where a.customer_id = c.id and a.status <> 'voided' and a.deleted_at is null), 0)::float8 as total_returned,
  coalesce((select sum(p.amount) from payments p
    where p.customer_id = c.id and p.status = 'active' and p.deleted_at is null), 0)::float8 as total_paid,
  (
    coalesce((select sum(a.amount - a.credited_amount) from assignments a
      where a.customer_id = c.id and a.status <> 'voided' and a.deleted_at is null), 0)
    - coalesce((select sum(p.amount) from payments p
      where p.customer_id = c.id and p.status = 'active' and p.deleted_at is null), 0)
  )::float8 as balance
from customers c
where c.deleted_at is null;
