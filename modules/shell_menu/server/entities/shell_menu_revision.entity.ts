import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique, Check } from 'typeorm';
import type { MenuSpec } from '../shell_menu.schema';

/** Every `shell_menu.*` text at the moment of a revision: key → language → text. A restore writes them back. */
export type LabelSnapshot = Record<string, Record<string, string>>;

/** One published state of the menu, kept for ever (append-only): a publish, a restore or an import. */
@Entity('shell_menu_revisions')
@Unique('uq_shell_menu_revisions_revision', ['revision'])
@Check('ck_shell_menu_revisions_action', `"action" IN ('publish', 'restore', 'import')`)
@Check('ck_shell_menu_revisions_via', `"via" IN ('ui', 'cli')`)
export class ShellMenuRevision {
  @PrimaryGeneratedColumn('uuid')
  revisionId!: string;

  @Column({ type: 'integer' })
  revision!: number;

  @Column({ type: 'jsonb' })
  spec!: MenuSpec;

  @Column({ type: 'jsonb' })
  labelTexts!: LabelSnapshot;

  @Column({ type: 'varchar', length: 16 })
  action!: 'publish' | 'restore' | 'import';

  @Column({ type: 'varchar', length: 280, nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 8 })
  via!: 'ui' | 'cli';

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
