-- Chủ spa xác nhận 11/11/2026:
-- PORE INSTANT PACKAGE 2 bán như gói riêng (cùng hướng điều trị với SCAR TREATMENT + nhưng khác tên)
-- HIFU FULL FACE V-LIFT đổi tên thành FULLFACE V-LIFT+ X3 (thay cho HIFU X3 (1 NĂM) trong sheet)
update public.packages set is_active = true where name = 'PORE INSTANT PACKAGE 2';
update public.packages set name = 'FULLFACE V-LIFT+ X3' where name = 'HIFU FULL FACE V-LIFT';
