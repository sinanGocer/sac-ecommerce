import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260622150108 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "scheduled_message" drop constraint if exists "scheduled_message_idempotency_key_unique";`);
    this.addSql(`alter table if exists "message_template" drop constraint if exists "message_template_key_channel_locale_version_unique";`);
    this.addSql(`alter table if exists "customer_message_preference" drop constraint if exists "customer_message_preference_customer_id_unique";`);
    this.addSql(`create table if not exists "customer_message_preference" ("id" text not null, "customer_id" text not null, "email" text null, "phone" text null, "whatsapp_phone" text null, "transactional_email_enabled" boolean not null default true, "transactional_sms_enabled" boolean not null default true, "transactional_whatsapp_enabled" boolean not null default true, "marketing_email_opt_in" boolean not null default false, "marketing_sms_opt_in" boolean not null default false, "marketing_whatsapp_opt_in" boolean not null default false, "care_reminder_email_opt_in" boolean not null default false, "care_reminder_sms_opt_in" boolean not null default false, "care_reminder_whatsapp_opt_in" boolean not null default false, "appointment_email_opt_in" boolean not null default false, "appointment_sms_opt_in" boolean not null default false, "appointment_whatsapp_opt_in" boolean not null default false, "opt_in_source" text null, "opt_in_ip" text null, "opt_in_user_agent" text null, "opt_in_at" timestamptz null, "opt_out_at" timestamptz null, "kvkk_consent_version" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "customer_message_preference_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_message_preference_deleted_at" ON "customer_message_preference" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customer_message_preference_customer_id_unique" ON "customer_message_preference" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_message_preference_email" ON "customer_message_preference" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_message_preference_phone" ON "customer_message_preference" ("phone") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "message_event" ("id" text not null, "scheduled_message_id" text null, "customer_id" text null, "event_type" text check ("event_type" in ('queued', 'consent_checked', 'skipped', 'sent', 'failed', 'delivered', 'opened', 'clicked', 'opted_in', 'opted_out')) not null, "channel" text check ("channel" in ('email', 'sms', 'whatsapp')) null, "provider" text null, "provider_event_id" text null, "data" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "message_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_event_deleted_at" ON "message_event" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_event_scheduled_message_id" ON "message_event" ("scheduled_message_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_event_customer_id" ON "message_event" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_event_event_type" ON "message_event" ("event_type") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "message_template" ("id" text not null, "key" text not null, "channel" text check ("channel" in ('email', 'sms', 'whatsapp')) not null, "message_type" text check ("message_type" in ('transactional', 'marketing', 'care', 'appointment')) not null, "locale" text not null default 'tr-TR', "subject" text null, "body" text not null, "variables_schema" jsonb null, "is_active" boolean not null default true, "version" integer not null default 1, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "message_template_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_template_deleted_at" ON "message_template" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_message_template_key_channel_locale_version_unique" ON "message_template" ("key", "channel", "locale", "version") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_template_key_channel_locale" ON "message_template" ("key", "channel", "locale") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "scheduled_message" ("id" text not null, "customer_id" text not null, "order_id" text null, "appointment_id" text null, "template_id" text not null, "channel" text check ("channel" in ('email', 'sms', 'whatsapp')) not null, "message_type" text check ("message_type" in ('transactional', 'marketing', 'care', 'appointment')) not null, "recipient" text not null, "payload" jsonb null, "scheduled_at" timestamptz not null, "sent_at" timestamptz null, "status" text check ("status" in ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped')) not null default 'pending', "skip_reason" text null, "failure_reason" text null, "provider" text null, "provider_message_id" text null, "retry_count" integer not null default 0, "idempotency_key" text not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "scheduled_message_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_scheduled_message_idempotency_key_unique" ON "scheduled_message" ("idempotency_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_scheduled_message_deleted_at" ON "scheduled_message" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_scheduled_message_status_scheduled_at" ON "scheduled_message" ("status", "scheduled_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_scheduled_message_customer_id" ON "scheduled_message" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_scheduled_message_order_id" ON "scheduled_message" ("order_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "customer_message_preference" cascade;`);

    this.addSql(`drop table if exists "message_event" cascade;`);

    this.addSql(`drop table if exists "message_template" cascade;`);

    this.addSql(`drop table if exists "scheduled_message" cascade;`);
  }

}
