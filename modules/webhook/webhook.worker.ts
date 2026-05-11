import { Worker, Job } from 'bullmq';
import { getBullMQConnection } from '@/libs/redis';
import { Logger } from '@/libs/logger';
import WebhookService from './webhook.service';

interface DeliveryJobData {
  deliveryId: string;
  webhookId: string;
  url: string;
  secret: string;
  event: string;
  payload: Record<string, unknown>;
  requestBody: string;
}

const webhookWorker = new Worker<DeliveryJobData>(
  WebhookService.QUEUE_NAME,
  async (job: Job<DeliveryJobData>) => {
    Logger.info(`[WebhookWorker] Processing delivery ${job.data.deliveryId}`);
    await WebhookService.sendDelivery(job.data.deliveryId);
  },
  {
    connection: getBullMQConnection(),
    concurrency: 10,
  },
);

webhookWorker.on('completed', (job) => {
  Logger.info(`[WebhookWorker] Job ${job.id} completed`);
});

webhookWorker.on('failed', (job, err) => {
  Logger.error(`[WebhookWorker] Job ${job?.id} failed: ${err.message}`);
});

export default webhookWorker;
