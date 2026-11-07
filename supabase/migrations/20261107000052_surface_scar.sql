-- 07/11/2026: thêm SURFACE SCAR – Kiểm soát bề mặt sẹo (sheet Menu nhóm ACNE SCAR + tab ACNE SCAR)
-- Private (chỉ nội bộ). Tiền dịch vụ KTV tạm bằng Scar Therapy (100k) vì sheet chưa ghi; cost chưa có.
with src as (
  select category_id, technician_fee, card_allowed, commission_eligible, recall_days, followup_days
    from public.services where name_en = 'CẮT ĐÁY SẸO (ACNE SCAR)'
), ins as (
  insert into public.services (category_id, name, name_en, price, member_price, technician_fee, duration_minutes,
                               card_allowed, commission_eligible, recall_days, followup_days, menu_tier, is_active)
  select category_id, 'Kiểm soát bề mặt sẹo', 'SURFACE SCAR', 4500000, 3850000, technician_fee, 60,
         card_allowed, commission_eligible, recall_days, followup_days, 'private', true
    from src
   where not exists (select 1 from public.services where name_en = 'SURFACE SCAR')
  returning id
), steps as (
  insert into public.service_procedure_steps (service_id, step_no, title, products, instructions, note)
  select ins.id, v.step_no, v.title, v.products, v.instructions, v.note
    from ins, (values
      (1, 'Tẩy trang', array['DERMEDIC Hydrain3 Hialuro Micellar Water H2O 500ml'], 'Cho sản phẩm ra bông lau toàn mặt', null),
      (2, 'Rửa mặt', array['CHRISTINA sữa rửa mặt'], 'Tạo bọt sản phẩm trên lòng bàn tay KTV rồi massgae đều trên mặt khách', null),
      (3, 'Xông hơi hút dầu', array['BỘ VẬT TƯ KHẤU HAO'], 'Xông hơi- Hút dầu- Làm sạch vùng mụn mũi và lấy nhân mụn cơ bản', null),
      (4, 'Lấy mụn', array['ACNE TWEEZER'], 'Lấy mụn cơ bản để làm sạch. Không gây tổn thương trên nền da', null),
      (5, 'Làm sạch và sát khuẩn', array[]::text[], 'Làm sạch lại nền da mới nước muối sinh lý', null),
      (6, 'Ủ tê', array['TÊ TRẮNG SAMSUNGPHARM 450ml'], 'Ủ tê cùng màng bọc nilon',
          'Kĩ thuật viên luôn theo dõi phản ứng tê. Nếu có hiện tượng cháy tê phải dùng gel làm dịu và sản phẩm phục hồi ngay'),
      (7, 'Cà bề mặt sẹo', array['DAO MỔ số 11 / 12'], 'Dùng dao cà bề mặt ở vùng sẹo có gờ ( sẹo đáy vuông)', null),
      (8, 'Lăn kim', array['KIM LĂN 2.0'], null, null),
      (9, 'Sẹo đáy nhọn - chấm TCA', array['TCA Aktivator 50%'],
          'Dùng kim 1 phi thẳng vuông góc vào vùng sẹo / chấm TCA' || chr(10) || 'Dùng đầu tăm nhọn đã khử trùng chấm trực tiếp vào vùng da gặp vấn đề',
          'End point: Frosting trắng sứ'),
      (10, 'Peel', array['TCA SKINTECH'], 'Peel toàn bề mặt', 'End point : Frosting trắng'),
      (11, 'Peel 2', array['RETINOL NEOSTRATA'], 'Có thể dùng thêm lớp peel tăng cường để kích thích tái tạo',
          'Chỉ định: Khách hàng nên sử dụng Tretinoin để kích thích tái tạo, Đồng Peptide để giảm đỏ'),
      (12, 'Kem dưỡng', array['SIMILDIET Post Treatment'], 'lấy một lượng sản phẩm vừa đủ vỗ đều bề mặt', null)
    ) as v(step_no, title, products, instructions, note)
  returning 1
)
insert into public.service_guides (service_id, indication, indication_ext, consult_guide)
select ins.id,
       'Sẹo rỗ' || chr(10) || 'Thích hợp nhất cho sẹo đáy vuông, đáy tròn' || chr(10) || 'Lỗ chân lông to lâu năm',
       g.indication_ext, g.consult_guide
  from ins
  left join public.service_guides g on g.service_id = (select id from public.services where name_en = 'CẮT ĐÁY SẸO (ACNE SCAR)');
