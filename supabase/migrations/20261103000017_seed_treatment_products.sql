-- Danh mục sản phẩm KHO LIỆU TRÌNH: nhập từ sheet PRODUCT (file "AI QUY TRÌNH LIỆU TRÌNH MOANA 2026").
-- Bỏ nhóm "ĐÃ CẮT MÃ". Giá nhập = cột GIÁ NHẬP. Chưa có mã vạch: quét lần đầu khi nhập hàng để gắn.
-- Sửa nhãn hàng: 4 mã DMK (sheet ghi BIOLOGIQUE RECHERCHE) -> DMK; nhóm OWAY -> OWAY; GENOSYS HR Matrix -> GENOSYS; "NA" -> trống.
-- Đơn vị đếm tồn kho suy ra từ quy cách: Hộp… = hộp, Ống… = ống, …ml = chai, 1 miếng = miếng, …

with src (category, brand, name, capacity, used_in, volume, cost_price, retail_price, note) as (values
  ('TẨY TRANG','DERMEDIC','DERMEDIC Hydrain3 Hialuro Micellar Water H2O 500ml','500ml','Basic, Meso, MNRF, MPT, Phi kim, Peel, Acne Scar',500,328000,null,null),
  ('TẨY TRANG','BIOLOGIQUE RECHERCHE','BR Eau Micellaire Biosensible','500ml','BR',500,2340000,null,null),
  ('TẨY TRANG','BIODERMA','BIODERMA Sensibio H2O','500ml','Basic Low',500,391000,null,null),
  ('SỮA RỬA MẶT','CHRISTINA','CHRISTINA sữa rửa mặt','300ml','Tất cả liệu trình mặt (trừ BR, Bio-Derm)',300,390000,null,null),
  ('SỮA RỬA MẶT','BIOLOGIQUE RECHERCHE','BR Lait S.R.','500ml','BR',500,2460000,null,null),
  ('SỮA RỬA MẶT','BIODERMA','BIODERMA Gel Moussant','500ml','Basic Low',500,367200,null,null),
  ('TẨY DA CHẾT / ENZYME','DERMALOGICA','DERMALOGICA tẩy da chết','170ml','Basic, Basic Low, MNRF, MPT, Body',170,1500000,null,null),
  ('TẨY DA CHẾT / ENZYME','ERICSON','TRIPLE ACTION BODY PEELING E254','1000ml','Body',1000,4200000,null,null),
  ('CHUẨN BỊ DA / TONER','SIMILDIET','SIMILDIET Chuẩn bị da (Degree Lotion 400ml)','400ml','Peel',400,1103600,null,null),
  ('CHUẨN BỊ DA / TONER','CPU','DUNG DỊCH DETOX SỐ 1-2-3','500ml','Basic',500,680000,null,null),
  ('CHUẨN BỊ DA / TONER','BIOLOGIQUE RECHERCHE','BR Lotion P50','500ml','BR',500,3780000,null,null),
  ('TINH CHẤT PHI KIM / MESO','MESOESTETIC','MESOESTETIC 210','25ml','Meso Darkspot, Brightening Meso',25,3978000,null,null),
  ('TINH CHẤT PHI KIM / MESO','DERMICA','TRANACIX','Ống 2ml','Phi kim Brightening',2,255000,null,null),
  ('TINH CHẤT PHI KIM / MESO','EXOCOBIO','EXOMAGE','Hộp 10 ống x 2.5ml','Phi kim Recovery, Hydrating',25,3700000,null,null),
  ('TINH CHẤT PHI KIM / MESO','SUPERJECTION','SUPERJECTION Hyaluronate','Ống 1ml','Glow Fest, Renew Fest',1,1900000,null,null),
  ('TINH CHẤT PHI KIM / MESO','ANUBIS','ANUBIS REGUL OIL CONCENTRATE','Hộp 6 ống x 5ml','Phi kim - Pore Instant',30,1263600,null,'1 hộp 6 ống 5ml - 1.263.600'),
  ('TINH CHẤT PHI KIM / MESO','EXOCOBIO','LAPUROON','Hộp 5 lọ x 5ml','Glow Meso (hộp 5 lọ x 5ml)',25,1900000,null,null),
  ('TINH CHẤT PHI KIM / MESO','INNOESTHETIC','REDNESS INNO','Hộp 4 lọ x 2.5ml','Recovery Meso, Glow Peeling 1 (bản 2)',10,800000,null,'800k/4x2.5ml xuất tay; công ty 3.800k chiết khấu 40%'),
  ('TINH CHẤT PHI KIM / MESO','MEDISEPTE','MEDISEPTE GEL BIO','Hộp 8 lọ x 10ml',null,80,5580000,null,null),
  ('TINH CHẤT PHI KIM / MESO','FUSION','FACNE FUSION','50ml','Acne Meso, Acne Spot Meso',50,2303000,null,null),
  ('TINH CHẤT PHI KIM / MESO',null,'BOTOX (meso)','1 lọ','Mesobotox',1,700000,null,null),
  ('TINH CHẤT PHI KIM / MESO','INNOESTHETIC','MESOESTETIC INNO Meline01','Hộp 6 ống x 2ml','Eye - Brightening Eye Meso',12,1350000,null,null),
  ('TINH CHẤT PHI KIM / MESO','JALUPRO','JALUPRO Young Eye','1 lọ','Eye - Antiaging Eye Meso',1,2805000,null,null),
  ('TINH CHẤT PHI KIM / MESO','TEOXANE','TEOXANE Redensity 2 (2x1ml)','Hộp 2 ống x 1ml','Eye - Teoxane',2,6000000,null,'Công ty 9.400k / 2x1ml - chưa có giá nhập'),
  ('TINH CHẤT PHI KIM / MESO','TEOXANE','TEOXANE REDENSITY 1','Lọ 3ml','Meso Teoxane',3,2290000,null,null),
  ('TINH CHẤT PHI KIM / MESO','FUSION','FUSION MESOMATRIX','Hộp 5 ống x 5ml','Scar Meso',25,2612618,null,null),
  ('TINH CHẤT PHI KIM / MESO','SKIN GENUITY','SKIN GENUITY HAIR','Hộp 5 ống x 5ml','Hair - Anti Hair Lost',25,7680000,null,'1 hộp 5 ống 5ml - giá nhập 7.680.000/hộp'),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','BIOLOGIQUE RECHERCHE','BR L''Eauxygenante xịt dưỡng 150ml','150ml','BR',150,2400000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','BIOLOGIQUE RECHERCHE','BR MC110','250ml','BR - MC110',250,8700000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','BIOLOGIQUE RECHERCHE','BR Booster VIP O2','250ml','BR - VIP O2',250,6500000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','BIOLOGIQUE RECHERCHE','BR Soin Lissant','40ml','BR - Soin Lissant',40,2460000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','BIOLOGIQUE RECHERCHE','BR Lift CVS','40ml','BR - Lift CVS',40,4080000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','BIOLOGIQUE RECHERCHE','BR Coctail d''Actifs Regenerants','10ml','BR - Coctail',10,19800000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','BIOLOGIQUE RECHERCHE','BR Toleskin Set 1 (Cryostick)','1 set','BR - Tole Skin',1,546000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','BIOLOGIQUE RECHERCHE','BR Toleskin Set 2','1 set','BR - Tole Skin',1,1000000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','BIOLOGIQUE RECHERCHE','BR Sérum Extraits Tissulaires','125ml','BR',125,4980000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','BIOLOGIQUE RECHERCHE','BR Serum Biosensible','125ml','BR - Biosensible',125,6000000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','DMK','DMK Enbioment Serum','30ml','DMK Fire and Ice, RF Lymphatic',30,1276500,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','DMK','DMK Beta Gel','30ml','DMK Fire and Ice, RF Lymphatic',30,1400000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','DMK','DMK Herbal Pigment Oil','30ml','DMK Fire and Ice, RF Lymphatic',30,663000,null,null),
  ('TINH CHẤT ĐIỆN DI / BOOSTER / SERUM','DMK','DMK Herb Mineral Mist / Aqua Herb 240ml','240ml','DMK, RF Lymphatic, Basic - Lymphas Therapy',240,1644500,null,null),
  ('PEEL','MD CEUTICAL','SET PEEL MD CEUTICAL','1 set','Brightening Peel',1,335000,null,null),
  ('PEEL','DMK','DMK Enzyme số 2 120gr','Hũ 120g','DMK Enzyme, RF Lymphatic, Basic - Lymphas Therapy',120,2552500,null,null),
  ('PEEL','DMK','DMK Quickpeel 120gr','Hũ 120g','DMK Fire and Ice, Eye',120,1865500,null,null),
  ('PEEL','DMK','DMK Cryo Pro X 100ml','100ml','DMK Enzyme, Fire and Ice, RF Lymphatic',100,1865000,null,null),
  ('PEEL','SESDERMA','MANDELICO','250ml','Glow Peeling 2',250,1925000,null,null),
  ('PEEL','SIMILDIET','SOFTENING MASK 100ml','100ml','Acne Peel 5',100,1290000,null,null),
  ('PEEL','ZENA','TẢO ZENA','1 gói','Bio Peeling',1,390000,390000,null),
  ('PEEL','INNOESTHETIC','TCAge INNO',null,'Scar Peeling 1',null,null,null,'Chưa có giá'),
  ('PEEL','INNOESTHETIC','TCA SKINTECH','25ml','Scar Peeling 2, Acne Scar',25,5500000,null,null),
  ('PEEL','INNOESTHETIC','TCA Aktivator 50%','25ml','Acne Scar - chấm TCA',25,5500000,null,null),
  ('PEEL','NEOSTRATA','RETINOL NEOSTRATA','Ống 1.5ml','Acne Scar',1.5,275000,null,null),
  ('PEEL','SESDERMA','SESDERMA AZELAC RU','30ml','Sensitive Acne Peel',30,4074000,null,null),
  ('PEEL','DERMAQUEST','LACTIC PEEL DERMAQUEST','Hộp 10 ống x 5ml','Glow Peeling 3',50,1590000,null,null),
  ('PEEL','JULIETTE ARMAND','JULIETTE ARMAND MANDELIC 40%','50ml','Glow Peeling (JA Mandelic)',50,1980000,null,null),
  ('PEEL','GIGI','GIGI MANDELIC','50ml','Glow Peeling (Gigi)',50,1450000,null,null),
  ('PEEL','AHOWA','AHOWA','500ml','White Peeling',500,1068000,null,null),
  ('PEEL','INNOESTHETIC','INNO RECOVERY','25ml','Acne Peel Recovery Inno',25,760000,null,null),
  ('PEEL','ERICSON','GLYCOLIC BODY PEELING LOTION 255','500ml','Body',500,4200000,null,null),
  ('MẶT NẠ','BIOLOGIQUE RECHERCHE','BR Masque Vivant','500ml','BR - da dầu',500,4080000,null,null),
  ('MẶT NẠ','BIOLOGIQUE RECHERCHE','BR Masque VIP O2','500ml','BR - da khô, VIP O2',500,7200000,null,null),
  ('MẶT NẠ','BIOLOGIQUE RECHERCHE','BR Masque Biosensible','250ml','BR',250,4500000,null,null),
  ('MẶT NẠ',null,'Mặt nạ bột kháng viêm','Túi 1000g','Basic, Basic Low',1000,150000,null,null),
  ('MẶT NẠ','MONA','MONA Frema','500ml','Basic, MNRF, MPT, Bio Peeling',500,1160000,null,null),
  ('MẶT NẠ',null,'MẶT NẠ GIẤY BẠC B5','1 miếng','Basic',1,3500,null,null),
  ('MẶT NẠ',null,'MASK LXR','1 miếng','Meso, MNRF, MPT, Phi kim, Acne Meso',1,8500,null,null),
  ('MẶT NẠ','SUPERJECTION','CONAPIDIL Cemenphalt','1 miếng','Glow Fest, Renew Fest',1,110000,null,null),
  ('MẶT NẠ',null,'MẶT NẠ Ủ TÊ DẠNG MIẾNG CONDUCTIVE GEL MASK','1 miếng','Mesotherapy / Mesogun',1,40000,null,null),
  ('MẶT NẠ','CPU','CPU Azulene Gel','1000ml','Body',1000,725000,null,null),
  ('MẶT NẠ','ERICSON','EYEZONE Patch','Hộp 4 miếng','Eye',4,1015000,null,null),
  ('MẶT NẠ',null,'MẶT NẠ MẮT THƯỜNG','Hộp 4 miếng','Eye - Thermo Eye',1,500,null,null),
  ('SERUM','CPU','CPU Arbutin','40ml','Basic',40,420000,null,null),
  ('SERUM','BIODERMA','BIODERMA Sebium Serum','30ml','Basic Low',30,479400,null,null),
  ('SERUM','BIODERMA','BIODERMA Sensibio Defensive Serum 30ml','30ml','Basic Low',30,530400,null,null),
  ('SERUM','ERICSON','EYEZONE Fluid / Gel','30ml','Eye',30,1015000,null,null),
  ('KEM DƯỠNG / MASSAGE','SIMILDIET','SIMILDIET Post Treatment','300ml','Tất cả liệu trình mặt',300,750000,null,null),
  ('KEM DƯỠNG / MASSAGE','BIODERMA','BIODERMA Atoderm Intensive Gel Creme','75ml','Basic Low',75,197200,null,null),
  ('KEM DƯỠNG / MASSAGE','ERICSON','ENZYMETIC Smoothing Body Cream E256','500ml','Body',500,4200000,null,null),
  ('KEM DƯỠNG / MASSAGE','ERICSON','EYEZONE Cream','30ml','Eye',30,1015000,null,null),
  ('KEM DƯỠNG / MASSAGE','BIOLOGIQUE RECHERCHE','BR CREME ELASTINE 50ML','50ml','BR',50,1620000,null,null),
  ('KEM DƯỠNG / MASSAGE','HISTOLAB','HISTOLAB kem massage','1000ml','Basic Low',1000,560000,null,null),
  ('KEM DƯỠNG / MASSAGE','COMFORTZONE','COMFORTZONE Recovery Touch Creme','400ml','Basic - massage (Purifying, Hydrain3, Ion Bright, Pro Calm)',400,1750000,null,null),
  ('KEM DƯỠNG / MASSAGE','COMFORTZONE','COMFORTZONE Recovery Touch Oil','230ml','Basic - massage (Purifying, Hydrain3, Ion Bright, Pro Calm)',230,2150000,null,null),
  ('KEM CHỐNG NẮNG',null,'NEORETIN / HELIOCARE','55ml','Dùng trong mọi liệu trình',55,950000,null,null),
  ('KEM CHỐNG NẮNG','BIODERMA','BIODERMA Photoderm','40ml','Basic Low',40,357000,null,null),
  ('TÊ - GEL - VẬT TƯ TIÊU HAO',null,'TÊ TRẮNG SAMSUNGPHARM 450ml','450ml','Meso, MNRF, MPT, Phi kim, Acne Scar',450,1200000,null,null),
  ('TÊ - GEL - VẬT TƯ TIÊU HAO',null,'BỘ VẬT TƯ KHẤU HAO','1 bộ','Tất cả các liệu trình',1,15000,null,null),
  ('TÊ - GEL - VẬT TƯ TIÊU HAO',null,'BỘ DỤNG CỤ','1 bộ','Eye',1,50000,null,null),
  ('TÊ - GEL - VẬT TƯ TIÊU HAO','CPU','CPU Gel','1000ml','MNRF, MPT, Hifu, Triệt lông mặt',1000,665000,null,null),
  ('TÊ - GEL - VẬT TƯ TIÊU HAO',null,'TRANSAMIN','1 ống','Basic',1,18500,null,null),
  ('TÊ - GEL - VẬT TƯ TIÊU HAO','CPU','CPU Hydra Water','1 chai','Body - Aftersun',1,27000,null,null),
  ('TÊ - GEL - VẬT TƯ TIÊU HAO',null,'PDT Gel','Tuýp 3ml (hộp 5 tuýp)','Light Therapy',3,373000,null,null),
  ('KIM - ĐẦU MÁY',null,'KIM 34G (hộp)','Hộp 50 cái','Meso tiêm tay',50,1155000,null,null),
  ('KIM - ĐẦU MÁY',null,'KIM MESOGUN','1 cái','Meso máy',1,270000,null,null),
  ('KIM - ĐẦU MÁY',null,'ĐẦU KIM 12 / KIM LĂN 0.25','1 cái','Phi kim, Glow/Renew Fest',1,100000,null,null),
  ('KIM - ĐẦU MÁY',null,'KIM LĂN 2.0','1 cái','Acne Scar',1,60000,null,null),
  ('KIM - ĐẦU MÁY',null,'KIM 27G','1 cái','Acne Scar',1,0,null,'Miễn phí'),
  ('KIM - ĐẦU MÁY',null,'DAO MỔ số 11 / 12','1 cái','Acne Scar',1,5000,5000,null),
  ('KIM - ĐẦU MÁY',null,'ĐẦU KIM XÂM LẤN máy MNRF','1 đầu kim','MNRF Invasive',1,270000,null,null),
  ('KIM - ĐẦU MÁY',null,'ĐẦU KIM KHÔNG XÂM LẤN máy MNRF','1 đầu kim (dùng ~5 lần)','MNRF Non-Invasive, RF Lymphatic',5,270000,null,'Dùng trung bình 5 lần → 54.000/lần'),
  ('KIM - ĐẦU MÁY',null,'SHOTS MPT / HIFU','10.000 shots','MPT Booster, Neck MPT, Hifu',10000,3500000,null,null),
  ('CHĂM SÓC TÓC (OWAY)','OWAY','OWAY Micro','950ml','Hair',950,1440000,null,null),
  ('CHĂM SÓC TÓC (OWAY)','OWAY','OWAY Volumn','950ml','Hair',950,1350000,null,null),
  ('CHĂM SÓC TÓC (OWAY)','OWAY','OWAY Daily','950ml','Hair',950,1450000,null,null),
  ('CHĂM SÓC TÓC (OWAY)','OWAY','OWAY Silk n Glow Mask','500ml','Hair',500,1350000,null,null),
  ('CHĂM SÓC TÓC (OWAY)','OWAY','OWAY Pure Biodymic','50ml','Hair',50,1220000,null,null),
  ('CHĂM SÓC TÓC (OWAY)','OWAY','OWAY Zanthoxylum','150ml','Hair',150,750000,null,null),
  ('CHĂM SÓC TÓC (OWAY)',null,'RADICAL','15ml','Hair - Anti Hair Lost (phi kim)',15,410000,null,null),
  ('CHĂM SÓC TÓC',null,'BENPATHEN + BIOTIN','Ống 2.5ml','Hair - Anti Hair Lost (phi kim)',2.5,80000,null,null),
  ('PEEL TÓC','GENOSYS','GENOSYS HR Matrix','100ml','Hair - Anti Hair Lost',100,786500,null,null)
)
insert into public.products (category, brand, name, capacity, used_in, volume, cost_price, retail_price, note, unit, for_treatment)
select category, brand, name, capacity, used_in, volume, cost_price, retail_price, note,
       case
         when capacity is null then 'cái'
         when capacity ilike 'hộp%' then 'hộp'
         when capacity ilike 'ống%' or capacity = '1 ống' then 'ống'
         when capacity ilike 'tuýp%' then 'tuýp'
         when capacity ilike 'hũ%' then 'hũ'
         when capacity ilike 'túi%' then 'túi'
         when capacity ilike '%lọ%' then 'lọ'
         when capacity ilike '%miếng' then 'miếng'
         when capacity ilike '%set' then 'set'
         when capacity ilike '%bộ' then 'bộ'
         when capacity ilike '%gói' then 'gói'
         when capacity ilike '%shots' then 'hộp'
         when capacity ilike '%ml' or capacity ilike '%chai' then 'chai'
         else 'cái'
       end,
       true
  from src
 where not exists (select 1 from public.products p where p.name = src.name);
