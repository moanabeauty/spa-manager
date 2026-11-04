-- Thông báo trong app (+ đẩy lên điện thoại) khi khách mua gói combo / nạp thẻ tài khoản thành công
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'sale',
  title text not null,
  body text,
  url text,
  invoice_id uuid references public.invoices(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_invoice_idx on public.notifications (invoice_id);
alter table public.notifications enable row level security;
create policy "own read" on public.notifications for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.vnd_text(p numeric)
 returns text language sql immutable set search_path to ''
as $$ select replace(to_char(round(coalesce(p, 0)), 'FM999,999,999,990'), ',', '.') || 'đ' $$;

-- hoá đơn vừa chốt có gói combo / nạp thẻ → báo khách (nếu có tài khoản) + chủ spa + quản lý chi nhánh
create or replace function public.invoices_sale_notify()
 returns trigger language plpgsql security definer set search_path to ''
as $$
declare
  v_items text;
  v_amount numeric;
  v_cust record;
  v_branch text;
  v_seller text;
begin
  if not (new.status = 'paid' and old.status is distinct from 'paid') then return new; end if;

  select string_agg(case when ii.item_type = 'package'
                           then coalesce(ii.description, 'Gói combo') || case when ii.quantity > 1 then ' ×' || ii.quantity else '' end
                         else 'Nạp thẻ tài khoản ' || public.vnd_text(ii.unit_price * ii.quantity)
                              || coalesce(' (tặng ' || public.vnd_text(nullif(t.bonus_amount, 0) * ii.quantity) || ')', '') end,
                    '; ' order by ii.item_type, ii.description),
         sum(ii.amount)
    into v_items, v_amount
    from public.invoice_items ii
    left join public.card_topup_tiers t on t.id = ii.topup_tier_id
   where ii.invoice_id = new.id and ii.item_type in ('package','card_topup');
  if v_items is null then return new; end if;

  select c.full_name, c.code, c.profile_id into v_cust from public.customers c where c.id = new.customer_id;
  select name into v_branch from public.branches where id = new.branch_id;
  select full_name into v_seller from public.profiles where id = new.created_by;

  if v_cust.profile_id is not null then
    insert into public.notifications (user_id, kind, title, body, url, invoice_id)
    values (v_cust.profile_id, 'sale_customer',
            'Đăng ký thành công – cảm ơn bạn đã tin chọn Moana',
            'Moana đã ghi nhận ' || public.vnd_text(v_amount) || ' cho: ' || v_items || '. Hoá đơn ' || new.code || '.',
            '/tai-khoan#goi-the', new.id);
  end if;

  insert into public.notifications (user_id, kind, title, body, url, invoice_id)
  select p.id, 'sale_staff',
         'Đã bán: ' || v_items,
         coalesce(v_cust.full_name, 'Khách') || coalesce(' (' || v_cust.code || ')', '') || ' · ' || coalesce(replace(v_branch, 'Moana ', ''), '')
           || ' · ghi nhận ' || public.vnd_text(v_amount) || coalesce(' · ' || v_seller, '') || ' · ' || new.code,
         '/quan-ly/hoa-don/' || new.id, new.id
    from public.profiles p
   where p.is_active and (p.role = 'owner' or (p.role = 'manager' and (p.branch_id is null or p.branch_id = new.branch_id)));
  return new;
end $$;

create trigger invoices_au_sale_notify after update of status on public.invoices
  for each row execute function public.invoices_sale_notify();

-- người vừa thu tiền gọi để lấy danh sách thiết bị cần báo (mỗi hoá đơn báo 1 lần, trong 15 phút)
create or replace function public.invoice_push_targets(p_invoice uuid)
 returns table(sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text)
 language plpgsql security definer set search_path to ''
as $$
begin
  if not exists (select 1 from public.invoices i where i.id = p_invoice and i.status = 'paid'
                   and i.created_by = (select auth.uid()) and i.paid_at > now() - interval '15 minutes') then
    return;
  end if;
  return query
  with todo as (
    update public.notifications n set pushed_at = now()
     where n.invoice_id = p_invoice and n.pushed_at is null
    returning n.user_id, n.title, n.body, n.url
  )
  select s.endpoint, s.p256dh, s.auth, t.title, t.body, t.url
    from todo t join public.push_subscriptions s on s.user_id = t.user_id;
end $$;
revoke execute on function public.invoice_push_targets(uuid) from public, anon;
grant execute on function public.invoice_push_targets(uuid) to authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
 returns void language sql security definer set search_path to ''
as $$
  update public.notifications set read_at = now()
   where user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any(p_ids))
$$;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- khách cũng bật được thông báo trên điện thoại
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
 returns void language plpgsql security definer set search_path to ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Vui lòng đăng nhập'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Thông tin thông báo không hợp lệ';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, (select auth.uid()), p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, user_agent = excluded.user_agent, created_at = now();
end $$;
