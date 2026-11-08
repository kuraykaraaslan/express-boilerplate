import 'reflect-metadata';
import { Entity } from 'typeorm';
import { TelemetryMsgRow } from './telemetry_msg.base';

/** Raw telemetry of retention class 90 (raw retention 90 days, `telemetry.classes.ts`). See `TelemetryMsgRow`. */
@Entity({ name: 'telemetry_msg_r90', synchronize: false })
export class TelemetryMsgR90 extends TelemetryMsgRow {}
