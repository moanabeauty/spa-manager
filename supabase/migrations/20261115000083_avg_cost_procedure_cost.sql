-- GIÁ NHẬP TRUNG BÌNH + COST LIỆU TRÌNH (chỉ CHỦ SPA xem được)
-- 1) Giá nhập trung bình của 1 sản phẩm tại thời điểm xem = bình quân gia quyền giá vốn của các lô hàng
--    CÒN TRONG KHO (theo FIFO: lô nhập trước đã xuất trước). Tính chung cả công ty, mỗi đơn vị lẻ (ống / chai / lọ…).
--    Hết hàng trong kho → lấy giá nhập lần cuối (products.cost_price).
-- 2) Cost liệu trình: mỗi dòng định mức (service_step_items) = định lượng / dung tích 1 đơn vị × giá nhập TB.
--    Hàng dùng 1 lần (miếng, cái, bộ…) = số lượng × giá nhập TB.

create or replace function public._avg_costs(p_ids uuid[] default null)
returns table (product_id uuid, avg_cost numeric, stock_qty numeric)
language sql stable security definer set search_path = '' as $$
  with p as (
    select id, cost_price from public.products where p_ids is null or id = any(p_ids)
  ),
  outs as (
    select m.product_id, sum(-m.quantity)::numeric o
      from public.stock_movements m join p on p.id = m.product_id
     where m.quantity < 0 and m.movement_type::text <> 'transfer_out'
     group by m.product_id
  ),
  lots as (
    select m.product_id, m.quantity::numeric q, coalesce(m.unit_cost, p.cost_price) c,
           sum(m.quantity) over (partition by m.product_id order by m.created_at, m.id)::numeric cum
      from public.stock_movements m join p on p.id = m.product_id
     where m.quantity > 0 and m.movement_type::text <> 'transfer_in'
  ),
  rem as (
    -- phần còn lại của từng lô sau khi đã trừ tổng xuất (FIFO)
    select l.product_id, l.c, greatest(0, least(l.q, l.cum - coalesce(o.o, 0))) r
      from lots l left join outs o on o.product_id = l.product_id
  )
  select p.id,
         coalesce(round(sum(rem.r * rem.c) filter (where rem.c is not null)
                        / nullif(sum(rem.r) filter (where rem.c is not null), 0)),
                  p.cost_price),
         coalesce(sum(rem.r), 0)
    from p left join rem on rem.product_id = p.id
   group by p.id, p.cost_price
$$;
revoke execute on function public._avg_costs(uuid[]) from public, anon, authenticated;

-- Giá nhập TB cho danh sách sản phẩm (ô tìm kiếm, trang sản phẩm). Không phải chủ → trả về rỗng.
create or replace function public.product_avg_costs(p_ids uuid[] default null)
returns table (product_id uuid, avg_cost numeric, stock_qty numeric)
language sql stable security definer set search_path = '' as $$
  select a.* from public._avg_costs(p_ids) a where public.has_role('owner')
$$;
revoke execute on function public.product_avg_costs(uuid[]) from public, anon;
grant execute on function public.product_avg_costs(uuid[]) to authenticated;

-- Cost từng sản phẩm trong quy trình 1 liệu trình. Không phải chủ → trả về rỗng.
create or replace function public.service_step_costs(p_service uuid)
returns table (item_id uuid, step_no int, sort int, product_name text, product_id uuid, qty numeric, unit text,
               avg_cost numeric, cost numeric)
language sql stable security definer set search_path = '' as $$
  with i as (
    select * from public.service_step_items
     where service_id = p_service and product_id is not null and qty is not null and public.has_role('owner')
  ),
  c as (select * from public._avg_costs(coalesce((select array_agg(distinct product_id) from i), '{}'::uuid[])))
  select i.id, i.step_no, i.sort, i.product_name, i.product_id, i.qty,
         case when public.is_single_use_product(p.unit, p.volume) then p.unit else public.volume_unit(p.capacity, p.unit) end,
         c.avg_cost,
         case when c.avg_cost is null then null
              when public.is_single_use_product(p.unit, p.volume) then round(i.qty * c.avg_cost)
              when p.volume > 0 then round(i.qty / p.volume * c.avg_cost)
         end
    from i
    join public.products p on p.id = i.product_id
    left join c on c.product_id = i.product_id
   order by i.step_no, i.sort
$$;
revoke execute on function public.service_step_costs(uuid) from public, anon;
grant execute on function public.service_step_costs(uuid) to authenticated;
