-- Một người kiêm nhiều vai trò (VD: vừa KTV vừa kho).
--  * profiles.role        = vai trò chính (tính lương, hiển thị mặc định)
--  * profiles.extra_roles = các vai trò kiêm nhiệm (chủ spa cấp)
--  * profiles.active_role = vai trò đang dùng trên app (người dùng tự chuyển)
-- Quyền (has_role) = gộp tất cả vai trò; my_role() = vai trò đang dùng.

create or replace function pg_temp.patch_fn(p_sig text, p_old text, p_new text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_sig::regprocedure);
begin
  if position(p_old in d) = 0 then raise exception 'Không tìm thấy đoạn cần sửa trong %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

alter table public.profiles
  add column extra_roles public.user_role[] not null default '{}',
  add column active_role public.user_role,
  add constraint profiles_extra_roles_check
    check (not (extra_roles && array['owner','customer']::public.user_role[]));

grant select (extra_roles, active_role) on public.profiles to authenticated;

-- ============ HELPERS ============
create or replace function public.has_role(variadic roles public.user_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role = any(roles) or extra_roles && roles
                     from public.profiles where id = (select auth.uid()) and is_active), false)
$$;

-- vai trò đang dùng (nếu active_role không còn hợp lệ thì quay về vai trò chính)
create or replace function public.my_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select case when active_role is not null and (active_role = role or active_role = any(extra_roles))
              then active_role else role end
    from public.profiles where id = (select auth.uid()) and is_active
$$;

-- tất cả vai trò của tôi (vai trò chính đứng đầu)
create or replace function public.my_roles()
returns public.user_role[] language sql stable security definer set search_path = '' as $$
  select array[role] || extra_roles from public.profiles where id = (select auth.uid()) and is_active
$$;
revoke execute on function public.my_roles() from public, anon;
grant execute on function public.my_roles() to authenticated;

-- người dùng chuyển vai trò đang dùng
create or replace function public.set_active_role(p_role public.user_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(p_role) then raise exception 'Bạn không có vai trò này'; end if;
  update public.profiles set active_role = p_role where id = (select auth.uid());
end $$;
revoke execute on function public.set_active_role(public.user_role) from public, anon;
grant execute on function public.set_active_role(public.user_role) to authenticated;

-- chủ spa đặt các vai trò kiêm nhiệm
create or replace function public.set_user_extra_roles(target_user uuid, p_roles public.user_role[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_p record; v_roles public.user_role[];
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được đổi vai trò người dùng'; end if;
  select * into v_p from public.profiles where id = target_user;
  if not found then raise exception 'Không tìm thấy người dùng'; end if;
  if v_p.role = 'owner' then raise exception 'Không đổi được vai trò của tài khoản chủ spa'; end if;
  select coalesce(array_agg(distinct r), '{}') into v_roles
    from unnest(coalesce(p_roles, '{}')) r where r <> v_p.role;
  if v_roles && array['owner','customer']::public.user_role[] then
    raise exception 'Vai trò kiêm nhiệm không hợp lệ';
  end if;
  if v_p.role = 'customer' and cardinality(v_roles) > 0 then
    raise exception 'Tài khoản khách không kiêm vai trò nhân viên';
  end if;
  if v_p.branch_id is null and v_roles && array['receptionist','technician','warehouse']::public.user_role[] then
    raise exception 'Vui lòng chọn chi nhánh cho nhân viên';
  end if;
  update public.profiles
     set extra_roles = v_roles,
         active_role = case when active_role = role or active_role = any(v_roles) then active_role end
   where id = target_user;
end $$;
revoke execute on function public.set_user_extra_roles(uuid, public.user_role[]) from public, anon;
grant execute on function public.set_user_extra_roles(uuid, public.user_role[]) to authenticated;

-- đổi vai trò chính: bỏ vai trò đó khỏi danh sách kiêm nhiệm; chuyển thành khách thì bỏ hết
select pg_temp.patch_fn('public.set_user_role(uuid, public.user_role, uuid)',
  $o$branch_id = case when new_role = 'customer' then null else new_branch end$o$,
  $n$branch_id = case when new_role = 'customer' then null else new_branch end,
         extra_roles = case when new_role = 'customer' then '{}' else array_remove(extra_roles, new_role) end,
         active_role = null$n$);

-- danh sách tài khoản (chủ spa) kèm vai trò kiêm nhiệm
drop function public.list_accounts();
create function public.list_accounts()
returns table (
  id uuid, full_name text, phone text, email text, role public.user_role, branch_id uuid,
  is_active boolean, created_at timestamptz, last_sign_in_at timestamptz, extra_roles public.user_role[]
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.phone, u.email::text, p.role, p.branch_id, p.is_active, p.created_at,
         u.last_sign_in_at, p.extra_roles
    from public.profiles p
    join auth.users u on u.id = p.id
   where public.has_role('owner')
   order by (p.role = 'customer'), p.full_name
$$;
revoke execute on function public.list_accounts() from public, anon;
grant execute on function public.list_accounts() to authenticated;

-- ============ CÁC CHỖ KIỂM TRA VAI TRÒ TRỰC TIẾP ============
-- được gán làm KTV cho dịch vụ
select pg_temp.patch_fn('public.appointment_services_technician_check()',
  $o$p.is_active and p.role in ('technician','manager','owner')$o$,
  $n$p.is_active and (p.role in ('technician','manager','owner') or p.extra_roles && array['technician','manager']::public.user_role[])$n$);

-- quản lý kho
select pg_temp.patch_fn('public.can_manage_warehouse(uuid)',
  $o$p.role in ('owner','manager') or (p.role = 'warehouse' and p.branch_id = w.branch_id)$o$,
  $n$p.role in ('owner','manager') or 'manager' = any(p.extra_roles)
           or (('warehouse' = p.role or 'warehouse' = any(p.extra_roles)) and p.branch_id = w.branch_id)$n$);

-- người được chia doanh số khi thu tiền
select pg_temp.patch_fn('public.checkout_invoice(uuid, uuid, uuid, jsonb, jsonb, numeric, text)',
  $o$and role in ('owner','manager','receptionist','technician')) then$o$,
  $n$and (role in ('owner','manager','receptionist','technician')
                            or extra_roles && array['manager','receptionist','technician']::public.user_role[])) then$n$);

-- vai trò Marketing (thêm cùng ngày) cũng cần chi nhánh khi kiêm nhiệm
select pg_temp.patch_fn('public.set_user_extra_roles(uuid, public.user_role[])',
  $o$array['receptionist','technician','warehouse']::public.user_role[]$o$,
  $n$array['receptionist','technician','warehouse','marketing']::public.user_role[]$n$);
