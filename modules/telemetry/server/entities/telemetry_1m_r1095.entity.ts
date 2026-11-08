import 'reflect-metadata';
import { Entity } from 'typeorm';
import { Telemetry1mRow } from './telemetry_1m.base';

/** 1-minute aggregates of retention class 1095 (kept 31 days, `telemetry.classes.ts`). See `Telemetry1mRow`. */
@Entity({ name: 'telemetry_1m_r1095', synchronize: false })
export class Telemetry1mR1095 extends Telemetry1mRow {}
