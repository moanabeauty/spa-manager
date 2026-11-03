-- Tiền dịch vụ KTV: có dịch vụ khách trả theo số điểm (vd Meso chấm nốt mụn 3 – 4 điểm)
-- nhưng KTV chỉ được tính 1 lần tiền dịch vụ cho mỗi lần khách đến (mỗi lịch hẹn).
alter table public.services add column fee_once_per_visit boolean not null default false;
update public.services set fee_once_per_visit = true where name_en = 'ACNE SPOT MESO';

create or replace view public.technician_monthly_fees with (security_invoker = true) as
with done as (
  select date_trunc('month', aps.start_at at time zone 'Asia/Ho_Chi_Minh')::date as month,
         aps.technician_id, aps.appointment_id, aps.service_id, aps.technician_fee,
         s.fee_once_per_visit,
         row_number() over (partition by aps.appointment_id, aps.service_id, aps.technician_id order by aps.start_at, aps.id) as k
    from public.appointment_services aps
    join public.appointments a on a.id = aps.appointment_id
    join public.services s on s.id = aps.service_id
   where a.status = 'completed' and aps.technician_id is not null
)
select d.month, d.technician_id, p.full_name, count(*) as services_done, sum(d.technician_fee) as fee_amount
  from done d join public.profiles p on p.id = d.technician_id
 where not d.fee_once_per_visit or d.k = 1
 group by 1, 2, 3;
