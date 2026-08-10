-- Item 30: an optional "Desired by" date on the order — the day the customer would like their
-- order by. Shown on the order page (with turnaround expectations + a soft nudge), saved here,
-- surfaced + sortable in admin, and written into OrderInfo.txt for scheduling. Optional (nullable);
-- existing orders get NULL. Purely additive.
ALTER TABLE design_orders ADD COLUMN desired_by date;
