-- SCAR MESO: cập nhật giá, cost, bước "Sản phẩm meso" theo sheet MESOTHERAPY/MESOGUN (07/11/2026)
update public.services set price = 3850000, member_price = 3500000, cost = 724756
 where id = '23a99607-16fb-40cc-b88b-7243af72f97e';
update public.service_procedure_steps
   set products = array['FUSION MESOMATRIX','KIM MESOGUN'],
       instructions = E'Dùng 3ml meso tay toàn mặt. Phương pháp này cũng có thể sử dụng bằng mesogun\nKim mesogun',
       note = null
 where service_id = '23a99607-16fb-40cc-b88b-7243af72f97e' and step_no = 8;
