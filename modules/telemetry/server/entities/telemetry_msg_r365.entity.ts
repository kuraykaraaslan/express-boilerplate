import 'reflect-metadata';
import { Entity } from 'typeorm';
import { TelemetryMsgRow } from './telemetry_msg.base';

/** Raw telemetry of retention class 365 (raw retention 90 days, `telemetry.classes.ts`). See `TelemetryMsgRow`. */
@Entity({ name: 'telemetry_msg_r365', synchronize: false })
export class TelemetryMsgR365 extends TelemetryMsgRow {}
