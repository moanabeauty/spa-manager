-- Giai đoạn 6 (chỉnh theo chủ spa):
-- 1. Không áp dụng 2 ưu đãi cùng lúc: món khuyến mãi KHÔNG trừ thẻ nạp sẵn (giá thành viên), KHÔNG giảm giá thêm
--    (giảm chung cả hoá đơn đã không chia vào món KM; buổi trừ gói đã không áp KM).
-- 2. Hết hạn dùng ưu đãi: chủ / quản lý GIA HẠN đăng ký (ghi lý do) thì mới thu được giá KM.
--    Hết thời gian đăng ký: chủ / quản lý vẫn đăng ký hộ khách được.
-- 3. Gói combo "ngừng bán": ngoài khuyến mãi, chỉ chủ / quản lý bán được.

alter table public.promotion_registrations
  add column extended_until date,
  add column extended_by uuid references public.profiles(id),
  add column extend_reason text;
create index on public.promotion_registrations (extended_by);

create or replace function public.extend_promotion_registration(p_id uuid, p_until date, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r record;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý được gia hạn ưu đãi'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do gia hạn'; end if;
  if p_until is null or p_until < (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Ngày gia hạn phải từ hôm nay trở đi';
  end if;
  select * into v_r from public.promotion_registrations where id = p_id for update;
  if not found then raise exception 'Không tìm thấy đăng ký'; end if;
  if v_r.status not in ('pending','confirmed') then raise exception 'Chỉ gia hạn đăng ký chưa dùng'; end if;
  update public.promotion_registrations
     set extended_until = p_until, extended_by = (select auth.uid()), extend_reason = trim(p_reason),
         status = 'confirmed', handled_by = coalesce(handled_by, (select auth.uid())), handled_at = coalesce(handled_at, now())
   where id = p_id;
end $$;
revoke execute on function public.extend_promotion_registration(uuid, date, text) from public, anon;
grant execute on function public.extend_promotion_registration(uuid, date, text) to authenticated;

-- Sửa 3 hàm đã có bằng cách thay đúng đoạn cần đổi (báo lỗi nếu không tìm thấy đoạn cũ)
create or replace function pg_temp.patch_fn(p_sig text, p_old text, p_new text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_sig::regprocedure);
begin
  if position(p_old in d) = 0 then raise exception 'Không tìm thấy đoạn cần sửa trong %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

-- hạn dùng = ngày gia hạn (nếu có)
select pg_temp.patch_fn('public.promotion_line_check(uuid,uuid,uuid,uuid,text,uuid)',
$o$  if coalesce(v_p.redeem_until, v_p.end_date) is not null and v_today > coalesce(v_p.redeem_until, v_p.end_date) then
    raise exception 'Khuyến mãi "%" đã hết hạn dùng', v_p.name;$o$,
$n$  if coalesce(v_r.extended_until, v_p.redeem_until, v_p.end_date) is not null
     and v_today > coalesce(v_r.extended_until, v_p.redeem_until, v_p.end_date) then
    raise exception 'Khuyến mãi "%" đã hết hạn dùng: cần chủ spa / quản lý gia hạn', v_p.name;$n$);

-- hết thời gian đăng ký: chủ / quản lý vẫn đăng ký hộ được
select pg_temp.patch_fn('public.register_promotion(uuid,uuid,timestamptz,text,uuid)',
$o$  if v_p.end_date is not null and v_today > v_p.end_date then raise exception 'Chương trình đã hết hạn đăng ký'; end if;$o$,
$n$  if v_p.end_date is not null and v_today > v_p.end_date
     and not (p_customer_id is not null and public.has_role('owner','manager')) then
    raise exception 'Chương trình đã hết hạn đăng ký (chủ spa / quản lý có thể đăng ký hộ)';
  end if;$n$);

-- thu tiền: món KM không trừ thẻ, không giảm thêm; gói ngừng bán chỉ chủ / quản lý bán
select pg_temp.patch_fn('public.checkout_invoice(uuid,uuid,uuid,jsonb,jsonb,numeric,text)',
$o$      select name, price into v_rec from public.packages where id = v_ref and (is_active or v_reg is not null);
      if not found then raise exception 'Gói combo không tồn tại hoặc đã ngừng bán'; end if;$o$,
$n$      select name, price into v_rec from public.packages
       where id = v_ref and (is_active or v_reg is not null or public.has_role('owner','manager'));
      if not found then raise exception 'Gói combo đã ngừng bán: cần chủ spa / quản lý bán'; end if;$n$);

select pg_temp.patch_fn('public.checkout_invoice(uuid,uuid,uuid,jsonb,jsonb,numeric,text)',
$o$          if v_card_line and (not v_svc.card_allowed or v_svc.member_price is null) then
            raise exception 'Dịch vụ "%" không trả bằng thẻ tài khoản (chưa có giá thành viên)', v_svc.name;
          end if;
          select * into v_promo$o$,
$n$          if v_card_line then
            raise exception 'Món khuyến mãi "%" không trừ thẻ nạp sẵn (không áp dụng 2 ưu đãi cùng lúc)', v_svc.name;
          end if;
          select * into v_promo$n$);

select pg_temp.patch_fn('public.checkout_invoice(uuid,uuid,uuid,jsonb,jsonb,numeric,text)',
$o$    if v_reg is not null then
      v_n := $o$,
$n$    if v_reg is not null then
      if v_disc > 0 then
        raise exception 'Món khuyến mãi "%" không giảm giá thêm (không áp dụng 2 ưu đãi cùng lúc)', v_desc;
      end if;
      v_n := $n$);
