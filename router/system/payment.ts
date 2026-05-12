import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import PaymentService from '@/modules/payment/payment.service';
import { CreatePaymentRequestSchema, GetPaymentByIdRequestSchema } from '@/modules/payment/payment.dto';

const paymentRouter = Router();

paymentRouter.post(
  '/',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreatePaymentRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const payment = await PaymentService.create(parsed.data);
      res.status(201).json(payment);
    } catch (err) {
      next(err);
    }
  },
);

paymentRouter.get(
  '/',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.query.tenantId as string;
      if (!tenantId) {
        throw new AppError('tenantId is required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await PaymentService.getPaymentsByTenant(tenantId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

paymentRouter.get(
  '/:paymentId',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetPaymentByIdRequestSchema.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const payment = await PaymentService.getById(parsed.data.paymentId);
      res.json(payment);
    } catch (err) {
      next(err);
    }
  },
);

paymentRouter.post(
  '/:paymentId/checkout',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetPaymentByIdRequestSchema.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      // TODO: createCheckoutSession requires CheckoutSessionParams (amount, currency, etc.)
      // Retrieve the payment and build params before calling this method
      const payment = await PaymentService.getById(parsed.data.paymentId);
      const successUrl = (req.body?.successUrl as string) || '';
      const cancelUrl = (req.body?.cancelUrl as string) || '';
      const result = await PaymentService.createCheckoutSession({
        amount: payment.amount,
        currency: payment.currency,
        description: payment.description ?? `Payment ${payment.paymentId}`,
        metadata: {},
        successUrl,
        cancelUrl,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

paymentRouter.post(
  '/webhook/:provider',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // TODO: PaymentService.handleWebhook does not exist — implement provider-specific webhook handling
      const { provider } = req.params;
      void provider;
      res.status(200).json({ received: true });
    } catch (err) {
      next(err);
    }
  },
);

export default paymentRouter;
