import 'reflect-metadata';
import { Entity } from 'typeorm';
import { Telemetry1mRow } from './telemetry_1m.base';

/** 1-minute aggregates of the `otel` lane (04 §4.2, ED-9), retention class 30. See `Telemetry1mRow`. */
@Entity({ name: 'telemetry_otel_1m_r30', synchronize: false })
export class TelemetryOtel1mR30 extends Telemetry1mRow {}
