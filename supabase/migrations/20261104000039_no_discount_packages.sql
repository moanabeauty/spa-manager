-- Gói combo và nạp thẻ tài khoản KHÔNG được giảm giá (cả giảm từng dòng lẫn giảm chung cả hoá đơn)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.checkout_invoice(uuid,uuid,uuid,jsonb,jsonb,numeric,text)'::regprocedure);

  -- giảm riêng dòng gói combo
  d := replace(d,
    $x$      v_desc := 'Gói ' || v_rec.name;
$x$,
    $x$      v_desc := 'Gói ' || v_rec.name;
      if v_disc <> 0 then raise exception 'Gói combo không áp dụng giảm giá'; end if;
$x$);
  -- giảm chung cả hoá đơn không chia vào gói combo
  d := replace(d, $x$item_type not in ('card_topup','product')$x$, $x$item_type not in ('card_topup','product','package')$x$);
  d := replace(d,
    $x$'Giảm giá lớn hơn tổng tiền dịch vụ / gói (sản phẩm bán lẻ và dòng khuyến mãi không áp dụng giảm chung)'$x$,
    $x$'Giảm giá lớn hơn tổng tiền dịch vụ (gói combo, nạp thẻ, sản phẩm bán lẻ và dòng khuyến mãi không áp dụng giảm chung)'$x$);

  if position('Gói combo không áp dụng giảm giá' in d) = 0
     or position($x$('card_topup','product','package')$x$ in d) = 0 then
    raise exception 'checkout_invoice: không tìm thấy đoạn cần sửa';
  end if;
  execute d;
end $$;
