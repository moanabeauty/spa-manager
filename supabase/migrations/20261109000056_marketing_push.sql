-- Marketing gửi bài chờ duyệt -> báo lên điện thoại chủ spa (mỗi lần gửi duyệt báo 1 lần)
alter table public.marketing_posts add column if not exists review_notified_at timestamptz;

create or replace function public.marketing_push_targets(p_post uuid)
returns table(sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text)
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not public.has_role('marketing') then return; end if;
  select m.*, p.full_name as pic_name
    into r
    from public.marketing_posts m
    left join public.profiles p on p.id = m.pic_id
   where m.id = p_post and m.status = 'review'
     and m.submitted_at > now() - interval '15 minutes'
     and (m.review_notified_at is null or m.review_notified_at < m.submitted_at)
   for update of m;
  if not found then return; end if;
  update public.marketing_posts set review_notified_at = now() where id = p_post;
  return query
  select s.endpoint, s.p256dh, s.auth,
         'Bài chờ duyệt: ' || r.title,
         coalesce(r.pic_name, 'Marketing')
           || coalesce(' · đăng ngày ' || to_char(r.publish_date, 'DD/MM'), '')
    from public.push_subscriptions s
    join public.profiles p on p.id = s.user_id
   where p.role = 'owner' and p.is_active;
end $$;
revoke execute on function public.marketing_push_targets(uuid) from public, anon;
grant execute on function public.marketing_push_targets(uuid) to authenticated;
