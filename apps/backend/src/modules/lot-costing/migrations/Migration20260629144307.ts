import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260629144307 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "lot_product_pricing_policy" drop constraint if exists "lot_product_pricing_policy_variant_id_unique";`);
    this.addSql(`alter table if exists "inventory_planning_policy" drop constraint if exists "inventory_planning_policy_variant_id_unique";`);
    this.addSql(`alter table if exists "inventory_cost_lot" drop constraint if exists "inventory_cost_lot_idempotency_key_unique";`);
    this.addSql(`alter table if exists "cost_allocation" drop constraint if exists "cost_allocation_idempotency_key_unique";`);
    this.addSql(`create table if not exists "cost_adjustment" ("id" text not null, "lot_id" text not null, "quantity_delta" integer not null default 0, "old_cost" numeric null, "new_cost" numeric null, "reason" text null, "actor_id" text null, "raw_old_cost" jsonb null, "raw_new_cost" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cost_adjustment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cost_adjustment_deleted_at" ON "cost_adjustment" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "cost_allocation" ("id" text not null, "order_id" text null, "order_item_id" text null, "line_item_id" text null, "product_id" text not null, "variant_id" text not null, "lot_id" text not null, "allocated_quantity" integer not null, "unit_cost" numeric not null, "total_cost" numeric not null, "allocation_type" text not null default 'sale', "idempotency_key" text not null, "allocated_at" timestamptz not null, "reversed_at" timestamptz null, "raw_unit_cost" jsonb not null, "raw_total_cost" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cost_allocation_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cost_allocation_idempotency_key_unique" ON "cost_allocation" ("idempotency_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cost_allocation_deleted_at" ON "cost_allocation" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "demand_forecast_snapshot" ("id" text not null, "variant_id" text not null, "forecast_date" timestamptz not null, "horizon_days" integer not null, "predicted_demand" integer not null, "lower_bound" integer not null default 0, "upper_bound" integer not null default 0, "confidence_score" integer not null default 0, "model_version" text not null, "input_data_until" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "demand_forecast_snapshot_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_demand_forecast_snapshot_deleted_at" ON "demand_forecast_snapshot" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "forecast_accuracy" ("id" text not null, "variant_id" text not null, "forecast_snapshot_id" text null, "predicted_quantity" integer not null default 0, "actual_quantity" integer not null default 0, "absolute_error" integer not null default 0, "percentage_error" integer null, "bias" integer not null default 0, "evaluated_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "forecast_accuracy_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_forecast_accuracy_deleted_at" ON "forecast_accuracy" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "inventory_cost_lot" ("id" text not null, "purchase_receipt_id" text null, "product_id" text not null, "variant_id" text not null, "inventory_item_id" text null, "location_id" text null, "lot_number" text null, "received_quantity" integer not null, "remaining_quantity" integer not null, "reserved_quantity" integer not null default 0, "unit_purchase_cost" numeric not null, "purchase_vat_rate" integer not null default 0, "allocated_shipping_cost" numeric not null default 0, "allocated_additional_cost" numeric not null default 0, "effective_unit_cost" numeric not null, "received_at" timestamptz not null, "expiry_date" timestamptz null, "status" text not null default 'active', "idempotency_key" text not null, "created_by" text null, "raw_unit_purchase_cost" jsonb not null, "raw_allocated_shipping_cost" jsonb not null default '{"value":"0","precision":20}', "raw_allocated_additional_cost" jsonb not null default '{"value":"0","precision":20}', "raw_effective_unit_cost" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inventory_cost_lot_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_inventory_cost_lot_idempotency_key_unique" ON "inventory_cost_lot" ("idempotency_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_cost_lot_deleted_at" ON "inventory_cost_lot" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "inventory_planning_policy" ("id" text not null, "variant_id" text not null, "supplier_id" text null, "lead_time_days" integer not null default 14, "safety_stock_days" integer not null default 7, "target_cover_days" integer not null default 30, "minimum_order_quantity" integer not null default 0, "order_multiple" integer not null default 1, "maximum_stock_days" integer not null default 120, "service_level" integer not null default 0.9, "manual_monthly_demand" integer null, "manual_override" boolean not null default false, "auto_recommendation_enabled" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inventory_planning_policy_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_inventory_planning_policy_variant_id_unique" ON "inventory_planning_policy" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_planning_policy_deleted_at" ON "inventory_planning_policy" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "lot_product_pricing_policy" ("id" text not null, "product_id" text null, "variant_id" text not null, "sales_vat_rate" integer not null default 0.2, "payment_fee_rate" integer not null default 0, "platform_fee_rate" integer not null default 0, "packaging_cost" numeric not null default 0, "shipping_contribution" numeric not null default 0, "operational_cost" numeric not null default 0, "minimum_profit_amount" numeric not null default 0, "minimum_margin_rate" integer not null default 0, "target_margin_rate" integer not null default 0, "maximum_discount_rate" integer not null default 0, "rounding_strategy" text not null default 'none', "rounding_step" integer not null default 0, "currency" text not null default 'try', "updated_by" text null, "raw_packaging_cost" jsonb not null default '{"value":"0","precision":20}', "raw_shipping_contribution" jsonb not null default '{"value":"0","precision":20}', "raw_operational_cost" jsonb not null default '{"value":"0","precision":20}', "raw_minimum_profit_amount" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "lot_product_pricing_policy_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lot_product_pricing_policy_variant_id_unique" ON "lot_product_pricing_policy" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lot_product_pricing_policy_deleted_at" ON "lot_product_pricing_policy" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "purchase_receipt" ("id" text not null, "supplier_id" text null, "supplier_name" text null, "invoice_number" text null, "receipt_date" timestamptz not null, "currency" text not null default 'try', "total_shipping_cost" numeric not null default 0, "total_additional_cost" numeric not null default 0, "notes" text null, "created_by" text null, "raw_total_shipping_cost" jsonb not null default '{"value":"0","precision":20}', "raw_total_additional_cost" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_receipt_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_receipt_deleted_at" ON "purchase_receipt" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "reorder_recommendation" ("id" text not null, "variant_id" text not null, "current_available_stock" integer not null default 0, "reserved_stock" integer not null default 0, "inbound_stock" integer not null default 0, "forecast_demand" integer not null default 0, "safety_stock" integer not null default 0, "reorder_point" integer not null default 0, "recommended_quantity" integer not null default 0, "recommended_order_date" timestamptz null, "estimated_stockout_date" timestamptz null, "confidence_score" integer not null default 0, "reason_codes" text[] not null, "estimated_purchase_budget" numeric not null default 0, "status" text not null default 'draft', "approved_by" text null, "approved_at" timestamptz null, "raw_estimated_purchase_budget" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "reorder_recommendation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_reorder_recommendation_deleted_at" ON "reorder_recommendation" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "cost_adjustment" cascade;`);

    this.addSql(`drop table if exists "cost_allocation" cascade;`);

    this.addSql(`drop table if exists "demand_forecast_snapshot" cascade;`);

    this.addSql(`drop table if exists "forecast_accuracy" cascade;`);

    this.addSql(`drop table if exists "inventory_cost_lot" cascade;`);

    this.addSql(`drop table if exists "inventory_planning_policy" cascade;`);

    this.addSql(`drop table if exists "lot_product_pricing_policy" cascade;`);

    this.addSql(`drop table if exists "purchase_receipt" cascade;`);

    this.addSql(`drop table if exists "reorder_recommendation" cascade;`);
  }

}
