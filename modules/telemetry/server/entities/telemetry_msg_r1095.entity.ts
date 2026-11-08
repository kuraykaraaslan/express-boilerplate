import 'reflect-metadata';
import { Entity } from 'typeorm';
import { TelemetryMsgRow } from './telemetry_msg.base';

/** Raw telemetry of retention class 1095 (raw retention 90 days, `telemetry.classes.ts`). See `TelemetryMsgRow`. */
@Entity({ name: 'telemetry_msg_r1095', synchronize: false })
export class TelemetryMsgR1095 extends TelemetryMsgRow {}
