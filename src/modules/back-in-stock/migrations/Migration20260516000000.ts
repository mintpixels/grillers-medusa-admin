import { Migration } from "@mikro-orm/migrations"

export class Migration20260516000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "back_in_stock_inventory_state" (
        "id" text not null,
        "inventory_item_id" text not null,
        "product_id" text null,
        "product_handle" text null,
        "variant_id" text null,
        "sku" text null,
        "available_quantity" numeric not null default 0,
        "was_in_stock" boolean not null default false,
        "out_of_stock_since" timestamptz null,
        "last_restocked_at" timestamptz null,
        "last_seen_at" timestamptz null,
        "last_notification_started_at" timestamptz null,
        "last_notification_finished_at" timestamptz null,
        "last_notification_count" numeric not null default 0,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "back_in_stock_inventory_state_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create unique index if not exists "IDX_back_in_stock_inventory_state_item"
      on "back_in_stock_inventory_state" ("inventory_item_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_back_in_stock_inventory_state_product"
      on "back_in_stock_inventory_state" ("product_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_back_in_stock_inventory_state_variant"
      on "back_in_stock_inventory_state" ("variant_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_back_in_stock_inventory_state_sku"
      on "back_in_stock_inventory_state" ("sku")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_back_in_stock_inventory_state_deleted_at"
      on "back_in_stock_inventory_state" ("deleted_at");
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "back_in_stock_inventory_state";')
  }
}
