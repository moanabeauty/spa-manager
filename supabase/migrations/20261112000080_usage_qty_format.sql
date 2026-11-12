-- Sửa hiển thị số lượng trong thông báo thiếu sản phẩm: 0.5 ml hiện đúng "0.5" (trước bị làm tròn thành "1")
do $$
begin
  execute replace(pg_get_functiondef('public._consume_session(uuid,jsonb)'::regprocedure), 'FM999999990.###', 'FM999999990.999');
end $$;
