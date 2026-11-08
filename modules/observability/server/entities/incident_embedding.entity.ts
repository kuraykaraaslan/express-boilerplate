import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

/**
 * The embedding of one incident's text (observability phase 20.2, similar incidents), kept only for tenants that switched
 * `similarByEmbedding` on. One row per (tenant, incident, model): a vector from one model is never compared with a vector from another.
 *
 * The vector is a plain `real[]`, not a pgvector column: the candidate set of one lookup is one tenant's recent resolved incidents (a few
 * hundred at most), cosine similarity is computed in the service, and no database extension is needed to deploy. `textHash` lets a re-index
 * skip an incident whose text did not change, so an unchanged incident costs no second embedding call.
 */
@Index('uq_incident_embeddings', ['tenantId', 'incidentId', 'model'], { unique: true })
@Index('idx_incident_embeddings_model', ['tenantId', 'model', 'updatedAt'])
@Entity('incident_embeddings')
export class IncidentEmbedding {
  @PrimaryGeneratedColumn('uuid', { name: 'embeddingId' })
  embeddingId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  incidentId!: string

  @Column({ type: 'varchar', length: 60 })
  provider!: string

  @Column({ type: 'varchar', length: 100 })
  model!: string

  @Column({ type: 'int' })
  dims!: number

  /** The embedding, L2-normalised before it is stored (cosine similarity is then a dot product). */
  @Column({ type: 'real', array: true })
  vector!: number[]

  /** sha256 of the text that was embedded. */
  @Column({ type: 'varchar', length: 64 })
  textHash!: string

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
