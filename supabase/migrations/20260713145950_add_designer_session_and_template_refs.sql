-- Phase 3 Day 3: capture which product template + print area(s) a design used,
-- plus a frozen geometry snapshot for print-file fidelity.
--
-- HISTORY NOTE: the columns were first created via the Supabase dashboard on
-- 2026-07-12 while the MCP connector was down. This file matches the migration
-- recorded in the server history on 2026-07-13 (version 20260713145950) via an
-- idempotent re-apply (add column IF NOT EXISTS) — a no-op on the schema that
-- brought the server migration history back in lockstep with the repo.
--
-- All columns are NULLABLE, so this is safe on existing design_orders rows.
-- FKs use ON DELETE SET NULL so admin cleanup of a template/area is never
-- blocked; the jsonb snapshots preserve the exact print geometry regardless.
alter table public.design_orders
  add column if not exists template_id uuid
    references public.product_templates(id) on delete set null,
  add column if not exists print_area_front_id uuid
    references public.product_template_print_areas(id) on delete set null,
  add column if not exists print_area_back_id uuid
    references public.product_template_print_areas(id) on delete set null,
  add column if not exists print_area_front jsonb,
  add column if not exists print_area_back jsonb;
