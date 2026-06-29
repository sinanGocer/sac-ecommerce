import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * FIFO concurrency güvenliği için DB seviyesi sertleştirme:
 *
 *  1) cost_allocation.reversed_quantity — bir SALE allocation'ından geri alınan
 *     miktarı izler (kısmi iade güvenliği; duplicate reversal / received üstü
 *     iade engellenir).
 *  2) inventory_cost_lot CHECK constraint'leri:
 *       - remaining_quantity >= 0            → oversell ANINDA reddedilir
 *       - remaining_quantity <= received_quantity → reversal received üstüne çıkamaz
 *     Bu kısıtlar, uygulama mantığı yanılsa bile DB'nin negatif/aşırı stok
 *     yazmasını imkânsız kılar (son savunma hattı).
 *
 * UYGULAMA: Bu migration YALNIZ izole test DB'sinde (medusa_*_test) çalıştırılır.
 * Production/development DB'ye uygulanmaz (feature flag'ler kapalı, tablolar boş).
 */
export class Migration20260629160000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "cost_allocation" add column if not exists "reversed_quantity" integer not null default 0;`);

    this.addSql(`alter table if exists "inventory_cost_lot" drop constraint if exists "inventory_cost_lot_remaining_non_negative";`);
    this.addSql(`alter table if exists "inventory_cost_lot" add constraint "inventory_cost_lot_remaining_non_negative" check ("remaining_quantity" >= 0);`);

    this.addSql(`alter table if exists "inventory_cost_lot" drop constraint if exists "inventory_cost_lot_remaining_le_received";`);
    this.addSql(`alter table if exists "inventory_cost_lot" add constraint "inventory_cost_lot_remaining_le_received" check ("remaining_quantity" <= "received_quantity");`);

    this.addSql(`alter table if exists "cost_allocation" drop constraint if exists "cost_allocation_reversed_non_negative";`);
    this.addSql(`alter table if exists "cost_allocation" add constraint "cost_allocation_reversed_non_negative" check ("reversed_quantity" >= 0 and "reversed_quantity" <= "allocated_quantity");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "inventory_cost_lot" drop constraint if exists "inventory_cost_lot_remaining_non_negative";`);
    this.addSql(`alter table if exists "inventory_cost_lot" drop constraint if exists "inventory_cost_lot_remaining_le_received";`);
    this.addSql(`alter table if exists "cost_allocation" drop constraint if exists "cost_allocation_reversed_non_negative";`);
    this.addSql(`alter table if exists "cost_allocation" drop column if exists "reversed_quantity";`);
  }

}
