-- Re-import (overwrite) from Shopify: track where each mockup came from so a re-import can refresh
-- Shopify-sourced Front/Back cells but WARN before touching hand-uploaded ones, and never affect
-- sleeve/hat (which have no Shopify photos). Default 'manual' is the protective choice; the auto-import
-- explicitly stamps 'shopify'. Backfill (approved by Denise, whose Front/Back all came from the
-- auto-import and whose hand-uploads are all sleeves/hat-backs): mark existing Front/Back as 'shopify'.
alter table product_template_mockups
  add column source text not null default 'manual'
  check (source in ('shopify', 'manual'));

update product_template_mockups set source = 'shopify' where zone in ('front', 'back');
