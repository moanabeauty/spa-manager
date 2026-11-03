-- Số tiền trong tên dòng / thông báo dùng dấu chấm kiểu Việt Nam (10.000.000đ thay vì 10,000,000đ)
create or replace function pg_temp.patch_fn(p_sig text, p_old text, p_new text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_sig::regprocedure);
begin
  if position(p_old in d) = 0 then raise exception 'Không tìm thấy đoạn cần sửa trong %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

select pg_temp.patch_fn('public.sales_by_item(date,date,uuid)',
  $o$'Nạp thẻ ' || to_char(t.topup_amount, 'FM999G999G999') || 'đ'$o$,
  $n$'Nạp thẻ ' || replace(to_char(t.topup_amount, 'FM999,999,999'), ',', '.') || 'đ'$n$);

select pg_temp.patch_fn('public.discount_push_targets(uuid)',
  $o$'Xin giảm ' || to_char(r.amount, 'FM999G999G999') || 'đ'$o$,
  $n$'Xin giảm ' || replace(to_char(r.amount, 'FM999,999,999'), ',', '.') || 'đ'$n$);
