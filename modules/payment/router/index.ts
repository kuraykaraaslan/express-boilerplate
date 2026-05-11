import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import PaymentService from '../payment.service';
import { CreatePaymentDTO, GetPaymentDTO } from '../payment.dto';

const paymentRouter = Router();

/**
 * POST /
 * Start a new payment. Requires authenticated USER.
 */
paymentRouter.post(
  '/',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreatePaymentDTO.safeParse(req.body);
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

/**
 * GET /
 * List payments by tenant. Requires authenticated USER.
 */
paymentRouter.get(
  '/',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.query.tenantId as string;
      if (!tenantId) {
        throw new AppError('tenantId is required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const payments = await PaymentService.findByTenant(tenantId);
      res.json({ payments });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /:paymentId
 * Get payment details. Requires authenticated USER.
 */
paymentRouter.get(
  '/:paymentId',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetPaymentDTO.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const payment = await PaymentService.findById(parsed.data.paymentId);
      res.json(payment);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /:paymentId/checkout
 * Create checkout session and return URL. Requires authenticated USER.
 */
paymentRouter.post(
  '/:paymentId/checkout',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetPaymentDTO.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await PaymentService.createCheckoutSession(parsed.data.paymentId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /webhook/:provider
 * Webhook handler (no auth, provider validates internally).
 */
paymentRouter.post(
  '/webhook/:provider',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { provider } = req.params;
      await PaymentService.handleWebhook(provider, req.body);
      res.status(200).json({ received: true });
    } catch (err) {
      next(err);
    }
  },
);

export default paymentRouter;
