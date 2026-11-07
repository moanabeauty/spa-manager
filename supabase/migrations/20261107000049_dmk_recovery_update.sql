-- 07/11/2026: cập nhật quy trình + cost DMK FIRE AND ICE, DMK ENZYME, RECOVERY PEEL (tab CHEMICAL PEEL),
-- RECOVERY MESO (tab MESOTHERAPY/MESOGUN); bổ sung sản phẩm còn thiếu theo tab PRODUCT.

-- ===== Sản phẩm =====
-- Tab PRODUCT tách "DMK Herb Mineral Mist" và "DMK Aqua Herb 240ml" thành 2 mã (app đang gộp 1 mã) → giữ mã cũ (tồn kho, lịch sử) làm Herb Mineral Mist
update public.products set name = 'DMK Herb Mineral Mist', used_in = 'DMK, RF Lymphatic, Basic - Lymphas Therapy', updated_at = now()
 where name = 'DMK Herb Mineral Mist / Aqua Herb 240ml';
-- Tab PRODUCT đổi tên REDNESS INNO → REDNESS ID (cùng hộp 4 lọ x 2.5ml, 800k)
update public.products set name = 'REDNESS ID', used_in = 'Recovery Meso',
       note = '800k/4x2.5ml xuất tay; công ty 3,800k chiết khấu 40%', updated_at = now()
 where name = 'REDNESS INNO';

insert into public.products (name, brand, category, capacity, volume, cost_price, used_in, note, for_treatment, for_retail)
select v.name, v.brand, v.category, v.capacity, v.volume, v.cost, v.used_in, v.note, true, false
  from (values
    ('DMK Aqua Herb 240ml', 'DMK', 'TINH CHẤT ĐIỆN DI / BOOSTER / SERUM', '240ml', 240::numeric, 1644500::numeric,
     'DMK, RF Lymphatic, Basic - Lymphas Therapy', null::text),
    ('ACTROL POWDER', 'DMK', 'KEM DƯỠNG / MASSAGE', '30', 30, 2000000, 'DMK', null),
    ('REDNESS PEEL', 'INNOESTHETIC', 'PEEL', 'Hộp 6 ống 2ml', 12, 800000, 'Recovery Peel',
     'Tab PRODUCT ghi dùng cho Glow Peeling 1 (bản 2); giá 800,000 đang nằm ở cột Tổng dung tích')
  ) as v(name, brand, category, capacity, volume, cost, used_in, note)
 where not exists (select 1 from public.products p where lower(p.name) = lower(v.name));

-- ===== Giá / cost liệu trình (theo sheet) =====
update public.services set price = 1900000, member_price = 1500000, cost = 257955 where name_en = 'DMK FIRE AND ICE';
update public.services set price = 1900000, member_price = 1500000, cost = 321050 where name_en = 'DMK ENZYME';
update public.services set price = 1900000, member_price = 1500000, cost = 99995  where name_en = 'RECOVERY PEEL';
update public.services set price = 3000000, member_price = 2500000, cost = 341242 where name_en = 'RECOVERY MESO';

