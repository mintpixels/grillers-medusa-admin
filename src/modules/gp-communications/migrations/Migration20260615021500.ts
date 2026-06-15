import { Migration } from "@mikro-orm/migrations"

export class Migration20260615021500 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "gp_phone_number_intelligence" (
        "id" text not null,
        "phone_key" text not null,
        "e164" text null,
        "normalized_digits" text null,
        "valid_us" boolean not null default false,
        "validation_error" text null,
        "twilio_lookup_status" text not null default 'not_requested',
        "twilio_lookup_fields" text null,
        "twilio_lookup_performed_at" timestamptz null,
        "twilio_error_code" text null,
        "twilio_error_message" text null,
        "line_type" text null,
        "carrier_name" text null,
        "mobile_country_code" text null,
        "mobile_network_code" text null,
        "country_code" text null,
        "national_format" text null,
        "is_probable_mobile" boolean not null default false,
        "sms_capable_candidate" boolean not null default false,
        "sms_capability_basis" text not null default 'unknown',
        "source_observation_count" numeric not null default 0,
        "customer_observation_count" numeric not null default 0,
        "first_observed_at" timestamptz null,
        "last_observed_at" timestamptz null,
        "provider_response" jsonb null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_phone_number_intelligence_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_customer_phone_observation" (
        "id" text not null,
        "observation_key" text not null,
        "phone_key" text not null,
        "phone_intelligence_id" text null,
        "e164" text null,
        "normalized_digits" text null,
        "valid_us" boolean not null default false,
        "raw_phone" text null,
        "source" text not null,
        "source_record_id" text null,
        "phone_field" text not null,
        "medusa_customer_id" text null,
        "qbd_customer_list_id" text null,
        "legacy_customer_id" text null,
        "profile_id" text null,
        "customer_email_lower" text null,
        "first_name" text null,
        "last_name" text null,
        "company_name" text null,
        "is_primary_customer_phone" boolean not null default false,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_customer_phone_observation_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_customer_phone_recommendation" (
        "id" text not null,
        "customer_key" text not null,
        "medusa_customer_id" text null,
        "qbd_customer_list_id" text null,
        "legacy_customer_id" text null,
        "profile_id" text null,
        "customer_email_lower" text null,
        "phone_key" text null,
        "e164" text null,
        "line_type" text null,
        "sms_capable_candidate" boolean not null default false,
        "recommendation_basis" text not null default 'unknown',
        "candidate_count" numeric not null default 0,
        "mobile_candidate_count" numeric not null default 0,
        "review_candidate_count" numeric not null default 0,
        "evaluated_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_customer_phone_recommendation_pkey" primary key ("id")
      );
    `)

    this.addSql(`create unique index if not exists "UQ_gp_phone_number_intelligence_key" on "gp_phone_number_intelligence" ("phone_key");`)
    this.addSql(`create index if not exists "IDX_gp_phone_number_intelligence_e164" on "gp_phone_number_intelligence" ("e164") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_phone_number_intelligence_line_type" on "gp_phone_number_intelligence" ("line_type") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_phone_number_intelligence_sms" on "gp_phone_number_intelligence" ("sms_capable_candidate", "is_probable_mobile") where deleted_at is null;`)

    this.addSql(`create unique index if not exists "UQ_gp_customer_phone_observation_key" on "gp_customer_phone_observation" ("observation_key");`)
    this.addSql(`create index if not exists "IDX_gp_customer_phone_observation_phone" on "gp_customer_phone_observation" ("phone_key") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_customer_phone_observation_medusa_customer" on "gp_customer_phone_observation" ("medusa_customer_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_customer_phone_observation_qbd_customer" on "gp_customer_phone_observation" ("qbd_customer_list_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_customer_phone_observation_email" on "gp_customer_phone_observation" ("customer_email_lower") where deleted_at is null;`)

    this.addSql(`create unique index if not exists "UQ_gp_customer_phone_recommendation_key" on "gp_customer_phone_recommendation" ("customer_key");`)
    this.addSql(`create index if not exists "IDX_gp_customer_phone_recommendation_medusa_customer" on "gp_customer_phone_recommendation" ("medusa_customer_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_customer_phone_recommendation_phone" on "gp_customer_phone_recommendation" ("phone_key") where deleted_at is null;`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "gp_customer_phone_recommendation";')
    this.addSql('drop table if exists "gp_customer_phone_observation";')
    this.addSql('drop table if exists "gp_phone_number_intelligence";')
  }
}
