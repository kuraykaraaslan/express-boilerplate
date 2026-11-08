import 'reflect-metadata';
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Check,
  type IndexOptions,
} from 'typeorm';
import type { TranslationPlatform } from '../translation.types';

// One stored text is unique per (locale, module, platform, key). `platform` is
// nullable and NULL is a real value there (shared by every platform), so the index is
// `NULLS NOT DISTINCT`. TypeORM 0.3 cannot express that, so
// `migrations/001_translations.sql` creates the index and the entity declares the same
// name only to be left alone (`synchronize: false`, honoured by the schema builder but
// absent from IndexOptions here). The index also serves the version and bundle reads,
// which filter on its leading columns.
const SCOPE_KEY_INDEX_OPTIONS = { unique: true, synchronize: false } as IndexOptions;

/**
 * A UI text kept in the database, on top of the module dictionaries in code
 * (`modules/<id>/dictionaries/*.json`): a language the code does not ship, or a
 * corrected text. Read order is database > JSON > English.
 *
 * System-wide by design: there is no tenant column. Every tenant reads the same texts
 * (decided 2026-10-19: a tenant starts with the platform's languages, and having each
 * tenant maintain its own copies of them gains nothing).
 */
@Entity('translations')
@Index('uq_translations_scope_key', ['locale', 'module', 'platform', 'key'], SCOPE_KEY_INDEX_OPTIONS)
@Check('ck_translations_platform', `"platform" IS NULL OR "platform" IN ('web', 'mobile')`)
@Check('ck_translations_key_module', `left("key", length("module") + 1) = "module" || '.'`)
export class Translation {
  @PrimaryGeneratedColumn('uuid')
  translationId!: string;

  /** Language code as the tenant enables it (`bg`, `pt-br`), lowercased. */
  @Column({ type: 'varchar', length: 16 })
  locale!: string;

  /** Module id the key belongs to; the key always starts with `<module>.`. */
  @Column({ type: 'varchar', length: 64 })
  module!: string;

  /** NULL = shared by web and mobile; `web` or `mobile` = that platform only. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  platform!: TranslationPlatform | null;

  /** Flat key, `<module>.<area>.<slug>`, e.g. `auth.login.title`. */
  @Column({ type: 'varchar', length: 255 })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  /** Feeds the version of (locale, module, platform); see the module README. */
  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
