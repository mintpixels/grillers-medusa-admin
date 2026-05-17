import { Migration } from "@mikro-orm/migrations"

export class Migration20260517224000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "legacy_reorder_request" (
        "id" text not null,
        "medusa_customer_id" text not null,
        "email_lower" text null,
        "customer_name" text null,
        "legacy_history_key" text not null,
        "legacy_item_id" text null,
        "sku" text null,
        "title" text not null,
        "product_title" text null,
        "last_ordered_at" timestamptz null,
        "last_order_ref" text null,
        "times_ordered" numeric not null default 0,
        "order_count" numeric not null default 0,
        "total_quantity" numeric not null default 0,
        "unit_price" numeric not null default 0,
        "currency_code" text not null default 'usd',
        "request_status" text not null default 'submitted',
        "notification_status" text null,
        "notification_error" text null,
        "requested_at" timestamptz null default now(),
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "legacy_reorder_request_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create index if not exists "IDX_legacy_reorder_request_medusa_customer_id"
      on "legacy_reorder_request" ("medusa_customer_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_legacy_reorder_request_legacy_history_key"
      on "legacy_reorder_request" ("legacy_history_key")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_legacy_reorder_request_request_status"
      on "legacy_reorder_request" ("request_status")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_legacy_reorder_request_requested_at"
      on "legacy_reorder_request" ("requested_at")
      where deleted_at is null;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "legacy_reorder_request";')
  }
}
