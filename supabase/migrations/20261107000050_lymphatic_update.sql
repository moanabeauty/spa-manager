-- 07/11/2026: LYMPHAS THERAPY (tab BASIC TREATMENT) + RF LYMPHATIC RESET (tab MNRF) theo sheet mới; REDNESS PEEL đã sửa trong tab PRODUCT
update public.products set used_in = 'Recovery Peel', note = 'Hộp 6 ống x 2ml = 12ml, giá nhập 800k/hộp', updated_at = now()
 where name = 'REDNESS PEEL';

update public.services set cost = 157903 where name_en = 'LYMPHAS THERAPY';
update public.services set cost = 359301 where name_en = 'RF LYMPHATIC RESET';

update public.service_procedure_steps p
   set products = array['DMK Enzyme số 2 120gr','DMK Aqua Herb 240ml','ACTROL POWDER']
  from public.services s
 where s.id = p.service_id and s.name_en = 'LYMPHAS THERAPY' and p.step_no = 4;

update public.service_procedure_steps p
   set products = array['DMK Herb Mineral Mist']
  from public.services s
 where s.id = p.service_id and s.name_en = 'RF LYMPHATIC RESET' and p.step_no = 8;

update public.service_procedure_steps p
   set products = array['DMK Enbioment Serum','DMK Beta Gel','DMK Herbal Pigment Oil','ACTROL POWDER','DMK Aqua Herb 240ml']
  from public.services s
 where s.id = p.service_id and s.name_en = 'RF LYMPHATIC RESET' and p.step_no = 10;
