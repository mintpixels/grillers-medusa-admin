import { Migration } from "@mikro-orm/migrations"

export class Migration20260531183000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "gp_order_payment_setup" (
        "id" text not null,
        "order_id" text not null,
        "cart_id" text null,
        "customer_id" text null,
        "customer_email" text null,
        "stripe_customer_id" text null,
        "stripe_payment_method_id" text not null,
        "setup_intent_id" text null,
        "account_holder_id" text null,
        "status" text not null default 'saved',
        "consent_version" text null,
        "consent_text" text null,
        "consented_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_order_payment_setup_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_order_finalization" (
        "id" text not null,
        "order_id" text not null,
        "cart_id" text null,
        "customer_id" text null,
        "customer_email" text null,
        "currency_code" text not null default 'usd',
        "status" text not null default 'needs_pack',
        "display_id" text null,
        "estimated_item_total" numeric null,
        "estimated_shipping_total" numeric null,
        "estimated_tax_total" numeric null,
        "estimated_discount_total" numeric null,
        "estimated_order_total" numeric null,
        "final_item_total" numeric null,
        "final_shipping_total" numeric null,
        "final_tax_total" numeric null,
        "final_discount_total" numeric null,
        "final_order_total" numeric null,
        "delta_total" numeric null,
        "started_at" timestamptz null,
        "started_by" text null,
        "packed_at" timestamptz null,
        "packed_by" text null,
        "reviewed_at" timestamptz null,
        "reviewed_by" text null,
        "charge_attempted_at" timestamptz null,
        "charged_by" text null,
        "charged_at" timestamptz null,
        "charge_attempt_id" text null,
        "released_at" timestamptz null,
        "released_by" text null,
        "blocked_reason" text null,
        "customer_consent_required" boolean not null default false,
        "customer_consent_status" text not null default 'not_required',
        "override_required" boolean not null default false,
        "override_reason" text null,
        "manager_approved_by" text null,
        "manager_approved_at" timestamptz null,
        "stripe_payment_intent_id" text null,
        "stripe_charge_id" text null,
        "stripe_failure_code" text null,
        "stripe_failure_message" text null,
        "qbd_posting_required" boolean not null default false,
        "qbd_posting_status" text null,
        "qbd_posting_action" text null,
        "qbd_posting_request_key" text null,
        "final_charge_email_sent_at" timestamptz null,
        "note" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_order_finalization_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_order_finalization_line" (
        "id" text not null,
        "finalization_id" text not null,
        "order_id" text not null,
        "line_item_id" text not null,
        "product_id" text null,
        "variant_id" text null,
        "sku" text null,
        "qbd_list_id" text null,
        "title_snapshot" text null,
        "customer_title" text null,
        "pricing_mode" text not null default 'fixed',
        "unit_price" numeric null,
        "estimated_unit_price" numeric null,
        "estimated_line_total" numeric null,
        "ordered_quantity" numeric not null default 0,
        "estimated_weight_each" numeric null,
        "estimated_weight_total" numeric null,
        "actual_quantity" numeric null,
        "actual_piece_count" numeric null,
        "actual_weight_each" numeric null,
        "actual_weight_total" numeric null,
        "actual_unit_price" numeric null,
        "final_line_subtotal" numeric null,
        "final_line_total" numeric null,
        "delta_line_total" numeric null,
        "status" text not null default 'needs_weight',
        "replacement_variant_id" text null,
        "replacement_qbd_list_id" text null,
        "replacement_reason" text null,
        "short_reason" text null,
        "requires_customer_consent" boolean not null default false,
        "customer_consent_status" text not null default 'not_required',
        "manager_override_reason" text null,
        "exception_reason" text null,
        "note" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_order_finalization_line_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_final_charge_attempt" (
        "id" text not null,
        "order_id" text not null,
        "finalization_id" text not null,
        "attempt_number" numeric not null default 1,
        "amount" numeric not null,
        "currency_code" text not null default 'usd',
        "stripe_customer_id" text null,
        "stripe_payment_method_id" text not null,
        "stripe_payment_intent_id" text null,
        "stripe_charge_id" text null,
        "status" text not null default 'pending',
        "stripe_status" text null,
        "failure_code" text null,
        "failure_message" text null,
        "idempotency_key" text null,
        "requested_by" text null,
        "requested_at" timestamptz null,
        "succeeded_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_final_charge_attempt_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create unique index if not exists "UQ_gp_order_payment_setup_active_order"
      on "gp_order_payment_setup" ("order_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_order_payment_setup_customer"
      on "gp_order_payment_setup" ("customer_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_order_payment_setup_payment_method"
      on "gp_order_payment_setup" ("stripe_payment_method_id")
      where deleted_at is null;
    `)

    this.addSql(`
      create unique index if not exists "UQ_gp_order_finalization_active_order"
      on "gp_order_finalization" ("order_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_order_finalization_status"
      on "gp_order_finalization" ("status", "created_at")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_order_finalization_customer"
      on "gp_order_finalization" ("customer_id")
      where deleted_at is null;
    `)

    this.addSql(`
      create unique index if not exists "UQ_gp_order_finalization_line_active_item"
      on "gp_order_finalization_line" ("finalization_id", "line_item_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_order_finalization_line_order"
      on "gp_order_finalization_line" ("order_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_order_finalization_line_item"
      on "gp_order_finalization_line" ("line_item_id")
      where deleted_at is null;
    `)

    this.addSql(`
      create index if not exists "IDX_gp_final_charge_attempt_order"
      on "gp_final_charge_attempt" ("order_id", "created_at")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_final_charge_attempt_finalization"
      on "gp_final_charge_attempt" ("finalization_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_gp_final_charge_attempt_payment_intent"
      on "gp_final_charge_attempt" ("stripe_payment_intent_id")
      where deleted_at is null;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "gp_final_charge_attempt";')
    this.addSql('drop table if exists "gp_order_finalization_line";')
    this.addSql('drop table if exists "gp_order_finalization";')
    this.addSql('drop table if exists "gp_order_payment_setup";')
  }
}
