import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('coupon_redemptions')
export class CouponRedemption {
  @PrimaryGeneratedColumn('uuid', { name: 'redemptionId' })
  redemptionId!: string;

  @Index()
  @Column({ type: 'varchar' })
  couponId!: string;

  @Index()
  @Column({ type: 'varchar' })
  tenantId!: string;

  @Index()
  @Column({ type: 'varchar' })
  userId!: string;

  @CreateDateColumn({ type: 'timestamp', name: 'redeemedAt' })
  redeemedAt!: Date;
}
