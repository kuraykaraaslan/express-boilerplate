import 'reflect-metadata';
import { Entity } from 'typeorm';
import { TelemetryMsgRow } from './telemetry_msg.base';

/** Raw telemetry of retention class 7 (raw retention 7 days, `telemetry.classes.ts`). See `TelemetryMsgRow`. */
@Entity({ name: 'telemetry_msg_r7', synchronize: false })
export class TelemetryMsgR7 extends TelemetryMsgRow {}
