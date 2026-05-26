import { Migration } from "@mikro-orm/migrations"

export class Migration20260525170000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "gp_inventory_allocation" (
        "id" text not null,
        "order_id" text null,
        "line_item_id" text null,
        "cart_id" text null,
        "customer_id" text null,
        "customer_email" text null,
        "product_id" text not null,
        "variant_id" text not null,
        "inventory_item_id" text null,
        "stock_location_id" text null,
        "qbd_list_id" text null,
        "sku" text null,
        "customer_title" text null,
        "quantity" numeric not null default 0,
        "requested_fulfillment_date" timestamptz null,
        "fulfillment_type" text null,
        "source" text not null default 'customer_web',
        "status" text not null default 'reserved',
        "allocation_reason" text null,
        "override_reason" text null,
        "override_note" text null,
        "staff_actor_customer_id" text null,
        "staff_actor_email" text null,
        "substitution_group_id" text null,
        "original_allocation_id" text null,
        "released_at" timestamptz null,
        "fulfilled_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_inventory_allocation_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_inventory_allocation_audit" (
        "id" text not null,
        "allocation_id" text not null,
        "event_type" text not null,
        "previous_status" text null,
        "next_status" text null,
        "previous_quantity" numeric null,
        "next_quantity" numeric null,
        "actor_type" text not null default 'system',
        "actor_id" text null,
        "actor_email" text null,
        "reason" text null,
        "note" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_inventory_allocation_audit_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_inventory_availability_snapshot" (
        "id" text not null,
        "cart_id" text null,
        "order_id" text null,
        "product_id" text null,
        "variant_id" text not null,
        "qbd_list_id" text null,
        "requested_quantity" numeric not null default 0,
        "requested_fulfillment_date" timestamptz null,
        "fulfillment_type" text null,
        "current_stock_quantity" numeric not null default 0,
        "allocated_quantity" numeric not null default 0,
        "safety_stock_quantity" numeric not null default 0,
        "available_to_promise_quantity" numeric not null default 0,
        "lifecycle" text not null default 'active',
        "decision" text not null default 'available',
        "reason" text null,
        "source" text not null default 'customer_web',
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_inventory_availability_snapshot_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create index if not exists "IDX_gp_inventory_allocation_variant_status_date"
      on "gp_inventory_allocation" ("variant_id", "status", "requested_fulfillment_date")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_inventory_allocation_order"
      on "gp_inventory_allocation" ("order_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_inventory_allocation_line"
      on "gp_inventory_allocation" ("line_item_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_inventory_allocation_qbd_list_id"
      on "gp_inventory_allocation" ("qbd_list_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create unique index if not exists "UQ_gp_inventory_allocation_active_line"
      on "gp_inventory_allocation" ("order_id", "line_item_id")
      where deleted_at is null
        and order_id is not null
        and line_item_id is not null
        and status in ('reserved', 'future_committed', 'blocked', 'fulfilled');
    `)

    this.addSql(`
      create index if not exists "IDX_gp_inventory_allocation_audit_allocation"
      on "gp_inventory_allocation_audit" ("allocation_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_inventory_allocation_audit_event_type"
      on "gp_inventory_allocation_audit" ("event_type")
      where deleted_at is null;
    `)

    this.addSql(`
      create index if not exists "IDX_gp_inventory_availability_snapshot_variant"
      on "gp_inventory_availability_snapshot" ("variant_id", "created_at")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_inventory_availability_snapshot_cart"
      on "gp_inventory_availability_snapshot" ("cart_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_inventory_availability_snapshot_order"
      on "gp_inventory_availability_snapshot" ("order_id")
      where deleted_at is null;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "gp_inventory_availability_snapshot";')
    this.addSql('drop table if exists "gp_inventory_allocation_audit";')
    this.addSql('drop table if exists "gp_inventory_allocation";')
  }
}
