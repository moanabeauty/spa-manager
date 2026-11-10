-- Menu dịch vụ lẻ theo sheet Menu (11/11/2026)
--   name_en       = TÊN TRUYỀN THÔNG (tên chính khách + nhân viên nhìn thấy)
--   name          = DIỄN GIẢI NGẮN BẰNG TIẾNG VIỆT (dòng chú thích dưới tên)
--   internal_name = TÊN NỘI BỘ (chỉ hiện cho nhân viên, để phân biệt các liệu trình trùng tên truyền thông)
--   internal_note = GHI CHÚ (chỉ hiện cho nhân viên; trước đây nằm ở description nên khách nhìn thấy)
--   menu_tier     = HIỂN THỊ APP (Public / Công khai = public; còn lại = private)
-- Giá không đổi ở bước này.

alter table public.services
  add column if not exists internal_name text,
  add column if not exists internal_note text;

do $$
declare v_n int;
begin
  create temp table _m(cat_sort int, k text, new_name text, tier text, internal text, vn text, note text) on commit drop;
  insert into _m values
(1,'PURIFYING TREATMENT','PURIFYING TREATMENT','public','Chăm sóc da dầu cơ bản','Chăm sóc da dầu cơ bản',null),
(1,'HYDRAIN3 TREATMENT','HYDRAIN3 TREATMENT','public','Chăm sóc da khô cơ bản','Cấp ẩm cơ bản',null),
(1,'ACNE TWEEZER','ACNE TWEEZER','public','Gắp mụn','Kiểm soát mụn chuyên sâu',null),
(1,'ION BRIGHT','ION BRIGHT','public','Điện di làm sáng','Thư giãn làm sáng da',null),
(1,'PRO CALM','PRO CALM','public','Điện di làm dịu','Thư giãn làm dịu, cấp ẩm',null),
(1,'DETOX SKIN','DETOX SKIN','public','Detox sạch sâu','Thải độc, làm sạch sâu lỗ chân lông (Vortex)',null),
(1,'ENZYME POWER','ENZYME POWER','public','Điện di da mụn','Enzyme làm sạch, sáng mịn da',null),
(1,'LYMPHAS THERAPY','LYMPHAS THERAPY','public','Tẩy da chết kiềm dầu','Dẫn lưu bạch huyết, giảm bọng phù','Chưa có giá niêm yết'),
(2,'BIO-DERM BASIC – OILY SKIN','BIO-DERM BASIC – OILY SKIN','private','Chăm sóc da dầu với sản phẩm Bioderma','Chăm sóc da dầu cơ bản',null),
(2,'BIO-DERM BASIC – DRY SKIN','BIO-DERM BASIC – DRY SKIN','private','Chăm sóc da khô với sản phẩm Bioderma','Cấp ẩm cơ bản',null),
(2,'BIO-DERM ACNE CONTROL','BIO-DERM ACNE CONTROL','private','Lấy nhân mụn với sản phẩm Bioderma','Kiểm soát mụn chuyên sâu',null),
(3,'BR BASIC – OILY SKIN','BASIC TREATMENT FOR OILY SKIN','public','Chăm sóc da dầu cơ bản với BR','Chăm sóc da dầu cơ bản',null),
(3,'BR BASIC – DRY SKIN','BASIC TREATMENT FOR DRY SKIN','public','Chăm sóc da khô cơ bản với BR','Chăm sóc da khô cơ bản',null),
(3,'BIOSENSIBLE','BIOSENSIBLE TREATMENT','public','Liệu trình cho da nhạy cảm','Làm dịu, phục hồi da nhạy cảm',null),
(3,'SOIN LOTION MC110','SOIN LOTION MC110','public','Liệu trình cho da dầu mụn, mụn viêm','Làm sạch sâu da dầu mụn, dày sừng',null),
(3,'BOOSTER VIP O2','BOOSTER VIP O2','public','Liệu trình làm sạch sâu, cung cấp oxy','Thải độc, cung cấp oxy cho da',null),
(3,'SOIN LISSANT','SOIN LISSANT','public','Liệu trình cấp ẩm căng bóng','Cấp ẩm căng bóng, mờ nếp nhăn li ti',null),
(3,'LIFT CVS','LIFT CVS','public','Liệu trình nâng cơ','Nâng cơ, tạo đường viền khuôn mặt',null),
(3,'TOLE SKIN','TOLE SKIN','public','Liệu trình cho da nhạy cảm','Phục hồi da nhạy cảm, tổn thương',null),
(3,'COCKTAIL D''ACTIFS RÉGÉNÉRANTS','COCKTAIL D''ACTIFS RÉGÉNÉRANTS','public','Phi kim chống lão hoá với BR','Tái tạo và làm sáng da',null),
(4,'ACNE PEEL','ACNE PEEL','private','Peel mụn đa hoạt chất (Recovery Inno)','Peel mụn đa hoạt chất',null),
(4,'SENSITIVE ACNE PEEL','SENSITIVE ACNE PEEL','private','Peel mụn da nhạy cảm (Sesderma Azelac)','Peel mụn da nhạy cảm',null),
(4,'SOS PEEL','SOS PEEL','private','Peel làm dịu da yếu, thiếu ẩm (Agrilac)','Peel làm dịu da yếu, thiếu ẩm',null),
(4,'RECOVERY PEEL','RECOVERY PEEL','private','Peel phục hồi giảm đỏ (Redness Inno)','Peel phục hồi giảm đỏ',null),
(4,'BRIGHTENING PEEL','BRIGHTENING PEEL','private','Peel làm sáng, mờ thâm (MD Ceutical)','Peel làm sáng, mờ thâm',null),
(4,'GLOW PEELING – JA MANDELIC','GLOW PEELING','private','Peel căng bóng – có bong (JA Mandelic 50)','Peel căng bóng – có bong',null),
(4,'GLOW PEELING – GIGI MANDELIC','GLOW PEELING','private','Peel căng bóng tức thì – không bong (GIGI Mandelic 15)','Peel căng bóng tức thì – không bong',null),
(4,'WHITE PEELING','WHITE PEELING','private','Ủ trắng, căng bóng da (Dermaquest)','Ủ trắng, căng bóng da',null),
(4,'BIO PEELING','BIO PEELING','private','Peel vi tảo sinh học (Zena)','Peel vi tảo sinh học',null),
(4,'SCAR PEELING','SCAR PEELING','private','Peel sẹo rỗ (TCA Skintech)','Peel sẹo rỗ',null),
(4,'DMK ENZYME','DMK ENZYME','private','Liệu pháp enzyme DMK','Liệu pháp enzyme DMK',null),
(4,'DMK FIRE AND ICE','DMK FIRE AND ICE','private','Peel “lửa và băng” DMK','Peel “lửa và băng” DMK',null),
(5,'DARKSPOT MESO','DARKSPOT MESOTHERAPY','private','Mesotherapy vùng sắc tố','Meso điểm sắc tố',null),
(5,'GLOW MESO','GLOW MESOGUN','private','Mesogun căng bóng','Meso căng bóng',null),
(5,'RECOVERY MESO','RECOVERY MESO','private','Mesotherapy phục hồi (Inno Redness)','Meso phục hồi',null),
(5,'BRIGHTENING MESO','BRIGHTENING MESO','private','Mesotherapy làm sáng nâng tone da','Meso làm sáng',null),
(5,'MESOBOTOX','MESOBOTOX','private','Meso Botox thu nhỏ lỗ chân lông, giảm tiết dầu','Meso xoá nhăn','HA tạm tính theo Lapuroon 3ml'),
(5,'ACNE MESO','ACNE MESO','private','Mesotherapy kiềm dầu, kiểm soát mụn','Meso điều trị mụn',null),
(5,'ACNE SPOT MESO','ACNE SPOT MESO','private','Mesotherapy kiểm soát viêm điểm mụn','Meso chấm nốt mụn',null),
(5,'MESO MEDISEPTE (BIOCOMPLEX)','BIOCOMPLEX MESOGUN','private','Mesogun căng bóng phục hồi','Meso căng bóng da',null),
(5,'MESO TEOXANE','TEOXANE MESOGUN','private','Mesogun trẻ hoá, mờ nếp nhăn','Meso Teoxane trẻ hoá',null),
(5,'SCAR MESO','SCAR MESO','private','Mesotherapy tăng sinh collagen đầy sẹo','Meso vùng sẹo',null),
(6,'PORE INSTANT','PORE INSTANT MTS','public','Phi kim mụn và lỗ chân lông','Phi kim thu nhỏ lỗ chân lông, kiềm dầu',null),
(6,'BRIGHTENING MN','BRIGHTENING MTS','public','Phi kim làm sáng','Phi kim làm sáng, mờ nám',null),
(6,'RECOVERY MN','RECOVERY MTS','public','Phi kim phục hồi','Phi kim phục hồi da yếu',null),
(6,'GLOW MN','GLOW MTS','public','Phi kim cấp ẩm','Phi kim cấp ẩm căng bóng',null),
(6,'GLOW FEST','GLOW FEST','public','Phi kim cấp ẩm Superjection','Phi kim căng bóng Superjection',null),
(6,'RENEW FEST','RENEW FEST','public','Phi kim tái tạo Superjection','Phi kim tái tạo Superjection','Dùng hết hàng thì cắt mã'),
(7,'MNRF INVASIVE','MNRF','private','Vi kim RF xâm lấn (có kim)','Vi kim RF chuyên sâu',null),
(7,'MNRF NON-INVASIVE','RF SKIN GYM','private','RF không xâm lấn (SkinGym)','RF (SkinGym)',null),
(7,'RF LYMPHATIC RESET','RF LYMPHATIC RESET','private','RF + enzyme DMK thải độc bạch huyết','RF + enzyme DMK thải độc bạch huyết','Giá trải nghiệm 1.900k'),
(8,'MPT BOOSTER','MPT BOOSTER','private','MPT mặt','MPT trẻ hoá, săn chắc da',null),
(8,'NECK MPT BOOSTER','NECK MPT BOOSTER','private','MPT cổ','MPT vùng cổ, nọng cằm',null),
(8,'HIFU FULLFACE','FULL FACE V-LIFT+','private','HIFU toàn mặt và cổ','HIFU nâng cơ toàn mặt',null),
(9,'CẮT ĐÁY SẸO (ACNE SCAR)','SCAR THERAPY','private','Cắt đáy sẹo','Phác đồ trị sẹo rỗ phối hợp',null),
(9,'SURFACE SCAR','SURFACE SCAR','private','Kiểm soát bề mặt sẹo','Kiểm soát bề mặt sẹo',null),
(10,'LIGHT THERAPY (PDT)','LIGHT THERAPY','private','PDT chiếu đèn Dermalux','Liệu pháp ánh sáng trị mụn',null),
(11,'RF EYEZONE CARE','EYE FIRM','public','RF cho vùng mắt kết hợp sản phẩm Ericson','RF xoá nhăn trẻ hoá vùng mắt',null),
(11,'HIFU EYEZONE CARE','EYE LIFT','public','HIFU cho vùng mắt kết hợp sản phẩm Ericson','HIFU săn chắc vùng mắt',null),
(11,'BRIGHTENING EYE MESO','BRIGHTENING EYE MESO','private','Meso làm sáng mờ thâm vùng mắt','Meso làm sáng vùng mắt',null),
(11,'HYDRATING EYE MESO','HYDRATING EYE MESO','private','Meso cấp ẩm vùng mắt','Meso cấp ẩm vùng mắt',null),
(11,'ANTI-AGING EYE MESO','ANTI-AGING EYE MESO','private','Meso chống lão hoá mờ nếp nhăn vùng mắt (Jalupro)','Meso chống nhăn li ti vùng mắt',null),
(11,'TEOXANE EYE','EYE REFILL','private','Filler Teoxane trẻ hoá, làm đầy rãnh lệ','Bù thể tích vùng trũng mắt',null),
(11,'THERMO EYE','THERMO EYE','public','Chăm sóc vùng mắt với DMK','Chăm sóc vùng mắt Thermo',null),
(12,'WHITE BODY PEEL','WHITE BODY PEEL','public','Peel body mờ thâm tảo Zena','Peel trắng da body',null),
(12,'AFTERSUN BODY','AFTERSUN BODY','public','Làm dịu da body cháy nắng','Phục hồi da body sau nắng',null),
(12,'BRIGHTENING LASER BODY','BRIGHTENING LASER BODY','private','Laser body mờ thâm','Laser làm sáng da body',null),
(12,'ACNE BODY PEEL','ACNE BODY PEEL','public','Peel mụn lưng tảo Zena','Peel mụn lưng, body',null),
(13,'ANTI HAIR LOSS MESO','ANTI HAIR LOSS MESO','private','Meso kích thích mọc tóc Skin Genuity','Meso kích thích mọc tóc',null),
(13,'OWAY BIOSCALP RESET','OWAY BIOSCALP RESET','public','Detox da đầu Oway','Detox da đầu Oway',null),
(13,'OWAY HAIRWASH','OWAY HAIRWASH','public','Gội đầu Oway','Gội đầu Oway','Thu về min 200.000'),
(13,'ANTI HAIR LOSS MN – RADICAL','ANTI HAIR LOSS MTS','public','Phi kim chống rụng tóc (Radical)','Phi kim chống rụng tóc',null),
(13,'ANTI HAIR LOSS MN – BIOTIN','ANTI HAIR LOSS MTS','private','Phi kim chống rụng tóc (Benpathen + Biotin)','Phi kim chống rụng tóc',null),
(14,'MẶT','FULL FACE','public','Triệt lông mặt','Triệt lông mặt',null),
(14,'MÉP','UPPER LIP','public','Triệt lông mép','Triệt lông mép',null),
(14,'NÁCH','UNDER ARM','public','Triệt lông nách','Triệt lông nách',null),
(14,'TAY','ARMS','public','Triệt lông tay','Triệt lông tay',null),
(14,'CHÂN','LEGS','public','Triệt lông chân','Triệt lông chân',null),
(14,'BIKINI','BIKINI LINE','public','Triệt lông bikini','Triệt lông bikini',null),
(14,'BODY','FULL BODY','public','Triệt lông toàn thân','Triệt lông toàn thân',null),
(15,'PORE INSTANT','PORE INSTANT','private','Laser se khít lỗ chân lông','Laser se khít lỗ chân lông',null),
(15,'TONING','TONING','private','Laser toning làm sáng, đều màu da','Laser làm sáng, đều màu da',null),
(15,'ERYTHROS','ERYTHROS','private','Laser giảm đỏ, giãn mao mạch','Laser giảm đỏ, giãn mao mạch',null),
(15,'ACNE','ACNE','private','Laser điều trị mụn','Laser điều trị mụn',null),
(15,'DARK SPOT','DARK SPOT','private','Laser xử lý đốm nâu, sắc tố','Laser xử lý đốm nâu, sắc tố',null),
(16,'PROFHILO','GLOW BAP','private','Profhilo','Profhilo cấp ẩm, trẻ hoá da','Chưa có quy trình cost'),
(16,'PROFHILO STRUCTURA','FILL BAP','private','Profhilo Structura','Profhilo Structura nâng đỡ, làm đầy','Chưa có quy trình cost'),
(16,'KARISMA','COLLAGEN BAP','private','Karisma','Karisma tái tạo collagen','Chưa có quy trình cost'),
(16,'RADIESSE','CAHA BAP','private','Radiesse','Radiesse làm đầy, kích sinh collagen','Chưa có quy trình cost'),
(16,'BAP BIOCOMPLEX','BIOCOMPLEX BAP','private','Biocomplex','Biosepte phục hồi khoẻ da, giảm đỏ giảm viêm',null),
(17,'JUVEDERM – MỸ','JUVEDERM – MỸ','private','Juvederm – Mỹ','Filler Juvederm (Mỹ) / 1 cc','Chưa có quy trình cost'),
(17,'TEOXANE – THUỴ SĨ','TEOXANE – THUỴ SĨ','private','Teoxane – Thuỵ Sĩ','Filler Teoxane (Thuỵ Sĩ) / 1 cc','Chưa có quy trình cost'),
(17,'FILLER HÀN','FILLER HÀN','private','Filler Hàn','Filler Hàn Quốc / 1 cc','Chưa có quy trình cost'),
(18,'MỸ – TRÁN','US BOTULINUM TOXIN – FOREHEAD WRINKLE REDUCTION','private','Botox Mỹ – Xoá nhăn trán','Botox Mỹ – Xoá nhăn trán','Chưa có quy trình cost'),
(18,'MỸ – CAU MÀY','US BOTULINUM TOXIN – FROWN LINE REDUCTION','private','Botox Mỹ – Xoá nhăn cau mày','Botox Mỹ – Xoá nhăn cau mày','Chưa có quy trình cost'),
(18,'MỸ – MẮT','US BOTULINUM TOXIN – CROW’S FEET REDUCTION','private','Botox Mỹ – Xoá nhăn đuôi mắt','Botox Mỹ – Xoá nhăn đuôi mắt','Chưa có quy trình cost'),
(18,'MỸ – VIỀN HÀM','US BOTULINUM TOXIN – JAWLINE SLIMMING','private','Botox Mỹ – Thon gọn viền hàm','Botox Mỹ – Thon gọn viền hàm','Chưa có quy trình cost'),
(18,'MỸ – NÁCH','US BOTULINUM TOXIN – UNDERARM SWEAT REDUCTION','private','Botox Mỹ – Giảm mồ hôi nách','Botox Mỹ – Giảm mồ hôi nách','Chưa có quy trình cost'),
(18,'MỸ – BẮP TAY','US BOTULINUM TOXIN – UPPER ARM SLIMMING','private','Botox Mỹ – Thon gọn bắp tay','Botox Mỹ – Thon gọn bắp tay','Chưa có quy trình cost'),
(18,'HÀN – TRÁN','KOREAN BOTULINUM TOXIN – FOREHEAD WRINKLE REDUCTION','private','Botox Hàn – Vùng trán','Botox Hàn – Vùng trán','Chưa có quy trình cost'),
(18,'HÀN – CAU MÀY','KOREAN BOTULINUM TOXIN – FROWN LINE REDUCTION','private','Botox Hàn – Vùng cau mày','Botox Hàn – Vùng cau mày','Chưa có quy trình cost'),
(18,'HÀN – MẮT','KOREAN BOTULINUM TOXIN – CROW’S FEET REDUCTION','private','Botox Hàn – Vùng đuôi mắt','Botox Hàn – Vùng đuôi mắt','Chưa có quy trình cost'),
(18,'HÀN – VIỀN HÀM','KOREAN BOTULINUM TOXIN – JAWLINE SLIMMING','private','Botox Hàn – Thon gọn viền hàm','Botox Hàn – Thon gọn viền hàm','Chưa có quy trình cost'),
(18,'HÀN – NÁCH','KOREAN BOTULINUM TOXIN – UNDERARM SWEAT REDUCTION','private','Botox Hàn – Giảm mồ hôi nách','Botox Hàn – Giảm mồ hôi nách','Chưa có quy trình cost'),
(18,'HÀN – BẮP TAY','KOREAN BOTULINUM TOXIN – UPPER ARM SLIMMING','private','Botox Hàn – Thon gọn bắp tay','Botox Hàn – Thon gọn bắp tay','Chưa có quy trình cost');

  update public.services s
     set name_en = m.new_name, name = m.vn, internal_name = m.internal, internal_note = m.note,
         description = null, menu_tier = m.tier
    from _m m, public.service_categories c
   where c.sort_order = m.cat_sort and s.category_id = c.id and upper(s.name_en) = upper(m.k);
  get diagnostics v_n = row_count;
  if v_n <> 105 then raise exception 'Khớp % / 105 dịch vụ – dừng lại để kiểm tra', v_n; end if;
