-- TRỪ SẢN PHẨM SAU MỖI BUỔI LIỆU TRÌNH (chủ spa chốt 12/11/2026)
-- * Mỗi bước quy trình có định mức dùng / 1 buổi (cột "ĐỊNH LƯỢNG / 1 LIỆU TRÌNH", tab KTV,
--   sheet "AI QUY TRÌNH LIỆU TRÌNH MOANA 2026"), tính theo đơn vị dung tích của sản phẩm (ml / g / cái / shot…).
-- * KTV bấm Hoàn thành buổi → trừ vào chai đang mở của chi nhánh (chai mở trước trừ trước).
--   Chai dở 1/2, 1/4… được quy ra ml theo dung tích chai. Chai về 0 → tự báo hết chai.
-- * Bước ghi 2 sản phẩm thay thế nhau → KTV chọn sản phẩm thực tế dùng khi Hoàn thành.
-- * Đổi sản phẩm đã được duyệt → trừ sản phẩm thay thế, cùng định mức.
-- * Chi nhánh không còn đủ trong chai đang mở → KHÔNG cho Hoàn thành: KTV phải Xin xuất chai mới,
--   hoặc xin chủ spa xác nhận "thực tồn vẫn còn" (chủ chọn mức còn của chai → thành chai đang mở).
-- * KTV không sửa được số ml.
-- * Hàng dùng 1 lần (dung tích ≤ 1: 1 miếng, 1 cái, 1 bộ, 1 set, 1 lọ…) xuất ra là dùng hết như trước,
--   không trừ lại khi hoàn thành.

-- ============ 0) HÀNG DÙNG 1 LẦN: theo dung tích ============
create or replace function public.is_single_use_product(p_unit text, p_volume numeric)
returns boolean language sql immutable set search_path = '' as $$
  select case when p_volume is null then lower(coalesce(p_unit, '')) in ('cái','miếng','gói','ống','túi')
              else p_volume <= 1 end
$$;
grant execute on function public.is_single_use_product(text, numeric) to authenticated;

-- đơn vị của dung tích: "500ml" → ml, "Hũ 120g" → g, "Hộp 50 cái" → cái, "10.000 shots" → shot
create or replace function public.volume_unit(p_capacity text, p_unit text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_capacity ~* 'ml' then 'ml'
    when p_capacity ~* '\d\s*(g|gr|gram)\M' then 'g'
    when p_capacity ~* 'shot' then 'shot'
    when p_capacity ~* 'miếng' then 'miếng'
    when p_capacity ~* 'cái' then 'cái'
    when p_capacity ~* 'ống' then 'ống'
    when p_capacity ~* 'lọ' then 'lọ'
    else coalesce(nullif(trim(p_unit), ''), '')
  end
$$;
grant execute on function public.volume_unit(text, text) to authenticated;

create or replace function public.stock_requests_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = new.status then return new; end if;
  if old.status <> 'pending' then raise exception 'Phiếu đã được xử lý'; end if;
  if new.status in ('approved','rejected') then
    if not public.has_role('owner','manager','warehouse') then
      raise exception 'Chỉ quản lý kho được duyệt phiếu';
    end if;
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
  end if;
  if new.status = 'approved' then
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, request_id, note)
    select new.warehouse_id, sri.product_id, 'export_use', -sri.quantity, new.id, 'Xuất theo yêu cầu KTV'
      from public.stock_request_items sri where sri.request_id = new.id;
    -- mỗi chai / lọ / hũ / hộp nhiều lần dùng xuất ra = 1 chai đang mở, đầy 100%
    insert into public.opened_items (warehouse_id, product_id, remaining_pct, source, request_id, unit_cost, opened_by)
    select m.warehouse_id, m.product_id, 100, 'request', new.id, m.unit_cost, new.requested_by
      from public.stock_movements m
      join public.products p on p.id = m.product_id
      cross join lateral generate_series(1, -m.quantity)
     where m.request_id = new.id and m.quantity < 0 and not public.is_single_use_product(p.unit, p.volume);
  end if;
  return new;
end $$;

-- ============ 1) CHAI ĐANG MỞ: thêm số lượng còn (ml / g / …) ============
alter table public.opened_items drop constraint if exists opened_items_remaining_pct_check;
alter table public.opened_items add constraint opened_items_remaining_pct_check check (remaining_pct >= 0 and remaining_pct <= 100);
alter table public.opened_items drop constraint if exists opened_items_source_check;
alter table public.opened_items add constraint opened_items_source_check check (source in ('opening','request','confirm'));
alter table public.opened_items add column if not exists remaining_qty numeric(14,3);
update public.opened_items o set remaining_qty = round(p.volume * o.remaining_pct / 100, 3)
  from public.products p where p.id = o.product_id and o.remaining_qty is null and p.volume is not null;
grant select (remaining_qty) on public.opened_items to authenticated;

create or replace function public.opened_items_fill_qty()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.remaining_qty is null then
    select round(volume * new.remaining_pct / 100, 3) into new.remaining_qty from public.products where id = new.product_id;
  end if;
  return new;
end $$;
revoke execute on function public.opened_items_fill_qty() from public, anon, authenticated;
drop trigger if exists opened_items_fill_qty on public.opened_items;
create trigger opened_items_fill_qty before insert on public.opened_items for each row execute function public.opened_items_fill_qty();

-- ============ 2) ĐỊNH MỨC TỪNG SẢN PHẨM TRONG QUY TRÌNH ============
create table if not exists public.service_step_items (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  step_no int not null,
  sort int not null,
  product_name text not null,                         -- tên ghi trong quy trình
  product_id uuid references public.products(id),     -- mã sản phẩm trong kho (null = không phải sản phẩm: máy, kỹ thuật…)
  qty numeric(12,3) check (qty is null or qty > 0),   -- định mức / 1 buổi, theo đơn vị dung tích của sản phẩm
  alt_product_ids uuid[] not null default '{}',       -- sản phẩm thay thế KTV được chọn (cùng định mức)
  unique (service_id, step_no, sort)
);
create index if not exists service_step_items_product_idx on public.service_step_items (product_id);
alter table public.service_step_items enable row level security;
drop policy if exists "staff read" on public.service_step_items;
create policy "staff read" on public.service_step_items for select using ((select public.is_staff()));
drop policy if exists "management write" on public.service_step_items;
create policy "management write" on public.service_step_items for all
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

