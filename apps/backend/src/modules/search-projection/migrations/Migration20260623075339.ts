import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260623075339 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product_search_projection" drop constraint if exists "product_search_projection_product_id_unique";`);
    this.addSql(`create table if not exists "product_search_projection" ("id" text not null, "product_id" text not null, "external_id" text null, "handle" text null, "title" text null, "brand" text null, "category_ids" text[] not null, "category_path" text null, "subcategory" text null, "collection" text null, "hair_type" text[] not null, "concerns" text[] not null, "benefits" text[] not null, "size_ml" integer null, "vegan" boolean null, "color_safe" boolean null, "professional_only" boolean not null default false, "price" numeric null, "currency" text not null default 'try', "in_stock" boolean not null default false, "thumbnail" text null, "average_rating" real null, "review_count" integer not null default 0, "weekly_sales_score" real not null default 0, "monthly_sales_score" real not null default 0, "all_time_sales_score" real not null default 0, "favorite_score" real not null default 0, "trending_score" real not null default 0, "source_created_at" timestamptz null, "source_updated_at" timestamptz null, "metadata_version" integer not null default 1, "projection_schema_version" integer not null default 1, "raw_price" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_search_projection_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_product_search_projection_product_id_unique" ON "product_search_projection" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_search_projection_deleted_at" ON "product_search_projection" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_search_projection_handle" ON "product_search_projection" ("handle") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_search_projection_brand" ON "product_search_projection" ("brand") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_search_projection_category_path" ON "product_search_projection" ("category_path") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_search_projection_price" ON "product_search_projection" ("price") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_search_projection_created_at" ON "product_search_projection" ("created_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_search_projection_updated_at" ON "product_search_projection" ("updated_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_product_search_projection_source_created_at" ON "product_search_projection" ("source_created_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_search_projection" cascade;`);
  }

}
