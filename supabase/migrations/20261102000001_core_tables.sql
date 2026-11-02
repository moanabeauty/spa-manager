-- Moana Spa Manager: core tables
create extension if not exists btree_gist with schema extensions;

-- ============ ENUMS ============
create type public.user_role as enum ('owner','manager','receptionist','technician','warehouse','customer');
create type public.appointment_status as enum ('pending','confirmed','in_progress','completed','cancelled','no_show');
create type public.booking_source as enum ('online','walk_in','phone','staff');
create type public.invoice_status as enum ('draft','paid','cancelled');
create type public.invoice_item_type as enum ('service','package','card_topup','product');
create type public.payment_method as enum ('cash','bank_transfer','pos','service_card');
create type public.warehouse_type as enum ('retail','treatment');
create type public.stock_movement_type as enum ('import','export_use','export_sale','transfer_in','transfer_out','adjustment');
create type public.request_status as enum ('pending','approved','rejected','cancelled');
create type public.card_txn_type as enum ('topup','bonus','charge','refund','adjustment');
create type public.registration_status as enum ('pending','confirmed','cancelled');

-- ============ CHI NHÁNH / NGƯỜI DÙNG ============
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role public.user_role not null default 'customer',
  branch_id uuid references public.branches(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null,
  phone text unique,
  email text,
  birthday date,
  gender text,
  note text,
  home_branch_id uuid references public.branches(id),
  created_at timestamptz not null default now()
);

-- ============ DỊCH VỤ / GÓI / KHUYẾN MẠI ============
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.service_categories(id),
  name text not null,
  description text,
  duration_minutes int not null default 60 check (duration_minutes > 0),
  price numeric(12,0) not null check (price >= 0),
  technician_fee numeric(12,0) not null default 0 check (technician_fee >= 0), -- tiền dịch vụ cố định cho KTV
  card_allowed boolean not null default true, -- false: BAP, filler, botox, hifu, căng cấy chỉ
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.packages ( -- gói combo / liệu trình
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(12,0) not null check (price >= 0),
  validity_days int check (validity_days > 0), -- null = không hết hạn
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.package_services (
  package_id uuid not null references public.packages(id) on delete cascade,
  service_id uuid not null references public.services(id),
  quantity int not null check (quantity > 0),
  primary key (package_id, service_id)
);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  package_id uuid references public.packages(id),
  price numeric(12,0) check (price >= 0),
  start_date date,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.promotion_registrations (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id),
  customer_id uuid not null references public.customers(id),
  branch_id uuid references public.branches(id),
  status public.registration_status not null default 'pending',
  note text,
  invoice_id uuid,
  created_at timestamptz not null default now()
);

-- ============ THẺ TÀI KHOẢN ============
create table public.card_topup_tiers (
  id uuid primary key default gen_random_uuid(),
  topup_amount numeric(12,0) not null unique check (topup_amount > 0),
  bonus_amount numeric(12,0) not null default 0 check (bonus_amount >= 0),
  is_active boolean not null default true
);

create sequence public.card_code_seq;

create table public.service_cards (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  code text not null unique default ('TK' || lpad(nextval('public.card_code_seq')::text, 6, '0')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============ LỊCH HẸN ============
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  branch_id uuid not null references public.branches(id),
  start_at timestamptz not null,
  end_at timestamptz,
  status public.appointment_status not null default 'pending',
  source public.booking_source not null default 'staff',
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (end_at is null or end_at > start_at)
);

create table public.customer_packages ( -- gói khách đã mua
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  package_id uuid not null references public.packages(id),
  invoice_item_id uuid,
  purchased_at timestamptz not null default now(),
  expires_at timestamptz,
  is_active boolean not null default true
);

create table public.customer_package_services ( -- số buổi còn lại theo dịch vụ
  customer_package_id uuid not null references public.customer_packages(id) on delete cascade,
  service_id uuid not null references public.services(id),
  total_qty int not null check (total_qty > 0),
  used_qty int not null default 0 check (used_qty >= 0),
  primary key (customer_package_id, service_id),
  check (used_qty <= total_qty)
);

create table public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id),
  technician_id uuid references public.profiles(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  price numeric(12,0) not null,
  technician_fee numeric(12,0) not null,
  customer_package_id uuid references public.customer_packages(id), -- trừ buổi từ gói
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  -- chặn 1 KTV bị xếp 2 lịch trùng giờ
  constraint no_technician_overlap exclude using gist (
    technician_id with =, tstzrange(start_at, end_at) with &&
  ) where (is_active and technician_id is not null)
);

