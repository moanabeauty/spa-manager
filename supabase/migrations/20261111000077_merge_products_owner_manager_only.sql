-- Gộp sản phẩm: bỏ quyền của NV kho, chỉ chủ spa / quản lý (NV kho không xem/sửa được giá nhập nên gộp sẽ mất giá nhập)
do $$
declare v_def text := pg_get_functiondef('public.merge_products(uuid, uuid)'::regprocedure);
begin
  v_def := replace(v_def, $q$public.has_role('owner', 'manager', 'warehouse') then raise exception 'Chỉ chủ, quản lý hoặc NV kho được gộp sản phẩm'$q$,
                          $q$public.has_role('owner', 'manager') then raise exception 'Chỉ chủ spa hoặc quản lý được gộp sản phẩm'$q$);
  if v_def not like '%Chỉ chủ spa hoặc quản lý được gộp%' then raise exception 'merge_products: không tìm thấy đoạn cần sửa'; end if;
  execute v_def;
end $$;
