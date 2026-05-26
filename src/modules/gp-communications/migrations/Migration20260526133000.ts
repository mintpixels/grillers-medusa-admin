import { Migration } from "@mikro-orm/migrations"

export class Migration20260526133000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table if exists "gp_communication_flow"
        add column if not exists "message_purpose" text not null default 'marketing_1to1';
    `)

    this.addSql(`
      alter table if exists "gp_email_template"
        add column if not exists "message_purpose" text not null default 'marketing_1to1',
        add column if not exists "consent_required" boolean not null default true;
    `)

    this.addSql(`
      alter table if exists "gp_message_log"
        add column if not exists "message_purpose" text not null default 'transactional',
        add column if not exists "experiment_context" jsonb null;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table if exists "gp_message_log"
        drop column if exists "experiment_context",
        drop column if exists "message_purpose";
    `)

    this.addSql(`
      alter table if exists "gp_email_template"
        drop column if exists "consent_required",
        drop column if exists "message_purpose";
    `)

    this.addSql(`
      alter table if exists "gp_communication_flow"
        drop column if exists "message_purpose";
    `)
  }
}
