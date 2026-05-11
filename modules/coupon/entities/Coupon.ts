import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('coupons')
export class Coupon {
  @PrimaryGeneratedColumn('uuid', { name: 'couponId' })
  couponId!: string;

  @Index()
  @Column({ type: 'varchar', unique: true })
  code!: string;

  @Column({ type: 'varchar' })
  discountType!: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  discountValue!: number;

  @Column({ type: 'varchar', nullable: true })
  currency?: string | null;

  @Column({ type: 'int', nullable: true })
  maxUses?: number | null;

  @Column({ type: 'int', default: 0 })
  currentUses!: number;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
