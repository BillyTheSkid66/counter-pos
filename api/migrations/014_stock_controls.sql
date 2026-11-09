alter table product_variants add column reorder_level numeric(12,3) not null default 5 check(reorder_level>=0);
create index product_variants_reorder_idx on product_variants(organisation_id,reorder_level) where active;