end $$;

-- Tên nhóm theo tên truyền thông trong sheet
update public.service_categories set name = 'Essential Treatment' where sort_order = 1;
update public.service_categories set name = 'Skin Booster' where sort_order = 5;
update public.service_categories set name = 'MTS' where sort_order = 6;
update public.service_categories set name = 'Triệt lông – Hair Removal' where sort_order = 14;
update public.service_categories set name = 'Photoskin' where sort_order = 15;

-- Tìm liệu trình (app KTV): tìm cả theo tên nội bộ, hiện tên nội bộ ở dòng phụ
create or replace function public.service_search(p_q text)
 returns table(id uuid, title text, subtitle text, list_price numeric, member_price numeric, has_guide boolean)
 language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên dùng được tìm kiếm'; end if;
  if v_q is null or length(v_q) < 2 then return; end if;
  return query
  select s.id, coalesce(nullif(s.name_en, ''), s.name),
         concat_ws(' · ', case when nullif(s.name_en, '') is not null then s.name end,
                   case when s.internal_name is distinct from s.name then s.internal_name end, c.name),
         s.price, s.member_price,
         exists (select 1 from public.service_guides g where g.service_id = s.id)
    from public.services s
    left join public.service_categories c on c.id = s.category_id
   where s.is_active
     and (s.name ilike '%' || v_q || '%' or s.name_en ilike '%' || v_q || '%'
          or s.internal_name ilike '%' || v_q || '%' or c.name ilike '%' || v_q || '%')
   order by 6 desc, (s.name_en ilike v_q || '%' or s.name ilike v_q || '%') desc, 2
   limit 12;
end $function$;
revoke execute on function public.service_search(text) from public, anon;
grant execute on function public.service_search(text) to authenticated;
