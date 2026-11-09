-- Tab Marketing: lịch bài viết (timeline tháng) + kế hoạch quay / chụp / họp content + trao đổi
-- Chỉ chủ spa và nhân viên Marketing thấy / dùng.
-- Bài viết: Ý tưởng → Đang làm → Chờ duyệt → (Cần sửa) → Đã duyệt → Đã đăng. Chỉ chủ spa duyệt.

-- ===== 1. Vai trò Marketing dùng chung các chức năng nhân viên =====
-- Marketing chấm công, tạo phiếu thu/chi, cần chi nhánh (để chấm công theo vị trí);
-- KHÔNG tìm / xem khách hàng, hoá đơn.
do $$
declare
  v_def text;
begin
  -- chấm công vào
  v_def := pg_get_functiondef('public.check_in(double precision, double precision)'::regprocedure);
  v_def := replace(v_def, $q$has_role('manager','receptionist','technician','warehouse','owner')$q$,
                          $q$has_role('manager','receptionist','technician','warehouse','marketing','owner')$q$);
  execute v_def;

  -- phiếu thu / chi tại quầy
  v_def := pg_get_functiondef('public.create_cash_voucher(uuid, text, uuid, numeric, text, text)'::regprocedure);
  v_def := replace(v_def, $q$has_role('owner','manager','receptionist','technician','warehouse')$q$,
                          $q$has_role('owner','manager','receptionist','technician','warehouse','marketing')$q$);
  execute v_def;

  -- cấp vai trò: Marketing bắt buộc có chi nhánh
  v_def := pg_get_functiondef('public.set_user_role(uuid, public.user_role, uuid)'::regprocedure);
  v_def := replace(v_def, $q$new_role in ('receptionist','technician','warehouse')$q$,
                          $q$new_role in ('receptionist','technician','warehouse','marketing')$q$);
  execute v_def;

  -- tìm khách hàng: Marketing không được dùng (giống kho)
  v_def := pg_get_functiondef('public.search_customers(text, integer)'::regprocedure);
  v_def := replace(v_def, $q$public.my_role()::text = 'warehouse'$q$,
                          $q$public.my_role()::text in ('warehouse','marketing')$q$);
  execute v_def;

  -- ô tìm kiếm chung: Marketing không thấy khách / hoá đơn
  v_def := pg_get_functiondef('public.staff_search_v2(text)'::regprocedure);
  v_def := replace(v_def, $q$if v_role <> 'warehouse' then$q$, $q$if v_role not in ('warehouse','marketing') then$q$);
  execute v_def;
end $$;

-- ===== 2. Quyền dùng tab Marketing =====
create or replace function public.is_marketing()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role('owner','marketing')
$$;
revoke execute on function public.is_marketing() from public, anon;
grant execute on function public.is_marketing() to authenticated;

-- ===== 3. Bài viết =====
create table public.marketing_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  pic_id uuid references public.profiles(id) on delete set null,          -- người phụ trách
  channels text[] not null default '{}'
    check (channels <@ array['facebook','tiktok','instagram','zalo','website']::text[]),
  format text not null default 'post'
    check (format in ('post','album','video','reel','story','article','other')),
  due_date date,                                                           -- deadline nộp bài
  publish_date date,                                                       -- ngày cần đăng
  status text not null default 'idea'
    check (status in ('idea','doing','review','revise','approved','published','cancelled')),
  brief text,                                                              -- ý tưởng / nội dung / caption
  draft_url text,                                                          -- link bản nháp (Drive, Canva…)
  published_url text,                                                      -- link bài đã đăng
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  published_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or publish_date is null or due_date <= publish_date)
);
create index marketing_posts_publish_idx on public.marketing_posts (publish_date);
create index marketing_posts_due_idx on public.marketing_posts (due_date);
create index marketing_posts_pic_idx on public.marketing_posts (pic_id);

