import { Migration } from "@mikro-orm/migrations"

export class Migration20260526120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "gp_customer_profile" (
        "id" text not null,
        "medusa_customer_id" text null,
        "email" text null,
        "email_lower" text null,
        "phone" text null,
        "first_name" text null,
        "last_name" text null,
        "customer_type" text not null default 'dtc',
        "route_market" text not null default 'unknown',
        "lifecycle_stage" text not null default 'lead',
        "total_orders" numeric not null default 0,
        "total_revenue" numeric not null default 0,
        "avg_order_value" numeric not null default 0,
        "first_basket_size" numeric null,
        "first_order_at" timestamptz null,
        "last_order_at" timestamptz null,
        "last_active_at" timestamptz null,
        "preferred_products" jsonb null,
        "preferred_categories" jsonb null,
        "preferred_cuts" jsonb null,
        "preferred_kosher_types" jsonb null,
        "preferred_delivery_zone" text null,
        "holiday_buyer" boolean not null default false,
        "email_consent" boolean not null default false,
        "email_consent_at" timestamptz null,
        "sms_consent" boolean not null default false,
        "sms_consent_at" timestamptz null,
        "preferences" jsonb null,
        "preference_token" text null,
        "engagement_score" numeric not null default 0,
        "rfm_recency" numeric null,
        "rfm_frequency" numeric null,
        "rfm_monetary" numeric null,
        "merged_into_profile_id" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_customer_profile_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_identity_map" (
        "id" text not null,
        "profile_id" text not null,
        "anonymous_id" text null,
        "session_id" text null,
        "cart_id" text null,
        "medusa_customer_id" text null,
        "email_lower" text null,
        "first_seen_at" timestamptz null,
        "last_seen_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_identity_map_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_communication_event" (
        "id" text not null,
        "event_id" text not null,
        "event_name" text not null,
        "source" text not null default 'medusa-server',
        "profile_id" text null,
        "medusa_customer_id" text null,
        "anonymous_id" text null,
        "session_id" text null,
        "cart_id" text null,
        "order_id" text null,
        "email" text null,
        "email_lower" text null,
        "customer_type" text not null default 'unknown',
        "route_market" text not null default 'unknown',
        "campaign_id" text null,
        "flow_id" text null,
        "template_key" text null,
        "message_id" text null,
        "occurred_at" timestamptz not null,
        "received_at" timestamptz not null,
        "properties" jsonb null,
        "context" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_communication_event_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_segment" (
        "id" text not null,
        "key" text not null,
        "name" text not null,
        "description" text null,
        "query_definition" jsonb null,
        "status" text not null default 'active',
        "cached_count" numeric not null default 0,
        "last_computed_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_segment_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_segment_member" (
        "id" text not null,
        "segment_id" text not null,
        "profile_id" text not null,
        "entered_at" timestamptz not null,
        "exited_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_segment_member_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_communication_flow" (
        "id" text not null,
        "key" text not null,
        "name" text not null,
        "description" text null,
        "trigger_event" text null,
        "trigger_segment_key" text null,
        "trigger_conditions" jsonb null,
        "steps" jsonb not null,
        "status" text not null default 'draft',
        "message_stream" text not null default 'lifecycle',
        "message_purpose" text not null default 'marketing_1to1',
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_communication_flow_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_flow_enrollment" (
        "id" text not null,
        "flow_id" text not null,
        "flow_key" text not null,
        "profile_id" text not null,
        "trigger_event_id" text null,
        "trigger_context" jsonb null,
        "current_step_index" numeric not null default 0,
        "status" text not null default 'active',
        "enrolled_at" timestamptz not null,
        "next_action_at" timestamptz null,
        "completed_at" timestamptz null,
        "exited_at" timestamptz null,
        "exit_reason" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_flow_enrollment_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_email_template" (
        "id" text not null,
        "key" text not null,
        "name" text not null,
        "subject" text not null,
        "preheader" text null,
        "html_body" text null,
        "text_body" text null,
        "postmark_template_alias" text null,
        "postmark_template_id" text null,
        "message_stream" text not null default 'lifecycle',
        "message_purpose" text not null default 'marketing_1to1',
        "consent_required" boolean not null default true,
        "variables" jsonb null,
        "preview_model" jsonb null,
        "status" text not null default 'active',
        "version" numeric not null default 1,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_email_template_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_message_log" (
        "id" text not null,
        "idempotency_key" text null,
        "profile_id" text null,
        "medusa_customer_id" text null,
        "email" text not null,
        "email_lower" text not null,
        "channel" text not null default 'email',
        "message_stream" text not null default 'transactional',
        "message_purpose" text not null default 'transactional',
        "topic" text null,
        "template_key" text null,
        "postmark_template_alias" text null,
        "flow_id" text null,
        "flow_key" text null,
        "flow_enrollment_id" text null,
        "campaign_id" text null,
        "order_id" text null,
        "cart_id" text null,
        "subject" text null,
        "status" text not null default 'queued',
        "postmark_message_id" text null,
        "provider_response" jsonb null,
        "template_model" jsonb null,
        "experiment_context" jsonb null,
        "metadata" jsonb null,
        "queued_at" timestamptz null,
        "sent_at" timestamptz null,
        "delivered_at" timestamptz null,
        "opened_at" timestamptz null,
        "clicked_at" timestamptz null,
        "bounced_at" timestamptz null,
        "complained_at" timestamptz null,
        "unsubscribed_at" timestamptz null,
        "failed_at" timestamptz null,
        "error_message" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_message_log_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_suppression_preference" (
        "id" text not null,
        "email" text not null,
        "email_lower" text not null,
        "profile_id" text null,
        "scope" text not null default 'marketing',
        "topic" text null,
        "reason" text not null default 'unsubscribe',
        "source" text null,
        "unsubscribed_at" timestamptz null,
        "resubscribed_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_suppression_preference_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_campaign" (
        "id" text not null,
        "key" text null,
        "name" text not null,
        "description" text null,
        "segment_id" text null,
        "segment_key" text null,
        "template_key" text null,
        "subject" text null,
        "status" text not null default 'draft',
        "scheduled_at" timestamptz null,
        "sent_at" timestamptz null,
        "approved_by" text null,
        "approved_at" timestamptz null,
        "audience_snapshot" jsonb null,
        "metrics" jsonb null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_campaign_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      create table if not exists "gp_link_click" (
        "id" text not null,
        "message_log_id" text null,
        "postmark_message_id" text null,
        "profile_id" text null,
        "email_lower" text null,
        "campaign_id" text null,
        "flow_id" text null,
        "template_key" text null,
        "url" text not null,
        "clicked_at" timestamptz not null,
        "user_agent" text null,
        "ip" text null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gp_link_click_pkey" primary key ("id")
      );
    `)

    this.addSql(`create unique index if not exists "UQ_gp_customer_profile_email_lower" on "gp_customer_profile" ("email_lower") where deleted_at is null and email_lower is not null;`)
    this.addSql(`create unique index if not exists "UQ_gp_customer_profile_medusa_customer_id" on "gp_customer_profile" ("medusa_customer_id") where deleted_at is null and medusa_customer_id is not null;`)
    this.addSql(`create unique index if not exists "UQ_gp_customer_profile_preference_token" on "gp_customer_profile" ("preference_token") where deleted_at is null and preference_token is not null;`)
    this.addSql(`create index if not exists "IDX_gp_customer_profile_lifecycle" on "gp_customer_profile" ("lifecycle_stage") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_customer_profile_route_type" on "gp_customer_profile" ("route_market", "customer_type") where deleted_at is null;`)

    this.addSql(`create index if not exists "IDX_gp_identity_map_profile" on "gp_identity_map" ("profile_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_identity_map_anonymous" on "gp_identity_map" ("anonymous_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_identity_map_cart" on "gp_identity_map" ("cart_id") where deleted_at is null;`)
    this.addSql(`create unique index if not exists "UQ_gp_identity_map_anonymous_active" on "gp_identity_map" ("anonymous_id") where deleted_at is null and anonymous_id is not null;`)

    this.addSql(`create unique index if not exists "UQ_gp_communication_event_event_id" on "gp_communication_event" ("event_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_communication_event_profile_time" on "gp_communication_event" ("profile_id", "occurred_at") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_communication_event_name_time" on "gp_communication_event" ("event_name", "occurred_at") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_communication_event_order" on "gp_communication_event" ("order_id") where deleted_at is null;`)

    this.addSql(`create unique index if not exists "UQ_gp_segment_key" on "gp_segment" ("key") where deleted_at is null;`)
    this.addSql(`create unique index if not exists "UQ_gp_segment_member_active" on "gp_segment_member" ("segment_id", "profile_id") where deleted_at is null and exited_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_segment_member_profile" on "gp_segment_member" ("profile_id") where deleted_at is null;`)

    this.addSql(`create unique index if not exists "UQ_gp_communication_flow_key" on "gp_communication_flow" ("key") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_communication_flow_status" on "gp_communication_flow" ("status") where deleted_at is null;`)
    this.addSql(`create unique index if not exists "UQ_gp_flow_enrollment_trigger" on "gp_flow_enrollment" ("flow_key", "profile_id", "trigger_event_id") where deleted_at is null and trigger_event_id is not null;`)
    this.addSql(`create index if not exists "IDX_gp_flow_enrollment_next_action" on "gp_flow_enrollment" ("next_action_at") where deleted_at is null and status = 'active';`)
    this.addSql(`create index if not exists "IDX_gp_flow_enrollment_profile" on "gp_flow_enrollment" ("profile_id") where deleted_at is null;`)

    this.addSql(`create unique index if not exists "UQ_gp_email_template_key" on "gp_email_template" ("key") where deleted_at is null;`)
    this.addSql(`create unique index if not exists "UQ_gp_message_log_idempotency" on "gp_message_log" ("idempotency_key") where deleted_at is null and idempotency_key is not null;`)
    this.addSql(`create index if not exists "IDX_gp_message_log_email" on "gp_message_log" ("email_lower") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_message_log_postmark" on "gp_message_log" ("postmark_message_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_message_log_order" on "gp_message_log" ("order_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_message_log_status" on "gp_message_log" ("status", "created_at") where deleted_at is null;`)

    this.addSql(`create index if not exists "IDX_gp_suppression_email_scope" on "gp_suppression_preference" ("email_lower", "scope") where deleted_at is null;`)
    this.addSql(`create unique index if not exists "UQ_gp_suppression_active" on "gp_suppression_preference" ("email_lower", "scope", coalesce(topic, '')) where deleted_at is null and resubscribed_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_campaign_status" on "gp_campaign" ("status") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_gp_link_click_message" on "gp_link_click" ("message_log_id") where deleted_at is null;`)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "gp_link_click";')
    this.addSql('drop table if exists "gp_campaign";')
    this.addSql('drop table if exists "gp_suppression_preference";')
    this.addSql('drop table if exists "gp_message_log";')
    this.addSql('drop table if exists "gp_email_template";')
    this.addSql('drop table if exists "gp_flow_enrollment";')
    this.addSql('drop table if exists "gp_communication_flow";')
    this.addSql('drop table if exists "gp_segment_member";')
    this.addSql('drop table if exists "gp_segment";')
    this.addSql('drop table if exists "gp_communication_event";')
    this.addSql('drop table if exists "gp_identity_map";')
    this.addSql('drop table if exists "gp_customer_profile";')
  }
}
