import 'reflect-metadata';
import { Entity } from 'typeorm';
import { TelemetryMsgRow } from './telemetry_msg.base';

/** Raw telemetry of retention class 30 (raw retention 30 days, `telemetry.classes.ts`). See `TelemetryMsgRow`. */
@Entity({ name: 'telemetry_msg_r30', synchronize: false })
export class TelemetryMsgR30 extends TelemetryMsgRow {}
