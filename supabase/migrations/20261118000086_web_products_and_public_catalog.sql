-- Website moanabeauty.vn (18/11/2026)
-- 1) Sản phẩm: cờ "hiện trên web", ảnh, mô tả ngắn; kho ảnh product-images (công khai)
-- 2) Chuẩn hoá mã BR theo tab "giá BR": 7 mã lệch, gắn mã 3 sản phẩm, thêm 25 sản phẩm bán lẻ; bật web cho 167 mã
-- 3) Hàm đọc công khai cho website: web_services(), web_packages(), web_products() — chỉ mục public / bật web, không lộ giá vốn
-- (Đã chạy trực tiếp trên Supabase qua 2 migration: web_products_flag_image_and_br_cleanup, web_public_catalog_functions)

alter table public.products
  add column if not exists show_on_web boolean not null default false,
  add column if not exists image_url text,
  add column if not exists web_description text;

insert into storage.buckets (id,name,public) values ('product-images','product-images',true) on conflict (id) do nothing;

create or replace function public.web_services()
returns table (id uuid, name text, name_en text, description text, category text, category_sort int, price numeric, member_price numeric, duration_minutes int)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.name_en, s.description, c.name, c.sort_order, s.price, s.member_price, s.duration_minutes
  from services s left join service_categories c on c.id = s.category_id
  where s.menu_tier = 'public' and s.is_active
  order by c.sort_order nulls last, s.name;
$$;

create or replace function public.web_packages()
returns table (id uuid, name text, description text, category text, price numeric, validity_days int, sort_order int, items jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.description, p.category, p.price, p.validity_days, p.sort_order,
    coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'quantity', i.quantity) order by i.sort_order)
              from package_items i where i.package_id = p.id), '[]'::jsonb)
  from packages p
  where p.menu_tier = 'public' and p.is_active and p.approval_status = 'approved'
  order by p.sort_order nulls last, p.name;
$$;

create or replace function public.web_products()
returns table (id uuid, sku text, name text, capacity text, category text, retail_price numeric, image_url text, web_description text)
language sql stable security definer set search_path = public as $$
  select id, sku, name, capacity, category, retail_price, image_url, web_description
  from products where show_on_web and is_active and deleted_at is null
  order by category, name, retail_price;
$$;

revoke all on function public.web_services(), public.web_packages(), public.web_products() from public;
grant execute on function public.web_services(), public.web_packages(), public.web_products() to anon, authenticated;

create policy "product images management insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select has_role(variadic array['owner'::user_role,'manager'::user_role,'warehouse'::user_role])));
create policy "product images management update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select has_role(variadic array['owner'::user_role,'manager'::user_role,'warehouse'::user_role])));
create policy "product images management delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select has_role(variadic array['owner'::user_role,'manager'::user_role,'warehouse'::user_role])));
