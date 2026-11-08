import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Unique, Check } from 'typeorm';
import type { MenuSpec } from '../shell_menu.schema';

/** Texts a draft changes, per key and language; `null` deletes that language's stored text at publish. */
export type PendingLabels = Record<string, Record<string, string | null>>;

/**
 * The installation's sidebar menu (docs/phases/54-menu-editor, D54-2): at most one `draft` and one `published` row.
 * System-wide by design, like `translations`: there is no tenant column, one menu serves the whole installation.
 */
@Entity('shell_menus')
@Unique('uq_shell_menus_state', ['state'])
@Check('ck_shell_menus_state', `"state" IN ('draft', 'published')`)
export class ShellMenu {
  @PrimaryGeneratedColumn('uuid')
  menuId!: string;

  @Column({ type: 'varchar', length: 16 })
  state!: 'draft' | 'published';

  @Column({ type: 'jsonb' })
  spec!: MenuSpec;

  /** Draft only: label texts in languages other than the spec's English, written at publish. */
  @Column({ type: 'jsonb', nullable: true })
  labels!: PendingLabels | null;

  /** Published: the revision it came from. Draft: the published revision it was based on (0 = none yet). */
  @Column({ type: 'integer', default: 0 })
  revision!: number;

  /** Changes on every save; the editor sends it back (If-Match) so two editors never overwrite each other unseen. */
  @Column({ type: 'varchar', length: 64 })
  etag!: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
