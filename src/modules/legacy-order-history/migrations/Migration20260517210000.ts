import { Migration } from "@mikro-orm/migrations"

export class Migration20260517210000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "legacy_item_match_rule" (
        "id" text not null,
        "source" text not null default 'quickbooks_desktop',
        "priority" numeric not null default 100,
        "qbd_item_list_id" text null,
        "sku" text null,
        "description_contains" text null,
        "description_fingerprint" text null,
        "medusa_product_id" text null,
        "medusa_variant_id" text null,
        "medusa_product_title" text null,
        "medusa_variant_title" text null,
        "confidence" numeric not null default 0,
        "mapping_source" text null,
        "last_seen_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "legacy_item_match_rule_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create index if not exists "IDX_legacy_item_match_rule_qbd_item_list_id"
      on "legacy_item_match_rule" ("qbd_item_list_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_legacy_item_match_rule_sku"
      on "legacy_item_match_rule" ("sku")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_legacy_item_match_rule_medusa_variant_id"
      on "legacy_item_match_rule" ("medusa_variant_id")
      where deleted_at is null;
    `)
    this.addSql(`
      create index if not exists "IDX_legacy_item_match_rule_priority"
      on "legacy_item_match_rule" ("priority")
      where deleted_at is null;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "legacy_item_match_rule";')
  }
}
