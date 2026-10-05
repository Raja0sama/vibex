import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeClient {
  constructor(private readonly stripe: Stripe) {}

  charge(orderId: string, amountCents: number, currency: string) {
    return this.stripe.paymentIntents.create({ amount: amountCents, currency, metadata: { orderId } });
  }
}
