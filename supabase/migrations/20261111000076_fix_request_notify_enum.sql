-- Sửa lỗi: trigger thông báo so sánh status với 'review' (chỉ có ở bài Marketing) làm lỗi khi tạo
-- phiếu xin xuất / phiếu khác có cột status kiểu enum ("invalid input value for enum … review").
-- So sánh dạng chữ (::text) cho mọi bảng. Kiểm kho đầu kỳ có nhãn thông báo riêng.
do $m$
declare d text := pg_get_functiondef('private.on_request_change()'::regprocedure);
begin
  d := replace(d, $a$(t = 'marketing_posts' and new.status = 'review')$a$, $a$(t = 'marketing_posts' and new.status::text = 'review')$a$);
  d := replace(d, $a$v_new_pending := new.status = 'review' and old.status is distinct from 'review';$a$,
                  $a$v_new_pending := new.status::text = 'review' and old.status::text is distinct from 'review';$a$);
  d := replace(d, $a$if old.status = 'review' and new.status in ('approved', 'revise') then v_done := case when new.status = 'approved'$a$,
                  $a$if old.status::text = 'review' and new.status::text in ('approved', 'revise') then v_done := case when new.status::text = 'approved'$a$);
  d := replace(d, $a$v_requester := new.created_by; v_label := 'Kiểm kho có chênh lệch';$a$,
                  $a$v_requester := new.created_by;
    v_label := case when new.kind = 'opening' then 'Kiểm kho đầu kỳ' else 'Kiểm kho có chênh lệch' end;$a$);
  if d not like '%new.status::text = ''review'' and old.status::text%' or d not like '%Kiểm kho đầu kỳ%' then
    raise exception 'patch on_request_change thất bại';
  end if;
  execute d;
end $m$;
