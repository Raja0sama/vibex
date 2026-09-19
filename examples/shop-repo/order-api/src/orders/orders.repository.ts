import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// The only place in the platform that writes to the orders table. The
// Catalogue API reads it through a view and has no write access.
@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(userId: string, shippingAddressId: string) {
    return this.prisma.order.create({
      data: { userId, shippingAddressId, status: 'draft', totalCents: 0 },
    });
  }

  updateStatus(id: string, status: string) {
    return this.prisma.order.update({ where: { id }, data: { status } });
  }

  findForUser(userId: string) {
    return this.prisma.order.findMany({ where: { userId }, orderBy: { placedAt: 'desc' } });
  }
}
