import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

// The BFF has already authenticated the caller. This service issues no tokens
// and verifies no signatures; it trusts the forwarded header.
@Injectable()
export class IdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-user-id'];
    if (!userId) return false;
    request.userId = userId;
    return true;
  }
}