create or replace function public._norm_name(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(lower(coalesce(p, '')), '[^[:alnum:]]', '', 'g')
$$;

-- điền từ quy trình hiện có + định lượng trong sheet
delete from public.service_step_items;
with sheet as (select '{"s":[["PURIFYING TREATMENT","Chăm sóc da dầu cơ bản"],["HYDRAIN3 TREATMENT","Chăm sóc da khô cơ bản"],["ACNE TWEEZER","Gắp mụn"],["ION BRIGHT","Điện di làm sáng"],["PRO CALM","ĐIện di làm dịu"],["DETOX SKIN","Detox sạch sâu"],["ENZYME POWER","ĐIện di da mụn"],["LYMPHAS THERAPY","Tẩy da chết kiềm dầu"],["BIO-DERM BASIC – OILY SKIN","Chăm sóc da dầu với sản phẩm Bioderma"],["BIO-DERM BASIC – DRY SKIN","Chăm sóc da khô với sản phẩm Bioderma"],["BIO-DERM ACNE CONTROL","Lấy nhân mụn với sản phâm Bioderma"],["BASIC TREATMENT FOR OILY SKIN","Chăm sóc da dầu cơ bản với BR"],["BASIC TREATMENT FOR DRY SKIN","Chăm sóc da khô cơ bản với BR"],["BIOSENSIBLE TREATMENT","Liệu trình cho da nhạy cảm"],["SOIN LOTION MC110","Liệu trình cho da dầu mụn, mụn viêm"],["BOOSTER VIP O2","Liệu trình làm sạch sâu, cung cấp oxy"],["SOIN LISSANT","Liệu trình cấp ẩm căng bóng"],["LIFT CVS","Liệu trình nâng cơ"],["TOLE SKIN","Liệu trình cho da nhạy cảm"],["COCKTAIL D''ACTIFS RÉGÉNÉRANTS","Phi kim chống lão hoá với BR"],["ACNE PEEL","Peel mụn đa hoạt chất (Recovery Inno)"],["SENSITIVE ACNE PEEL","Peel mụn da nhạy cảm (Sesderma Azelac)"],["SOS PEEL","Peel làm dịu da yếu, thiếu ẩm (Agrilac)"],["RECOVERY PEEL","Peel phục hồi giảm đỏ (Redness Inno)"],["BRIGHTENING PEEL","Peel làm sáng, mờ thâm (MD Ceutical)"],["GLOW PEELING","Peel căng bóng – có bong ( JA Mandelic 50)"],["GLOW PEELING","Peel căng bóng tức thì – không bong ( GIGI mandelic15)"],["WHITE PEELING","Ủ trắng, căng bóng da ( Dermaquest)"],["BIO PEELING","Peel vi tảo sinh học (Zena)"],["SCAR PEELING","Peel sẹo rỗ (TCA Skintech)"],["DMK ENZYME","Liệu pháp enzyme DMK"],["DMK FIRE AND ICE","Peel “lửa và băng” DMK"],["DARKSPOT MESOTHERAPY","Mesotherapy vùng sắc tố"],["GLOW MESOGUN","Mesogun căng bóng"],["RECOVERY MESO","Mesotherapy phục hồi ( Inno Redness)"],["BRIGHTENING MESO","Mesotherapy làm sáng nâng tone da"],["MESOBOTOX","Meso Botox thu nhỏ lcl giảm tiết dầu"],["ACNE MESO","Mesotherapy kiềm dầu, kiểm soát mụn"],["ACNE SPOT MESO","Mesotherapy kiểm soát viêm điểm mụn"],["BIOCOMPLEX MESOGUN","Mesogun căng bóng phục hồi"],["TEOXANE MESOGUN","Mesogun trẻ hoá, mờ nếp nhăn"],["SCAR MESO","Mesotherapy tăng sinh collagen đầy sẹo"],["PORE INSTANT MTS","Phi kim mụn và lỗ chân lông"],["BRIGHTENING MTS","Phi kim làm sáng"],["RECOVERY MTS","Phi kim phục hồi"],["GLOW MTS","Phi kim cấp cẩm"],["GLOW FEST","Phi kim cấp ẩm superjection"],["RENEW FEST","Phi kim tái tạo Superjection"],["MNRF","Vi kim RF xâm lấn (có kim)"],["RF SKIN GYM","RF không xâm lấn (SkinGym)"],["RF LYMPHATIC RESET","RF + enzyme DMK thải độc bạch huyết"],["MPT BOOSTER","MPT MẶT"],["NECK MPT BOOSTER","MPT CỔ"],["FULL FACE V-LIFT+","HIFU TOÀN MẶT VÀ CỔ"],["SCAR THERAPY","Cắt đáy sẹo"],["LIGHT THERAPY","PDT CHIẾU ĐÈN DERMALUX"],["EYE FIRM","RF cho vùng mắt kết hợp sản phẩm Ericson"],["EYE LIFT","Hifu cho vùng mắt kết hợp sản phẩm Ericson"],["BRIGHTENING EYE MESO","Meso làm sáng mờ thâm vùng mắt"],["HYDRATING EYE MESO","Meso cấp ẩm vùng mắt"],["ANTI-AGING EYE MESO","Meso chống lão hoá mờ nếp nhăn vùng mắt ( Jalupro)"],["EYE REFILL","Filler Teoxane trẻ hoá, làm đầy rãnh lệ"],["THERMO EYE","Chăm sóc vùng mắt với DMK"],["WHITE BODY PEEL","Peel body mờ thâm tảo Zena"],["AFTERSUN BODY","Làm dịu da body cháy nắng"],["BRIGHTENING LASER BODY","Laser body mờ thâm"],["ACNE BODY PEEL","Peel mụn lưng tảo Zena"],["ANTI HAIR LOSS MESO","Meso kích thích mọc tóc Skin genuity"],["OWAY BIOSCALP RESET","Detox da đầu Oway"],["OWAY HAIRWASH","Gội đầu Oway"],["ANTI HAIR LOSS MTS","Phi kim chống rụng tóc (Radical)"],["ANTI HAIR LOSS MTS","Phi kim chống rụng tóc (Benpathen + Biotin)"]],"p":["dermedic hydrain3 hialuro micellar water h2o 500ml","christina sữa rửa mặt","dermalogica tẩy da chết","bộ vật tư khấu hao","comfortzone recovery touch creme","comfortzone recovery touch oil","mặt nạ bột kháng viêm","simildiet post treatment","neoretin / heliocare","mona frema","cpu arbutin","dung dịch detox số 1-2-3","transamin","dmk enzyme số 2 120gr","dmk aqua herb 240ml","actrol powder","bioderma sensibio h2o","bioderma gel moussant","histolab kem massage","bioderma sebium serum","bioderma atoderm intensive gel creme","bioderma photoderm","bioderma sensibio defensive serum 30ml","br eau micellaire biosensible","br lait s.r.","br lotion p50","br masque vivant","br sérum extraits tissulaires","br creme elastine 50ml","br masque vip o2","br l''eauxygenante xịt dưỡng 150ml","br masque biosensible","br serum biosensible","br mc110","br booster vip o2","br soin lissant","br lift cvs","br toleskin set 1 (cryostick)","br toleskin set 2","br coctail d''actifs regenerants","simildiet chuẩn bị da (degree lotion 400ml)","inno recovery","sesderma azelac ru","softening mask 100ml","redness peel","set peel md ceutical","juliette armand mandelic 40%","gigi mandelic","ahowa","lactic peel dermaquest","tảo zena","tca skintech","dmk cryo pro x 100ml","dmk enbioment serum","dmk beta gel","dmk herbal pigment oil","dmk herb mineral mist","dmk quickpeel 120gr","tê trắng samsungpharm 450ml","kim 34g (hộp)","mesoestetic 210","mask lxr","mặt nạ ủ tê dạng miếng conductive gel mask","kim mesogun","lapuroon","redness- id","botox (meso)","facne fusion","medisepte gel bio","teoxane redensity 1","fusion mesomatrix","đầu kim 12 / kim lăn 0.25","anubis regul oil concentrate","tranacix","exomage","superjection hyaluronate","conapidil cemenphalt","đầu kim xâm lấn máy mnrf","đầu kim không xâm lấn máy mnrf","cpu gel","shots mpt / hifu","kim 27g","dao mổ số 11 / 12","kim lăn 2.0","retinol neostrata","tca aktivator 50%","pdt gel","eyezone calming lotion","eyezone fluid","eyezone cream","eyezone patch","eyezone gel","bộ dụng cụ","mesoestetic inno meline01","eyezone fluid / gel","jalupro young eye","teoxane redensity 2 (2x1ml)","mặt nạ mắt thường","triple action body peeling e254","glycolic body peeling lotion 255","cpu azulene gel","cpu hydra water","enzymetic smoothing body cream e256","genosys hr matrix","skin genuity hair","oway pure biodymic","oway zanthoxylum","oway micro","oway volumn","oway silk n glow mask","oway daily","radical","benpathen + biotin"],"r":[[0,0,1,7.0],[0,1,1,2.0],[0,2,1,3.0],[0,3,1,1.0],[0,4,1,2.0],[0,5,1,1.0],[0,6,1,20.0],[0,7,1,0.5],[0,8,1,0.5],[1,0,1,7.0],[1,1,1,2.0],[1,2,1,3.0],[1,3,1,1.0],[1,4,1,2.0],[1,5,1,1.0],[1,6,1,20.0],[1,7,1,0.5],[1,8,1,0.5],[2,0,1,7.0],[2,1,1,2.0],[2,2,1,3.0],[2,3,1,1.0],[2,6,1,20.0],[2,7,1,0.5],[2,8,1,0.5],[3,0,1,7.0],[3,1,1,2.0],[3,2,1,3.0],[3,3,1,1.0],[3,4,1,2.0],[3,5,1,1.0],[3,9,1,5.0],[3,10,1,1.0],[3,7,1,0.5],[3,8,1,0.5],[4,0,1,7.0],[4,1,1,2.0],[4,2,1,3.0],[4,3,1,1.0],[4,4,1,2.0],[4,5,1,1.0],[4,9,1,5.0],[4,10,1,1.0],[4,7,1,0.5],[4,8,1,0.5],[5,0,1,7.0],[5,1,1,2.0],[5,2,1,3.0],[5,3,1,1.0],[5,11,1,40.0],[5,9,1,5.0],[5,7,1,0.5],[5,8,1,0.5],[6,0,1,7.0],[6,1,1,2.0],[6,2,1,3.0],[6,3,1,1.0],[6,6,1,20.0],[6,12,1,1.0],[6,7,1,0.5],[6,8,1,0.5],[7,0,1,7.0],[7,1,1,2.0],[7,3,1,1.0],[7,13,1,4.0],[7,14,1,4.0],[7,15,1,0.2],[7,7,1,0.5],[7,8,1,0.5],[8,16,1,7.0],[8,17,1,2.0],[8,2,1,3.0],[8,3,1,1.0],[8,18,1,5.0],[8,6,1,20.0],[8,19,1,0.5],[8,20,1,0.5],[8,21,1,0.5],[9,16,1,7.0],[9,17,1,2.0],[9,2,1,3.0],[9,3,1,1.0],[9,18,1,5.0],[9,6,1,20.0],[9,22,1,0.5],[9,20,1,0.5],[9,21,1,0.5],[10,16,1,7.0],[10,17,1,2.0],[10,2,1,3.0],[10,3,1,1.0],[10,6,1,20.0],[10,19,1,0.5],[10,20,1,0.5],[10,21,1,0.5],[11,23,1,3.0],[11,24,1,5.0],[11,24,2,15.0],[11,25,1,1.0],[11,3,1,1.0],[11,26,1,15.0],[11,27,1,0.5],[11,28,1,0.5],[11,8,1,0.5],[12,23,1,3.0],[12,24,1,5.0],[12,24,2,15.0],[12,25,1,1.0],[12,3,1,1.0],[12,29,1,15.0],[12,27,1,0.5],[12,28,1,0.5],[12,8,1,0.5],[13,23,1,3.0],[13,24,1,5.0],[13,24,2,15.0],[13,30,1,0.5],[13,31,1,10.0],[13,32,1,1.0],[13,27,1,1.0],[13,28,1,0.5],[13,8,1,0.5],[14,23,1,3.0],[14,24,1,5.0],[14,24,2,15.0],[14,30,1,0.5],[14,25,1,1.0],[14,33,1,5.0],[14,31,1,10.0],[14,27,1,1.0],[14,28,1,0.5],[14,8,1,0.5],[15,23,1,3.0],[15,24,1,5.0],[15,24,2,20.0],[15,25,1,1.0],[15,34,1,10.0],[15,29,1,15.0],[15,27,1,1.0],[15,28,1,0.5],[15,8,1,0.5],[16,23,1,3.0],[16,24,1,5.0],[16,24,2,15.0],[16,25,1,1.0],[16,35,1,1.0],[16,31,1,10.0],[16,27,1,1.0],[16,28,1,0.5],[16,8,1,0.5],[17,23,1,3.0],[17,24,1,5.0],[17,24,2,15.0],[17,25,1,1.0],[17,36,1,1.0],[17,31,1,10.0],[17,27,1,1.0],[17,28,1,0.5],[17,8,1,0.5],[18,23,1,3.0],[18,24,1,5.0],[18,37,1,1.0],[18,25,1,1.0],[18,38,1,1.0],[18,27,1,1.0],[18,28,1,0.5],[18,8,1,0.5],[19,23,1,3.0],[19,24,1,5.0],[19,24,2,15.0],[19,25,1,1.0],[19,39,1,0.5],[19,31,1,10.0],[19,27,1,1.0],[19,28,1,0.5],[19,8,1,0.5],[20,0,1,7.0],[20,1,1,2.0],[20,3,1,1.0],[20,40,1,1.0],[20,41,1,0.8],[20,7,1,0.5],[20,8,1,0.5],[21,0,1,7.0],[21,1,1,2.0],[21,3,1,1.0],[21,40,1,1.0],[21,42,1,1.0],[21,7,1,1.0],[21,8,1,1.0],[22,0,1,7.0],[22,1,1,2.0],[22,3,1,1.0],[22,40,1,1.0],[22,43,1,1.0],[22,7,1,1.0],[22,8,1,1.0],[23,0,1,7.0],[23,1,1,2.0],[23,3,1,1.0],[23,44,1,1.0],[23,7,1,1.0],[23,8,1,0.5],[24,0,1,7.0],[24,1,1,2.0],[24,3,1,1.0],[24,40,1,1.0],[24,45,1,1.0],[24,8,1,1.0],[25,0,1,7.0],[25,1,1,2.0],[25,3,1,1.0],[25,40,1,1.0],[25,46,1,1.0],[25,7,1,1.0],[25,8,1,1.0],[26,0,1,7.0],[26,1,1,2.0],[26,3,1,1.0],[26,40,1,1.0],[26,47,1,1.0],[26,7,1,1.0],[26,8,1,1.0],[27,0,1,7.0],[27,1,1,2.0],[27,3,1,1.0],[27,40,1,1.0],[27,48,1,5.0],[27,49,1,1.0],[27,7,1,1.0],[27,8,1,1.0],[28,0,1,7.0],[28,1,1,2.0],[28,3,1,1.0],[28,50,1,1.0],[28,9,1,10.0],[28,7,1,1.0],[28,8,1,1.0],[29,0,1,7.0],[29,1,1,2.0],[29,3,1,1.0],[29,40,1,1.0],[29,51,1,1.0],[29,7,1,1.0],[30,0,1,7.0],[30,1,1,2.0],[30,13,1,4.0],[30,14,1,4.0],[30,3,1,1.0],[30,52,1,5.0],[30,53,1,0.5],[30,54,1,0.5],[30,55,1,0.5],[30,56,1,1.0],[30,15,1,0.2],[30,8,1,1.0],[31,0,1,7.0],[31,1,1,2.0],[31,3,1,1.0],[31,40,1,1.0],[31,57,1,3.0],[31,52,1,5.0],[31,53,1,0.5],[31,54,1,0.5],[31,55,1,0.5],[31,56,1,1.0],[31,15,1,0.2],[31,8,1,1.0],[32,0,1,7.0],[32,1,1,2.0],[32,3,1,1.0],[32,58,1,10.0],[32,59,1,1.0],[32,60,1,1.0],[32,61,1,1.0],[32,7,1,0.5],[33,0,1,7.0],[33,1,1,2.0],[33,3,1,1.0],[33,62,1,1.0],[33,63,1,1.0],[33,64,1,3.0],[33,61,1,1.0],[33,7,1,0.5],[34,0,1,7.0],[34,1,1,2.0],[34,3,1,1.0],[34,62,1,1.0],[34,59,1,3.0],[34,65,1,2.5],[34,61,1,1.0],[34,7,1,0.5],[35,0,1,7.0],[35,1,1,2.0],[35,3,1,1.0],[35,58,1,10.0],[35,59,1,3.0],[35,60,1,3.0],[35,61,1,1.0],[35,7,1,0.5],[36,0,1,7.0],[36,1,1,2.0],[36,3,1,1.0],[36,58,1,10.0],[36,59,1,3.0],[36,64,1,3.0],[36,66,1,1.0],[36,61,1,1.0],[36,7,1,0.5],[37,0,1,7.0],[37,1,1,2.0],[37,3,1,1.0],[37,58,1,10.0],[37,59,1,3.0],[37,67,1,3.0],[37,61,1,1.0],[37,7,1,0.5],[38,3,1,1.0],[38,59,1,1.0],[38,67,1,0.1],[39,0,1,7.0],[39,1,1,2.0],[39,3,1,1.0],[39,62,1,1.0],[39,63,1,1.0],[39,68,1,3.0],[39,61,1,1.0],[39,7,1,0.5],[40,0,1,7.0],[40,1,1,2.0],[40,3,1,1.0],[40,62,1,1.0],[40,63,1,1.0],[40,69,1,2.0],[40,61,1,1.0],[40,7,1,0.5],[41,0,1,7.0],[41,1,1,2.0],[41,3,1,1.0],[41,62,1,1.0],[41,59,1,3.0],[41,70,1,3.0],[41,61,1,1.0],[41,7,1,0.5],[42,0,1,7.0],[42,1,1,2.0],[42,3,1,1.0],[42,58,1,5.0],[42,71,1,1.0],[42,72,1,2.0],[42,61,1,1.0],[42,7,1,0.5],[43,0,1,7.0],[43,1,1,2.0],[43,3,1,1.0],[43,58,1,5.0],[43,71,1,1.0],[43,73,1,2.0],[43,61,1,1.0],[43,7,1,0.5],[44,0,1,7.0],[44,1,1,2.0],[44,3,1,1.0],[44,58,1,5.0],[44,71,1,1.0],[44,74,1,1.2],[44,61,1,1.0],[44,7,1,0.5],[45,0,1,7.0],[45,1,1,2.0],[45,3,1,1.0],[45,58,1,5.0],[45,71,1,1.0],[45,74,1,1.2],[45,61,1,1.0],[45,7,1,0.5],[46,0,1,7.0],[46,1,1,2.0],[46,3,1,1.0],[46,71,1,1.0],[46,75,1,0.5],[46,76,1,1.0],[46,7,1,0.5],[47,0,1,7.0],[47,1,1,2.0],[47,3,1,1.0],[47,71,1,1.0],[47,75,1,0.5],[47,76,1,1.0],[47,7,1,0.5],[48,0,1,7.0],[48,1,1,2.0],[48,3,1,1.0],[48,58,1,10.0],[48,77,1,1.0],[48,61,1,1.0],[48,7,1,0.5],[49,0,1,7.0],[49,1,1,2.0],[49,2,1,3.0],[49,3,1,1.0],[49,78,1,1.0],[49,79,1,30.0],[49,9,1,5.0],[49,7,1,0.5],[49,8,1,0.5],[50,0,1,7.0],[50,1,1,2.0],[50,78,1,1.0],[50,79,1,30.0],[50,13,1,4.0],[50,56,1,4.0],[50,52,1,5.0],[50,53,1,0.5],[50,54,1,0.5],[50,55,1,0.5],[50,15,1,0.2],[50,14,1,0.5],[51,0,1,7.0],[51,1,1,2.0],[51,2,1,3.0],[51,3,1,1.0],[51,79,1,15.0],[51,80,1,300.0],[51,9,1,10.0],[51,7,1,0.5],[51,8,1,0.5],[52,0,1,7.0],[52,1,1,2.0],[52,2,1,3.0],[52,79,1,20.0],[52,80,1,100.0],[52,9,1,10.0],[52,7,1,1.0],[52,8,1,0.5],[53,0,1,7.0],[53,1,1,2.0],[53,2,1,3.0],[53,3,1,1.0],[53,58,1,10.0],[53,79,1,30.0],[53,80,1,1000.0],[53,61,1,1.0],[53,7,1,0.5],[53,8,1,0.5],[54,0,1,7.0],[54,1,1,2.0],[54,3,1,1.0],[54,58,1,10.0],[54,81,1,1.0],[54,82,1,1.0],[54,83,1,1.0],[54,51,1,0.6],[54,84,1,1.5],[54,7,1,1.0],[54,85,1,0.1],[55,0,1,7.0],[55,1,1,2.0],[55,3,1,1.0],[55,86,1,1.0],[55,7,1,0.5],[55,8,1,0.5],[56,0,1,7.0],[56,1,1,2.0],[56,87,1,1.0],[56,88,1,0.5],[56,89,1,0.5],[56,90,1,1.0],[56,91,1,0.5],[57,0,1,7.0],[57,1,1,2.0],[57,87,1,1.0],[57,88,1,0.5],[57,89,1,0.5],[57,90,1,1.0],[57,91,1,0.5],[58,0,1,7.0],[58,1,1,2.0],[58,58,1,10.0],[58,92,1,1.0],[58,93,1,2.0],[58,90,1,1.0],[58,94,1,0.5],[59,0,1,7.0],[59,1,1,2.0],[59,58,1,10.0],[59,92,1,1.0],[59,64,1,1.0],[59,90,1,1.0],[59,91,1,0.5],[60,0,1,7.0],[60,1,1,2.0],[60,58,1,10.0],[60,92,1,1.0],[60,95,1,1.0],[60,90,1,1.0],[60,91,1,0.5],[61,96,1,1.0],[62,0,1,7.0],[62,1,1,2.0],[62,88,1,0.5],[62,89,1,0.5],[62,57,1,1.0],[62,97,1,1.0],[62,87,1,1.0],[62,91,1,0.5],[63,98,1,70.0],[63,99,1,30.0],[63,50,1,1.0],[63,100,1,100.0],[64,2,1,2.0],[64,101,1,1.0],[64,100,1,100.0],[64,102,1,5.0],[65,2,1,2.0],[65,100,1,100.0],[65,102,1,5.0],[66,98,1,70.0],[66,3,1,1.0],[66,50,1,1.0],[66,100,1,100.0],[66,102,1,5.0],[67,103,1,5.0],[67,104,1,3.0],[67,3,1,1.0],[68,105,1,3.0],[68,106,1,40.0],[68,107,1,20.0],[68,108,1,15.0],[68,109,1,30.0],[68,110,1,20.0],[69,107,1,20.0],[69,108,1,15.0],[69,110,1,20.0],[70,103,1,5.0],[70,111,1,3.0],[71,103,1,5.0],[71,112,1,2.5]]}'::jsonb j),
srows as (
  select upper(sheet.j->'s'->((r->>0)::int)->>0) en,
         case when public._norm_name(sheet.j->'p'->>((r->>1)::int)) in ('eyezonefluid', 'eyezonegel') then 'eyezonefluidgel'
              else public._norm_name(sheet.j->'p'->>((r->>1)::int)) end pn,
         (r->>2)::int n, (r->>3)::numeric qty
    from sheet, jsonb_array_elements(sheet.j->'r') r
),
items as (
  select st.service_id, st.step_no, x.ord::int sort, x.name product_name,
         upper(trim(sv.name_en)) en, public._norm_name(x.name) pn,
         row_number() over (partition by st.service_id, public._norm_name(x.name) order by st.step_no, x.ord) n
    from public.service_procedure_steps st
    join public.services sv on sv.id = st.service_id
    cross join lateral unnest(st.products) with ordinality x(name, ord)
),
alias(pn, target) as (values
  (public._norm_name('OWAY Micro'), 'OWAY Dầu gội Micro|950'),
  (public._norm_name('OWAY Volumn'), 'OWAY Dầu gội Volumn|950'),
  (public._norm_name('OWAY Silk n Glow Mask'), 'OWAY mặt nạ tóc Silk n Glow Mask|500'),
  (public._norm_name('OWAY Zanthoxylum'), 'OWAY SP Detox tóc Zanthoxylum|150'),
  (public._norm_name('REDNESS- ID'), 'REDNESS ID|10')
)
insert into public.service_step_items (service_id, step_no, sort, product_name, product_id, qty)
select i.service_id, i.step_no, i.sort, i.product_name,
       (select p.id from public.products p
         where p.deleted_at is null
           and (public._norm_name(p.name) = i.pn
                or exists (select 1 from alias a where a.pn = i.pn
                             and public._norm_name(p.name) = public._norm_name(split_part(a.target, '|', 1))
                             and p.volume = split_part(a.target, '|', 2)::numeric))
         order by p.for_retail, (p.volume is null), (not p.is_active), p.created_at
         limit 1),
       (select s.qty from srows s where s.en = i.en and s.pn = i.pn
         order by (s.n = i.n) desc, s.n limit 1)
  from items i;
-- sản phẩm có mã nhưng sheet ghi tên khác (vd EYEZONE Fluid / Gel): lấy định mức hay dùng nhất của sản phẩm đó
update public.service_step_items i
   set qty = (select mode() within group (order by x.qty) from public.service_step_items x
               where x.product_id = i.product_id and x.qty is not null)
 where i.qty is null and i.product_id is not null;

-- ============ 3) ĐỔI SẢN PHẨM: lưu mã sản phẩm thay thế ============
alter table public.procedure_change_requests add column if not exists to_product_id uuid references public.products(id);
drop function if exists public.request_procedure_change(uuid, int, text, text, text);
create or replace function public.request_procedure_change(p_aps uuid, p_step int, p_from text, p_to text, p_reason text,
  p_to_product uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_pid uuid := p_to_product;
begin
  if not exists (select 1 from public.appointment_services
                  where id = p_aps and (technician_id = (select auth.uid()) or public.has_role('owner','manager'))) then
    raise exception 'Dịch vụ này không phải của bạn';
  end if;
  if nullif(trim(p_to), '') is null then raise exception 'Vui lòng ghi sản phẩm muốn dùng'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do đổi sản phẩm'; end if;
  if v_pid is null then  -- gõ tay: thử tìm đúng tên trong kho
    select id into v_pid from public.products
     where deleted_at is null and public._norm_name(name) = public._norm_name(p_to)
     order by for_retail, is_active desc limit 1;
  end if;
  insert into public.procedure_change_requests (appointment_service_id, step_no, from_product, to_product, to_product_id, reason, requested_by)
  values (p_aps, p_step, nullif(trim(p_from), ''), trim(p_to), v_pid, trim(p_reason), (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.request_procedure_change(uuid, int, text, text, text, uuid) from public, anon;
grant execute on function public.request_procedure_change(uuid, int, text, text, text, uuid) to authenticated;

-- ============ 4) NHẬT KÝ TRỪ SẢN PHẨM ============
create table if not exists public.treatment_usages (
  id uuid primary key default gen_random_uuid(),
  appointment_service_id uuid not null references public.appointment_services(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id),
  product_id uuid not null references public.products(id),
  opened_item_id uuid references public.opened_items(id),
  qty numeric(14,3) not null,
  qty_before numeric(14,3),
  qty_after numeric(14,3),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists treatment_usages_aps_idx on public.treatment_usages (appointment_service_id);
create index if not exists treatment_usages_opened_idx on public.treatment_usages (opened_item_id);
create index if not exists treatment_usages_product_idx on public.treatment_usages (product_id, created_at);
alter table public.treatment_usages enable row level security;
drop policy if exists "staff read" on public.treatment_usages;
create policy "staff read" on public.treatment_usages for select to authenticated using ((select public.is_staff()));
revoke insert, update, delete on public.treatment_usages from anon, authenticated;

-- ============ 5) XIN CHỦ SPA XÁC NHẬN "THỰC TỒN VẪN CÒN" ============
create table if not exists public.usage_stock_confirms (
  id uuid primary key default gen_random_uuid(),
  appointment_service_id uuid not null references public.appointment_services(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid not null references public.products(id),
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  remaining_pct numeric(5,2),               -- chủ chọn mức còn của chai thực tế
  opened_item_id uuid references public.opened_items(id),
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text
);
create index if not exists usage_stock_confirms_pending_idx on public.usage_stock_confirms (status) where status = 'pending';
create index if not exists usage_stock_confirms_aps_idx on public.usage_stock_confirms (appointment_service_id);
alter table public.usage_stock_confirms enable row level security;
drop policy if exists "staff read" on public.usage_stock_confirms;
create policy "staff read" on public.usage_stock_confirms for select to authenticated using ((select public.is_staff()));
revoke insert, update, delete on public.usage_stock_confirms from anon, authenticated;

-- ============ 6) TÍNH SẢN PHẨM CẦN TRỪ CHO 1 BUỔI ============
-- p_choices: {"<id dòng định mức>": "<id sản phẩm KTV chọn>"}
create or replace function public._session_needs(p_aps uuid, p_choices jsonb default '{}'::jsonb)
returns table (item_id uuid, step_no int, product_name text, product_id uuid, qty numeric, alt_ids uuid[], changed boolean)
language sql stable security definer set search_path = '' as $$
  with a as (select * from public.appointment_services where id = p_aps),
  base as (
    select i.*,
           (select c.to_product_id from public.procedure_change_requests c
             where c.appointment_service_id = p_aps and c.status = 'approved' and c.step_no = i.step_no
               and public._norm_name(c.from_product) = public._norm_name(i.product_name)
             order by c.reviewed_at desc nulls last limit 1) chg_pid,
           exists (select 1 from public.procedure_change_requests c
             where c.appointment_service_id = p_aps and c.status = 'approved' and c.step_no = i.step_no
               and public._norm_name(c.from_product) = public._norm_name(i.product_name)) chg
      from public.service_step_items i, a
     where i.service_id = a.service_id and i.qty is not null and i.product_id is not null
  )
  select b.id, b.step_no, b.product_name,
         case when b.chg then b.chg_pid
              when nullif(p_choices->>(b.id::text), '') is not null
                   and (p_choices->>(b.id::text))::uuid = any(b.alt_product_ids || b.product_id)
                then (p_choices->>(b.id::text))::uuid
              else b.product_id end,
         b.qty, b.alt_product_ids, b.chg
    from base b
   where not (b.chg and b.chg_pid is null)   -- đổi sang sản phẩm không có trong kho: không trừ
$$;
revoke execute on function public._session_needs(uuid, jsonb) from public, anon, authenticated;

create or replace function public._session_warehouse(p_aps uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select w.id from public.appointment_services s
    join public.appointments a on a.id = s.appointment_id
    join public.warehouses w on w.branch_id = a.branch_id and w.type = 'treatment'
   where s.id = p_aps limit 1
$$;
revoke execute on function public._session_warehouse(uuid) from public, anon, authenticated;

-- Xem trước khi Hoàn thành: các sản phẩm sẽ trừ, còn bao nhiêu trong chai đang mở, thiếu gì
create or replace function public.session_usage_preview(p_aps uuid, p_choices jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_wh uuid; v_items jsonb; v_products jsonb;
begin
  if not exists (select 1 from public.appointment_services
                  where id = p_aps and (technician_id = (select auth.uid()) or public.has_role('owner','manager'))) then
    raise exception 'Dịch vụ này không phải của bạn';
  end if;
  v_wh := public._session_warehouse(p_aps);
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', n.item_id, 'step_no', n.step_no, 'name', n.product_name, 'product_id', n.product_id,
           'qty', n.qty, 'changed', n.changed,
           'alts', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'label', concat_ws(' · ', p.name, p.capacity)) order by p.name), '[]'::jsonb)
                      from public.products p where cardinality(n.alt_ids) > 0 and p.id = any(n.alt_ids || (select product_id from public.service_step_items where id = n.item_id))))
           order by n.step_no, n.product_name), '[]'::jsonb)
    into v_items from public._session_needs(p_aps, p_choices) n;
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', p.id, 'label', concat_ws(' · ', p.name, p.capacity), 'unit', public.volume_unit(p.capacity, p.unit),
           'need', t.need, 'single_use', public.is_single_use_product(p.unit, p.volume),
           'available', coalesce(o.avail, 0), 'bottles', coalesce(o.cnt, 0),
           'short', not public.is_single_use_product(p.unit, p.volume) and coalesce(o.avail, 0) + 0.0005 < t.need,
           'confirm', (select c.status from public.usage_stock_confirms c
                        where c.appointment_service_id = p_aps and c.product_id = p.id order by c.created_at desc limit 1))
           order by p.name), '[]'::jsonb)
    into v_products
    from (select n.product_id, sum(n.qty) need from public._session_needs(p_aps, p_choices) n group by n.product_id) t
    join public.products p on p.id = t.product_id
    left join lateral (select sum(coalesce(oi.remaining_qty, 0)) avail, count(*) cnt from public.opened_items oi
                        where oi.warehouse_id = v_wh and oi.product_id = p.id and oi.status = 'open') o on true;
  return jsonb_build_object('warehouse_id', v_wh, 'items', v_items, 'products', v_products);
