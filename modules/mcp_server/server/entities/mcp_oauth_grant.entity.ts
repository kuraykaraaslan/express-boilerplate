import 'reflect-metadata';
import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One OAuth grant of the platform's MCP authorization server (docs/phases/57-mcp-server D57-8): a person of the workspace let one MCP
 * client (identified by its Client ID Metadata Document URL) reach the workspace's MCP servers with `scope`. Tokens are never stored: the
 * current refresh token and the one before it are SHA-256 hashes (the one before only to detect a reused refresh token, which revokes
 * the grant); access tokens live in Redis, hashed, for ten minutes, and every MCP request reads this row's status (revocation is
 * immediate). Tenant RLS forced from birth; migration `001_mcp_server.sql`.
 */
@Entity('mcp_oauth_grants')
@Index('idx_mcp_oauth_grants_user', ['tenantId', 'userId'])
@Index('uq_mcp_oauth_grants_refresh', ['tenantId', 'refreshHash'], { unique: true, where: `"refreshHash" IS NOT NULL` })
@Index('idx_mcp_oauth_grants_previous_refresh', ['tenantId', 'previousRefreshHash'])
@Check('ck_mcp_oauth_grants_status', `"status" IN ('active', 'suspended', 'revoked')`)
export class McpOauthGrant {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_mcp_oauth_grants' })
  grantId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** The person who consented; the grant acts as them and never beyond their rights now. */
  @Column({ type: 'uuid' })
  userId!: string;

  /** The client's Client ID Metadata Document URL. */
  @Column({ type: 'varchar', length: 512 })
  clientId!: string;

  @Column({ type: 'varchar', length: 100 })
  clientName!: string;

  /** The host of `clientId`: what the consent screen showed and what the client allowlist matched. */
  @Column({ type: 'varchar', length: 253 })
  clientHost!: string;

  /** The resource indicator (RFC 8707) the client asked for: the workspace's MCP base or one server of it. */
  @Column({ type: 'varchar', length: 512 })
  resource!: string;

  @Column({ type: 'varchar', length: 100 })
  scope!: string;

  @Column({ type: 'varchar', length: 12, default: 'active' })
  status!: string;

  /** Set by the AI firewall's suspend action; the grant answers nothing until then (or until the undo). */
  @Column({ type: 'timestamptz', nullable: true })
  suspendedUntil!: Date | null;

  @Column({ type: 'char', length: 64, nullable: true })
  refreshHash!: string | null;

  @Column({ type: 'char', length: 64, nullable: true })
  previousRefreshHash!: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  revokedReason!: string | null;
}