-- ============ HOÁ ĐƠN / THANH TOÁN / HOA HỒNG ============
create sequence public.invoice_code_seq;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('HD' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-' || lpad(nextval('public.invoice_code_seq')::text, 5, '0')),
  customer_id uuid references public.customers(id),
  branch_id uuid not null references public.branches(id),
  appointment_id uuid references public.appointments(id),
  status public.invoice_status not null default 'draft',
  discount numeric(12,0) not null default 0 check (discount >= 0),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.promotion_registrations
  add constraint promotion_registrations_invoice_fk foreign key (invoice_id) references public.invoices(id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  name text not null,
  unit text not null default 'cái',
  retail_price numeric(12,0) check (retail_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  item_type public.invoice_item_type not null,
  service_id uuid references public.services(id),
  package_id uuid references public.packages(id),
  product_id uuid references public.products(id),
  topup_tier_id uuid references public.card_topup_tiers(id),
  description text,
  quantity int not null default 1 check (quantity > 0),
  unit_price numeric(12,0) not null check (unit_price >= 0),
  discount numeric(12,0) not null default 0 check (discount >= 0),
  amount numeric(12,0) generated always as (quantity * unit_price - discount) stored,
  check (
    (item_type = 'service'    and service_id   is not null) or
    (item_type = 'package'    and package_id   is not null) or
    (item_type = 'product'    and product_id   is not null) or
    (item_type = 'card_topup' and topup_tier_id is not null)
  ),
  check (quantity * unit_price - discount >= 0)
);

alter table public.customer_packages
  add constraint customer_packages_invoice_item_fk foreign key (invoice_item_id) references public.invoice_items(id);

create table public.invoice_item_sellers ( -- 1 dòng hoá đơn chia cho nhiều KTV
  invoice_item_id uuid not null references public.invoice_items(id) on delete cascade,
  staff_id uuid not null references public.profiles(id),
  amount numeric(12,0) not null check (amount > 0), -- phần doanh số tính cho người này
  primary key (invoice_item_id, staff_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  method public.payment_method not null,
  amount numeric(12,0) not null check (amount > 0),
  service_card_id uuid references public.service_cards(id),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check ((method = 'service_card') = (service_card_id is not null))
);

create table public.card_transactions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.service_cards(id),
  txn_type public.card_txn_type not null,
  amount numeric(12,0) not null, -- dương: nạp/tặng/hoàn; âm: trừ
  invoice_id uuid references public.invoices(id),
  payment_id uuid references public.payments(id) on delete cascade,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (
    (txn_type in ('topup','bonus','refund') and amount > 0) or
    (txn_type = 'charge' and amount < 0) or
    (txn_type = 'adjustment' and amount <> 0)
  )
);

create table public.commission_tiers ( -- bậc hoa hồng theo doanh số tháng
  id uuid primary key default gen_random_uuid(),
  min_monthly_sales numeric(14,0) not null unique check (min_monthly_sales >= 0),
  rate numeric(5,4) not null check (rate >= 0 and rate <= 1)
);

create table public.commission_item_types ( -- loại hàng nào được tính doanh số hoa hồng
  item_type public.invoice_item_type primary key,
  counts boolean not null default true
);

-- ============ KHO ============
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  type public.warehouse_type not null,
  name text not null,
  unique (branch_id, type)
);

create table public.stock_requests ( -- KTV yêu cầu xuất hàng
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  appointment_id uuid references public.appointments(id),
  status public.request_status not null default 'pending',
  reason text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create table public.stock_request_items (
  request_id uuid not null references public.stock_requests(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity int not null check (quantity > 0),
  primary key (request_id, product_id)
);

create table public.stock_movements ( -- mọi lần nhập / xuất
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid not null references public.products(id),
  movement_type public.stock_movement_type not null,
  quantity int not null check (quantity <> 0), -- dương: vào kho; âm: ra kho
  request_id uuid references public.stock_requests(id),
  invoice_item_id uuid references public.invoice_items(id),
  unit_cost numeric(12,0),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============ INDEXES ============
create index on public.profiles (branch_id);
create index on public.customers (home_branch_id);
create index on public.services (category_id);
create index on public.package_services (service_id);
create index on public.promotions (package_id);
create index on public.promotion_registrations (promotion_id);
create index on public.promotion_registrations (customer_id);
create index on public.promotion_registrations (branch_id);
create index on public.promotion_registrations (invoice_id);
create index on public.service_cards (customer_id);
create index on public.appointments (customer_id);
create index on public.appointments (branch_id, start_at);
create index on public.appointments (created_by);
create index on public.customer_packages (customer_id);
create index on public.customer_packages (package_id);
create index on public.customer_packages (invoice_item_id);
create index on public.customer_package_services (service_id);
create index on public.appointment_services (appointment_id);
create index on public.appointment_services (service_id);
create index on public.appointment_services (technician_id, start_at);
create index on public.appointment_services (customer_package_id);
create index on public.invoices (customer_id);
create index on public.invoices (branch_id, paid_at);
create index on public.invoices (appointment_id);
create index on public.invoices (created_by);
create index on public.invoice_items (invoice_id);
create index on public.invoice_items (service_id);
create index on public.invoice_items (package_id);
create index on public.invoice_items (product_id);
create index on public.invoice_items (topup_tier_id);
create index on public.invoice_item_sellers (staff_id);
create index on public.payments (invoice_id);
create index on public.payments (service_card_id);
create index on public.payments (created_by);
create index on public.card_transactions (card_id);
create index on public.card_transactions (invoice_id);
create index on public.card_transactions (payment_id);
create index on public.card_transactions (created_by);
create index on public.stock_requests (warehouse_id);
create index on public.stock_requests (requested_by);
create index on public.stock_requests (appointment_id);
create index on public.stock_requests (reviewed_by);
create index on public.stock_request_items (product_id);
create index on public.stock_movements (warehouse_id, product_id);
create index on public.stock_movements (product_id);
create index on public.stock_movements (request_id);
create index on public.stock_movements (invoice_item_id);
create index on public.stock_movements (created_by);
