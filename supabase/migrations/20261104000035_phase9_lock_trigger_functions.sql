-- hàm trigger không gọi trực tiếp qua API
revoke execute on function public.invoices_debt_check() from public, anon, authenticated;
revoke execute on function public.posts_before_write() from public, anon, authenticated;
