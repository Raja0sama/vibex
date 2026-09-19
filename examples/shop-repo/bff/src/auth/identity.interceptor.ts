import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { SessionService } from './session.service';

// Every outbound call to a domain API carries the verified user id. The domain
// APIs never see the session token itself.
@Injectable()
export class IdentityInterceptor implements NestInterceptor {
  constructor(private readonly sessions: SessionService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const userId = this.sessions.verify(request.cookies?.session);
    request.outboundHeaders = { 'x-user-id': userId ?? '' };
    return next.handle();
  }
}
