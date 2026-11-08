import 'reflect-metadata';
import { Entity } from 'typeorm';
import { TelemetryMsgRow } from './telemetry_msg.base';

/** Raw rows of the `otel` lane (04 §4.2, ED-9), retention class 90. See `TelemetryMsgRow`. */
@Entity({ name: 'telemetry_otel_msg_r90', synchronize: false })
export class TelemetryOtelMsgR90 extends TelemetryMsgRow {}
