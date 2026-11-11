-- push_dispatch trả thêm mã thông báo (nid) để bấm vào thông báo trên điện thoại thì tự đánh dấu đã đọc
drop function if exists public.push_dispatch(uuid[], text);
create function public.push_dispatch(p_ids uuid[], p_secret text)
returns table (nid uuid, sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text, tag text, unread integer)
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or p_secret is distinct from (select value from private.push_config where key = 'secret') then
    raise exception 'forbidden';
  end if;
  return query
  with picked as (
    update public.notifications n set pushed_at = now()
     where n.id = any(p_ids) and n.pushed_at is null
    returning n.*
  )
  select pk.id, s.endpoint, s.p256dh, s.auth, pk.title, pk.body, pk.url, pk.tag,
         (select count(*)::int from public.notifications u where u.user_id = pk.user_id and u.read_at is null)
    from picked pk
    join public.push_subscriptions s on s.user_id = pk.user_id;
end $$;
revoke execute on function public.push_dispatch(uuid[], text) from public;
grant execute on function public.push_dispatch(uuid[], text) to anon, authenticated;

-- Cài đặt 1 lần (không lưu trong git): địa chỉ app + mã bí mật trùng biến PUSH_WEBHOOK_SECRET trên Vercel
-- insert into private.push_config(key, value) values
--   ('url', 'https://spa-manager-five.vercel.app/api/thong-bao/day'), ('secret', '<PUSH_WEBHOOK_SECRET>');