end $$;
revoke execute on function public.session_usage_preview(uuid, jsonb) from public, anon;
grant execute on function public.session_usage_preview(uuid, jsonb) to authenticated;

-- Trừ thật (gọi khi Hoàn thành buổi). Thiếu → báo lỗi, không trừ gì.
create or replace function public._consume_session(p_aps uuid, p_choices jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_wh uuid := public._session_warehouse(p_aps);
  r record; b record;
  v_left numeric; v_take numeric; v_after numeric; v_short text := '';
begin
  if exists (select 1 from public.treatment_usages where appointment_service_id = p_aps) then return; end if;
  -- kiểm tra đủ trước
  for r in
    select t.product_id, t.need, p.name, p.capacity, p.unit, p.volume,
           coalesce((select sum(coalesce(oi.remaining_qty, 0)) from public.opened_items oi
                      where oi.warehouse_id = v_wh and oi.product_id = t.product_id and oi.status = 'open'), 0) avail
      from (select n.product_id, sum(n.qty) need from public._session_needs(p_aps, coalesce(p_choices, '{}'::jsonb)) n group by n.product_id) t
      join public.products p on p.id = t.product_id
     where not public.is_single_use_product(p.unit, p.volume)
  loop
    if r.avail + 0.0005 < r.need then
      v_short := v_short || case when v_short = '' then '' else '; ' end
        || concat_ws(' · ', r.name, r.capacity) || ' (cần ' || trim(to_char(r.need, 'FM999999990.999')) || ' ' || public.volume_unit(r.capacity, r.unit)
        || case when r.avail > 0 then ', chai đang mở còn ' || trim(to_char(r.avail, 'FM999999990.999')) else ', chưa có chai đang mở' end || ')';
    end if;
  end loop;
  if v_short <> '' then
    raise exception 'Chi nhánh không đủ sản phẩm đang mở: %. Gửi Xin xuất chai mới hoặc xin chủ spa xác nhận còn hàng rồi mới Hoàn thành được.', v_short;
  end if;
  -- trừ: chai mở trước trừ trước
  for r in
    select t.product_id, t.need, p.volume
      from (select n.product_id, sum(n.qty) need from public._session_needs(p_aps, coalesce(p_choices, '{}'::jsonb)) n group by n.product_id) t
      join public.products p on p.id = t.product_id
     where not public.is_single_use_product(p.unit, p.volume)
  loop
    v_left := r.need;
    for b in
      select oi.id, coalesce(oi.remaining_qty, 0) q from public.opened_items oi
       where oi.warehouse_id = v_wh and oi.product_id = r.product_id and oi.status = 'open' and coalesce(oi.remaining_qty, 0) > 0
       order by oi.opened_at, oi.id for update
    loop
      exit when v_left <= 0;
      v_take := least(v_left, b.q);
      v_after := round(b.q - v_take, 3);
      if v_after <= 0.0005 then v_after := 0; end if;
      update public.opened_items
         set remaining_qty = v_after,
             remaining_pct = case when r.volume > 0 then least(100, round(v_after / r.volume * 100, 2)) else 0 end,
             status = case when v_after = 0 then 'finished' else status end,
             finished_at = case when v_after = 0 then now() else finished_at end,
             finished_by = case when v_after = 0 then (select auth.uid()) else finished_by end,
             finish_note = case when v_after = 0 then 'Tự động: dùng hết theo định mức liệu trình' else finish_note end
       where id = b.id;
      insert into public.treatment_usages (appointment_service_id, warehouse_id, product_id, opened_item_id, qty, qty_before, qty_after)
      values (p_aps, v_wh, r.product_id, b.id, v_take, b.q, v_after);
      v_left := v_left - v_take;
    end loop;
  end loop;
end $$;
revoke execute on function public._consume_session(uuid, jsonb) from public, anon, authenticated;

-- KTV xin chủ spa xác nhận thực tồn vẫn còn
create or replace function public.request_stock_confirm(p_aps uuid, p_product uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_wh uuid := public._session_warehouse(p_aps); v_label text; v_cus text;
begin
  if not exists (select 1 from public.appointment_services
                  where id = p_aps and (technician_id = (select auth.uid()) or public.has_role('owner','manager'))) then
    raise exception 'Dịch vụ này không phải của bạn';
  end if;
  if v_wh is null then raise exception 'Chi nhánh chưa có kho liệu trình'; end if;
  if exists (select 1 from public.usage_stock_confirms where appointment_service_id = p_aps and product_id = p_product and status = 'pending') then
    raise exception 'Đã gửi xin xác nhận sản phẩm này, đang chờ chủ spa duyệt';
  end if;
  insert into public.usage_stock_confirms (appointment_service_id, warehouse_id, product_id, note)
  values (p_aps, v_wh, p_product, nullif(trim(p_note), '')) returning id into v_id;
  select concat_ws(' · ', name, capacity) into v_label from public.products where id = p_product;
  select c.full_name into v_cus from public.appointment_services s join public.appointments a on a.id = s.appointment_id
    join public.customers c on c.id = a.customer_id where s.id = p_aps;
  perform public.notify_users(public.staff_recipients(array['owner']::public.user_role[], null), 'approval',
    'Xác nhận còn hàng cần duyệt',
    concat_ws(' · ', (select full_name from public.profiles where id = (select auth.uid())), v_label, 'khách ' || v_cus),
    '/quan-ly/cho-duyet#con-hang', 'confirm-' || v_id);
  return v_id;
end $$;
revoke execute on function public.request_stock_confirm(uuid, uuid, text) from public, anon;
grant execute on function public.request_stock_confirm(uuid, uuid, text) to authenticated;

-- Chủ spa duyệt: chọn mức còn của chai thực tế → thành chai đang mở
create or replace function public.review_stock_confirm(p_id uuid, p_approve boolean, p_pct numeric default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.usage_stock_confirms; v_oid uuid; v_label text;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa duyệt xác nhận còn hàng'; end if;
  select * into v from public.usage_stock_confirms where id = p_id for update;
  if not found or v.status <> 'pending' then raise exception 'Yêu cầu đã được xử lý'; end if;
  if p_approve then
    if p_pct is null or p_pct <= 0 or p_pct > 100 then raise exception 'Chọn mức còn của chai'; end if;
    insert into public.opened_items (warehouse_id, product_id, remaining_pct, source, unit_cost, opened_by)
    select v.warehouse_id, v.product_id, p_pct, 'confirm', round(coalesce(p.cost_price, 0) * p_pct / 100), v.requested_by
      from public.products p where p.id = v.product_id
    returning id into v_oid;
  end if;
  update public.usage_stock_confirms
     set status = case when p_approve then 'approved' else 'rejected' end,
         remaining_pct = case when p_approve then p_pct end, opened_item_id = v_oid,
         reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id;
  select concat_ws(' · ', name, capacity) into v_label from public.products where id = v.product_id;
  perform public.notify_users(array[v.requested_by], 'result',
    case when p_approve then 'Chủ spa xác nhận còn hàng' else 'Chủ spa không xác nhận còn hàng' end,
    concat_ws(' · ', v_label, nullif(trim(p_note), '')),
    '/quan-ly/ktv/lieu-trinh/' || v.appointment_service_id, 'confirm-r-' || v.id);
end $$;
revoke execute on function public.review_stock_confirm(uuid, boolean, numeric, text) from public, anon;
grant execute on function public.review_stock_confirm(uuid, boolean, numeric, text) to authenticated;

-- ============ 7) HOÀN THÀNH BUỔI → TRỪ SẢN PHẨM ============
drop function if exists public.ktv_progress(uuid, text);
create or replace function public.ktv_progress(p_aps uuid, p_action text, p_choices jsonb default null)
returns public.appointment_services language plpgsql security definer set search_path = '' as $$
declare
  v public.appointment_services;
  v_status public.appointment_status;
  v_total int;
  v_tt int;
  v_check boolean;
  v_before int;
  v_after int;
begin
  select * into v from public.appointment_services where id = p_aps for update;
  if not found then raise exception 'Không tìm thấy dịch vụ'; end if;
  if v.technician_id is distinct from (select auth.uid()) and not public.has_role('owner','manager') then
    raise exception 'Dịch vụ này không phải của bạn';
  end if;
  select status into v_status from public.appointments where id = v.appointment_id;
  if v_status in ('cancelled','no_show') then raise exception 'Lịch đã huỷ'; end if;
  select count(*) into v_total from public.service_procedure_steps where service_id = v.service_id;

  v_tt := public._makeup_step(v.service_id);
  v_check := v_tt is not null and not public.has_role('owner','manager')
             and (select photo_skip_reason is null from public.appointments where id = v.appointment_id);
  if v_check then
    select count(*) filter (where phase = 'before' and angle <> 'extra'),
           count(*) filter (where phase = 'after')
      into v_before, v_after
      from public.session_photos where appointment_id = v.appointment_id;
  end if;

  if p_action = 'start' then
    if v.work_started_at is null then
      update public.appointment_services
         set work_started_at = now(), steps_done = 0, step_log = '[]'::jsonb
       where id = p_aps returning * into v;
      update public.appointments
         set status = case when status in ('pending','confirmed') then 'in_progress'::public.appointment_status else status end,
             ktv_confirmed_at = coalesce(ktv_confirmed_at, now())
       where id = v.appointment_id;
    end if;
  elsif p_action = 'step' then
    if v.work_started_at is null then raise exception 'Bấm Bắt đầu trước'; end if;
    if v.work_done_at is not null then raise exception 'Buổi đã hoàn thành'; end if;
    if v.steps_done >= v_total then raise exception 'Đã xong tất cả các bước'; end if;
    if v_check and v.steps_done + 1 > v_tt and v_before < 3 then
      raise exception 'Chụp đủ 3 ảnh TRƯỚC (Trái, Thẳng mặt, Phải) sau tẩy trang rồi mới làm bước tiếp theo';
    end if;
    update public.appointment_services
       set steps_done = steps_done + 1,
           step_log = step_log || jsonb_build_array(jsonb_build_object('step', v.steps_done + 1, 'at', now()))
     where id = p_aps returning * into v;
  elsif p_action = 'undo' then
    if v.work_done_at is not null or v.steps_done = 0 then raise exception 'Không có bước để bỏ'; end if;
    update public.appointment_services
       set steps_done = steps_done - 1,
           step_log = coalesce((select jsonb_agg(e) from jsonb_array_elements(step_log) e
                                 where (e->>'step')::int <> v.steps_done), '[]'::jsonb)
     where id = p_aps returning * into v;
  elsif p_action = 'finish' then
    if v.work_started_at is null then raise exception 'Bấm Bắt đầu trước'; end if;
    if v_check and v.work_done_at is null then
      if v_before < 3 then raise exception 'Chưa đủ 3 ảnh TRƯỚC (Trái, Thẳng mặt, Phải)'; end if;
      if v_after < 3 and not exists (select 1 from public.appointment_services s
                                      where s.appointment_id = v.appointment_id and s.id <> v.id
                                        and s.is_active and s.work_done_at is null) then
        raise exception 'Chụp đủ 3 ảnh SAU (Trái, Thẳng mặt, Phải) rồi mới hoàn thành buổi';
      end if;
    end if;
    if v.work_done_at is null then
      perform public._consume_session(p_aps, coalesce(p_choices, '{}'::jsonb));
    end if;
    update public.appointment_services
       set work_done_at = coalesce(work_done_at, now()), steps_done = greatest(steps_done, v_total)
     where id = p_aps returning * into v;
  else
    raise exception 'Thao tác không hợp lệ';
  end if;
  return v;
end $$;
revoke execute on function public.ktv_progress(uuid, text, jsonb) from public, anon;
grant execute on function public.ktv_progress(uuid, text, jsonb) to authenticated;
