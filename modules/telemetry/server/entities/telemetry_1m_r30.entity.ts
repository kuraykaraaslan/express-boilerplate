import 'reflect-metadata';
import { Entity } from 'typeorm';
import { Telemetry1mRow } from './telemetry_1m.base';

/** 1-minute aggregates of retention class 30 (kept 30 days, `telemetry.classes.ts`). See `Telemetry1mRow`. */
@Entity({ name: 'telemetry_1m_r30', synchronize: false })
export class Telemetry1mR30 extends Telemetry1mRow {}