-- ===== Quy trình =====
create temporary table _steps (svc text, step_no int, title text, products text[], instructions text, note text) on commit drop;
insert into _steps values
 -- DMK FIRE AND ICE
 ('DMK FIRE AND ICE', 1, 'Tẩy trang', array['DERMEDIC Hydrain3 Hialuro Micellar Water H2O 500ml'], 'Cho sản phẩm ra bông lau toàn mặt', null),
 ('DMK FIRE AND ICE', 2, 'Rửa mặt', array['CHRISTINA sữa rửa mặt'], 'Tạo bọt sản phẩm trên lòng bàn tay KTV rồi massgae đều trên mặt khách', null),
 ('DMK FIRE AND ICE', 3, 'Xông hơi hút dầu', array['BỘ VẬT TƯ KHẤU HAO'], 'Xông hơi- Hút dầu- Làm sạch vùng mụn mũi và lấy nhân mụn cơ bản', null),
 ('DMK FIRE AND ICE', 4, 'Lấy mụn', array['ACNE TWEEZER'], 'Lấy mụn cơ bản để làm sạch. Không gây tổn thương trên nền da', null),
 ('DMK FIRE AND ICE', 5, 'Làm sạch và sát khuẩn', array[]::text[], 'Làm sạch lại nền da mới nước muối sinh lý', null),
 ('DMK FIRE AND ICE', 6, 'Chuẩn bị da', array['SIMILDIET Chuẩn bị da (Degree Lotion 400ml)'], 'Chuẩn bị da trước khi peel', null),
 ('DMK FIRE AND ICE', 7, 'Peel', array['DMK Quickpeel 120gr','DMK Cryo Pro X 100ml'], E'Peel da\nPeel da', null),
 ('DMK FIRE AND ICE', 8, 'Tinh chất tăng cường', array['DMK Enbioment Serum','DMK Beta Gel','DMK Herbal Pigment Oil','DMK Herb Mineral Mist','ACTROL POWDER'], null, null),
 ('DMK FIRE AND ICE', 9, 'Kem chống nắng', array['NEORETIN / HELIOCARE'], 'Lấy sản phẩm vỗ đều toàn mặt', null),
 -- DMK ENZYME
 ('DMK ENZYME', 1, 'Tẩy trang', array['DERMEDIC Hydrain3 Hialuro Micellar Water H2O 500ml'], 'Cho sản phẩm ra bông lau toàn mặt', null),
 ('DMK ENZYME', 2, 'Rửa mặt', array['CHRISTINA sữa rửa mặt'], 'Tạo bọt sản phẩm trên lòng bàn tay KTV rồi massgae đều trên mặt khách', null),
 ('DMK ENZYME', 3, 'Enzyme', array['DMK Enzyme số 2 120gr','DMK Aqua Herb 240ml'], 'DMK Aqua Herb: dung dịch kích hoạt', null),
 ('DMK ENZYME', 4, 'Xông hơi hút dầu', array['BỘ VẬT TƯ KHẤU HAO'], 'Xông hơi- Hút dầu- Làm sạch vùng mụn mũi và lấy nhân mụn cơ bản', null),
 ('DMK ENZYME', 5, 'Lấy mụn', array['ACNE TWEEZER'], 'Lấy mụn cơ bản để làm sạch. Không gây tổn thương trên nền da', null),
 ('DMK ENZYME', 6, 'Làm sạch và sát khuẩn', array[]::text[], 'Làm sạch lại nền da mới nước muối sinh lý', null),
 ('DMK ENZYME', 7, 'Peel', array['DMK Cryo Pro X 100ml'], 'Peel da', null),
 ('DMK ENZYME', 8, 'Tinh chất tăng cường', array['DMK Enbioment Serum','DMK Beta Gel','DMK Herbal Pigment Oil','DMK Herb Mineral Mist','ACTROL POWDER'], null, null),
 ('DMK ENZYME', 9, 'Kem chống nắng', array['NEORETIN / HELIOCARE'], 'Lấy sản phẩm vỗ đều toàn mặt', null),
 -- RECOVERY PEEL
 ('RECOVERY PEEL', 1, 'Tẩy trang', array['DERMEDIC Hydrain3 Hialuro Micellar Water H2O 500ml'], 'Cho một lượng sản phẩm ra bông rồi lau nhẹ toàn mặt', null),
 ('RECOVERY PEEL', 2, 'Rửa mặt', array['CHRISTINA sữa rửa mặt'], 'Lấy một lượng sản phẩm ra tay thêm nước tạo bọt rồi masage nhẹ toàn mặt', null),
 ('RECOVERY PEEL', 3, 'Xông hơi hút dầu', array['BỘ VẬT TƯ KHẤU HAO'], 'Dùng máy xông hơi toàn mặt, Hút dầu 5 điểm: trán, hai má , cằm , mũi', null),
 ('RECOVERY PEEL', 4, 'Lấy mụn', array['ACNE TWEEZER'], 'sử dụng dụng cụ nặn mụn lấy sạch nhân mụn', null),
 ('RECOVERY PEEL', 5, 'Peel', array['REDNESS PEEL'], 'lấy một lượng sản phẩm vừa đủ sau đỏ bôi toàn mặt để 5-8'' rồi lau sạch với nước', null),
 ('RECOVERY PEEL', 6, 'Kem dưỡng', array['SIMILDIET Post Treatment'], 'Lấy sản phẩm vỗ đều toàn mặt', null),
 ('RECOVERY PEEL', 7, 'Kem chống nắng', array['NEORETIN / HELIOCARE'], 'lấy một lượng sản phẩm vừa đủ vỗ đều bề mặt', null),
 -- RECOVERY MESO
 ('RECOVERY MESO', 1, 'Tẩy trang', array['DERMEDIC Hydrain3 Hialuro Micellar Water H2O 500ml'], 'Cho sản phẩm ra bông lau toàn mặt', null),
 ('RECOVERY MESO', 2, 'Rửa mặt', array['CHRISTINA sữa rửa mặt'], 'Tạo bọt sản phẩm trên lòng bàn tay KTV rồi massgae đều trên mặt khách', null),
 ('RECOVERY MESO', 3, 'Xông hơi hút dầu', array['BỘ VẬT TƯ KHẤU HAO'], 'Xông hơi- Hút dầu- Làm sạch vùng mụn mũi và lấy nhân mụn cơ bản', null),
 ('RECOVERY MESO', 4, 'Lấy mụn', array[]::text[], 'Lấy mụn cơ bản để làm sạch. Không gây tổn thương trên nền da', null),
 ('RECOVERY MESO', 5, 'Ủ tê', array['MẶT NẠ Ủ TÊ DẠNG MIẾNG CONDUCTIVE GEL MASK','KIM 34G (hộp)'], E'Ủ tê cùng màng bọc nilon\nDùng kim tiêm tay tiêm vào vùng nám',
  'Kĩ thuật viên luôn theo dõi phản ứng tê. Nếu có hiện tượng cháy tê phải dùng gel làm dịu và sản phẩm phục hồi ngay'),
 ('RECOVERY MESO', 6, 'Làm sạch và sát khuẩn', array[]::text[], 'Thực hiện lau 4 bước: Bước 1 lau sạch tê, Bước 2 lau bằng bông nước muói, Bước 3 lau với betadin, Bước 4 lau lại 1 lần nữa với nước muối', null),
 ('RECOVERY MESO', 7, 'Sản phẩm meso', array['REDNESS ID'], 'Mix 1 lọ redness', 'Lưu ý có thể tiêm 1 mình redness - nhưng sử dụng pp tiêm tay'),
 ('RECOVERY MESO', 8, 'Chiếu đèn', array['DERMALUX'], 'Chiếu 30'' ánh sáng đỏ + NIR', null),
 ('RECOVERY MESO', 9, 'Mặt nạ', array['MASK LXR'], 'Đắp mặt nạ giấy và điện di với Cryostick', null),
 ('RECOVERY MESO', 10, 'Kem dưỡng', array['SIMILDIET Post Treatment'], 'Vỗ đều sản phẩm toàn mặt', null);

delete from public.service_procedure_steps p using public.services s
 where s.id = p.service_id and s.name_en in (select distinct svc from _steps);
insert into public.service_procedure_steps (service_id, step_no, title, products, instructions, note)
select s.id, t.step_no, t.title, t.products, t.instructions, t.note
  from _steps t join public.services s on s.name_en = t.svc;
