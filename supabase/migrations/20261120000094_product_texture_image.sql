-- Ảnh thứ 2 cho sản phẩm trên website: ảnh texture (cận chất sản phẩm). Ảnh chính vẫn là image_url.
alter table public.products add column if not exists texture_image_url text;

drop function if exists public.web_products();
create function public.web_products()
returns table (id uuid, sku text, name text, capacity text, category text, retail_price numeric, image_url text, texture_image_url text, web_description text)
language sql stable security definer set search_path = public as $$
  select id, sku, name, capacity, category, retail_price, image_url, texture_image_url, web_description
  from products where show_on_web and is_active and deleted_at is null
  order by category, name, retail_price;
$$;
revoke all on function public.web_products() from public;
grant execute on function public.web_products() to anon, authenticated;

-- Khoá tạm cho hàm import-web-image (Claude đưa ảnh Grok lên kho ảnh sản phẩm). Chỉ lưu mã băm; xoá dòng để thu hồi.
create table if not exists public.web_image_import_keys (
  key_hash text primary key,
  note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);
alter table public.web_image_import_keys enable row level security;
