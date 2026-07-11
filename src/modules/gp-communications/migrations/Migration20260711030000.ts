import { Migration } from "@mikro-orm/migrations"

export class Migration20260711030000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "gp_sms_program_suppression" (
        "id" text not null,
        "phone_e164" text not null,
        "program" text not null,
        "reason" text not null default 'keyword_stop',
        "source" text null,
        "suppressed_at" timestamptz not null,
        "restored_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_sms_program_suppression_pkey" primary key ("id")
      );
    `)
    this.addSql(`create index if not exists "IDX_gp_sms_program_suppression_phone_program" on "gp_sms_program_suppression" ("phone_e164", "program") where deleted_at is null;`)
    this.addSql(`create unique index if not exists "UQ_gp_sms_program_suppression_active" on "gp_sms_program_suppression" ("phone_e164", "program") where deleted_at is null and restored_at is null;`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "gp_sms_program_suppression";')
  }
}
