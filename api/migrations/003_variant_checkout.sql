alter table sale_items alter column product_id drop not null;
alter table sale_items add column variant_id uuid;
alter table sale_items add foreign key (organisation_id,variant_id) references product_variants(organisation_id,id);
alter table sale_items add constraint sale_item_has_catalogue_item check ((product_id is null) <> (variant_id is null));
create index sale_items_variant_id_idx on sale_items(variant_id);

alter table inventory_movements alter column product_id drop not null;
alter table inventory_movements add column variant_id uuid;
alter table inventory_movements add foreign key (organisation_id,variant_id) references product_variants(organisation_id,id);
alter table inventory_movements add constraint movement_has_catalogue_item check ((product_id is null) <> (variant_id is null));
create index inventory_movements_variant_id_idx on inventory_movements(variant_id);