-- ===== 4. Kế hoạch quay / chụp / họp content =====
create table public.marketing_plans (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'video' check (kind in ('video','photo','meeting','other')),
  title text not null check (length(btrim(title)) > 0),
  start_at timestamptz not null,
  end_at timestamptz,
  location text,
  pic_id uuid references public.profiles(id) on delete set null,
  note text,                                                               -- kịch bản / chuẩn bị / nội dung họp
  status text not null default 'planned' check (status in ('planned','done','cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at is null or end_at >= start_at)
);
create index marketing_plans_start_idx on public.marketing_plans (start_at);

-- ===== 5. Trao đổi (bình luận) trên bài viết / kế hoạch =====
create table public.marketing_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.marketing_posts(id) on delete cascade,
  plan_id uuid references public.marketing_plans(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id, plan_id) = 1)
);
create index marketing_comments_post_idx on public.marketing_comments (post_id, created_at);
create index marketing_comments_plan_idx on public.marketing_comments (plan_id, created_at);

-- ===== 6. Quy tắc trạng thái bài viết =====
create or replace function public.marketing_posts_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner boolean := public.has_role('owner');
  v_old text := case when tg_op = 'UPDATE' then old.status end;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  if new.status is distinct from v_old then
    if new.status in ('approved','revise') then
      if not v_owner then raise exception 'Chỉ chủ spa được duyệt bài'; end if;
      new.reviewed_by := (select auth.uid());
      new.reviewed_at := now();
    elsif new.status = 'published' then
      if not v_owner and coalesce(v_old, '') <> 'approved' then
        raise exception 'Bài chưa được chủ spa duyệt, chưa đánh dấu đã đăng được';
      end if;
      new.published_at := coalesce(new.published_at, now());
    elsif new.status = 'review' then
      new.submitted_at := now();
    end if;
  end if;
  -- Marketing sửa nội dung bài đã duyệt (chưa đăng) → quay lại chờ duyệt
  if tg_op = 'UPDATE' and not v_owner and old.status = 'approved' and new.status = 'approved'
     and (new.brief is distinct from old.brief or new.draft_url is distinct from old.draft_url
          or new.title is distinct from old.title) then
    new.status := 'review';
    new.submitted_at := now();
  end if;
  return new;
end $$;
create trigger marketing_posts_guard before insert or update on public.marketing_posts
  for each row execute function public.marketing_posts_guard();

create or replace function public.marketing_plans_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.created_by := old.created_by; end if;
  return new;
end $$;
create trigger marketing_plans_touch before insert or update on public.marketing_plans
  for each row execute function public.marketing_plans_touch();

revoke execute on function public.marketing_posts_guard(), public.marketing_plans_touch() from public, anon, authenticated;

-- ===== 7. Bảo mật (chỉ chủ spa + Marketing) =====
alter table public.marketing_posts enable row level security;
alter table public.marketing_plans enable row level security;
alter table public.marketing_comments enable row level security;

create policy "marketing read" on public.marketing_posts for select to authenticated using ((select public.is_marketing()));
create policy "marketing insert" on public.marketing_posts for insert to authenticated with check ((select public.is_marketing()));
create policy "marketing update" on public.marketing_posts for update to authenticated
  using ((select public.is_marketing())) with check ((select public.is_marketing()));
create policy "marketing delete" on public.marketing_posts for delete to authenticated
  using ((select public.has_role('owner')) or (created_by = (select auth.uid()) and (select public.is_marketing())));

create policy "marketing read" on public.marketing_plans for select to authenticated using ((select public.is_marketing()));
create policy "marketing insert" on public.marketing_plans for insert to authenticated with check ((select public.is_marketing()));
create policy "marketing update" on public.marketing_plans for update to authenticated
  using ((select public.is_marketing())) with check ((select public.is_marketing()));
create policy "marketing delete" on public.marketing_plans for delete to authenticated
  using ((select public.has_role('owner')) or (created_by = (select auth.uid()) and (select public.is_marketing())));

create policy "marketing read" on public.marketing_comments for select to authenticated using ((select public.is_marketing()));
create policy "marketing insert" on public.marketing_comments for insert to authenticated
  with check ((select public.is_marketing()) and author_id = (select auth.uid()));
create policy "marketing delete" on public.marketing_comments for delete to authenticated
  using ((select public.has_role('owner')) or (author_id = (select auth.uid()) and (select public.is_marketing())));

grant select, insert, update, delete on public.marketing_posts, public.marketing_plans, public.marketing_comments to authenticated;
revoke all on public.marketing_posts, public.marketing_plans, public.marketing_comments from anon;
