-- Chủ spa xác nhận 11/11/2026:
-- MESOGUN PACKAGE 5: KTV được chọn Glow Mesogun hoặc Biocomplex Mesogun
-- Đổi tên combo theo sheet: FULL FACE V-LIFT x3, B.A.P RADIESSE
insert into public.package_item_services (item_id, service_id)
select pi.id, s.id
  from public.packages p
  join public.package_items pi on pi.package_id = p.id and pi.sort_order = 1
  join public.services s on upper(s.name_en) = 'BIOCOMPLEX MESOGUN' and s.is_active
 where p.name = 'MESOGUN PACKAGE 5'
   and not exists (select 1 from public.package_item_services x where x.item_id = pi.id and x.service_id = s.id);

update public.packages set name = 'FULL FACE V-LIFT x3' where name = 'FULLFACE V-LIFT+ X3';
update public.packages set name = 'B.A.P RADIESSE' where name = 'B.A.P RADIESSE X2';
