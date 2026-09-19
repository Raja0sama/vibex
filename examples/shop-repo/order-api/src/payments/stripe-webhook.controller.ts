import { Controller, Headers, Post, RawBodyRequest, Req, UnauthorizedException } from '@nestjs/common';
import Stripe from 'stripe';

// Reached directly by Stripe, not through the BFF, so there is no session to
// verify. The signature header is the only thing authenticating this request.
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly stripe = new Stripe(process.env.STRIPE_KEY);

  @Post()
  handle(@Req() request: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(request.rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new UnauthorizedException('bad signature');
    }
    return this.dispatch(event);
  }

  private dispatch(event: Stripe.Event) {
    return { received: true, type: event.type };
  }
}
