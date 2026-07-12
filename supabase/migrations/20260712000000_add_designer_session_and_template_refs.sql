-- Phase 3 Day 3: capture which product template + print area(s) a design used,
-- plus a frozen geometry snapshot for print-file fidelity.
--
-- All columns are NULLABLE, so this is safe on existing design_orders rows.
-- FKs use ON DELETE SET NULL so admin cleanup of a template/area is never
-- blocked; the jsonb snapshots preserve the exact print geometry regardless.
--
-- NOTE: the file timestamp is a placeholder (20260712000000). When applied via
-- the Supabase dashboard, reconcile the filename with the server-assigned
-- version from `supabase_migrations.schema_migrations` if they differ.

alter table public.design_orders
  add column if not exists template_id uuid
    references public.product_templates(id) on delete set null,
  add column if not exists print_area_front_id uuid
    references public.product_template_print_areas(id) on delete set null,
  add column if not exists print_area_back_id uuid
    references public.product_template_print_areas(id) on delete set null,
  add column if not exists print_area_front jsonb,
  add column if not exists print_area_back jsonb;
