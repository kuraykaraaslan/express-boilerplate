import 'reflect-metadata';
import { Entity } from 'typeorm';
import { Telemetry1mRow } from './telemetry_1m.base';

/** 1-minute aggregates of retention class 90 (kept 31 days, `telemetry.classes.ts`). See `Telemetry1mRow`. */
@Entity({ name: 'telemetry_1m_r90', synchronize: false })
export class Telemetry1mR90 extends Telemetry1mRow {}
