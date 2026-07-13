-- Phase 3 Day 5: capture the garment color hex on design_orders so fulfillment
-- has both the color name (selected_color) and its exact hex without a lookup.
-- Nullable → safe on existing rows. Additive, reversible.
alter table public.design_orders
  add column if not exists selected_color_hex text;
