import { Migration } from "@mikro-orm/migrations"

export class Migration20260526123000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "gp_event_delivery" (
        "id" text not null,
        "event_id" text not null,
        "event_name" text null,
        "target" text not null,
        "status" text not null default 'pending',
        "attempts" numeric not null default 0,
        "last_attempt_at" timestamptz null,
        "delivered_at" timestamptz null,
        "next_attempt_at" timestamptz null,
        "error_message" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_event_delivery_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_cart_lifecycle" (
        "id" text not null,
        "cart_id" text not null,
        "profile_id" text null,
        "anonymous_id" text null,
        "email" text null,
        "email_lower" text null,
        "customer_type" text not null default 'unknown',
        "route_market" text not null default 'unknown',
        "status" text not null default 'active',
        "first_seen_at" timestamptz null,
        "last_activity_at" timestamptz null,
        "checkout_started_at" timestamptz null,
        "expired_at" timestamptz null,
        "recovered_at" timestamptz null,
        "recovered_order_id" text null,
        "expire_after_minutes" numeric not null default 60,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_cart_lifecycle_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_attribution" (
        "id" text not null,
        "profile_id" text null,
        "email_lower" text null,
        "order_id" text not null,
        "cart_id" text null,
        "message_id" text null,
        "campaign_id" text null,
        "flow_id" text null,
        "flow_key" text null,
        "template_key" text null,
        "source_event_id" text null,
        "attribution_type" text not null default 'last_click',
        "attributed_revenue" numeric not null default 0,
        "currency_code" text not null default 'usd',
        "occurred_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_attribution_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_import_run" (
        "id" text not null,
        "source" text not null,
        "status" text not null default 'pending',
        "started_at" timestamptz null,
        "completed_at" timestamptz null,
        "imported_count" numeric not null default 0,
        "skipped_count" numeric not null default 0,
        "failed_count" numeric not null default 0,
        "stats" jsonb null,
        "metadata" jsonb null,
        "error_message" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_import_run_pkey" primary key ("id")
      );
    `)

    this.addSql(`create unique index if not exists "UQ_gp_event_delivery_event_target" on "gp_event_delivery" ("event_id", "target") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_event_delivery_target_status" on "gp_event_delivery" ("target", "status") where deleted_at is null;`)
    this.addSql(`create unique index if not exists "UQ_gp_cart_lifecycle_cart" on "gp_cart_lifecycle" ("cart_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_cart_lifecycle_status_activity" on "gp_cart_lifecycle" ("status", "last_activity_at") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_cart_lifecycle_profile" on "gp_cart_lifecycle" ("profile_id") where deleted_at is null;`)
    this.addSql(`create unique index if not exists "UQ_gp_attribution_order_type" on "gp_attribution" ("order_id", "attribution_type") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_attribution_campaign" on "gp_attribution" ("campaign_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_attribution_flow" on "gp_attribution" ("flow_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_import_run_source_status" on "gp_import_run" ("source", "status") where deleted_at is null;`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "gp_import_run";')
    this.addSql('drop table if exists "gp_attribution";')
    this.addSql('drop table if exists "gp_cart_lifecycle";')
    this.addSql('drop table if exists "gp_event_delivery";')
  }
}
