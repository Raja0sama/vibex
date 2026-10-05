import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IdentityGuard } from '../auth/identity.guard';
import { OrdersRepository } from './orders.repository';

@Controller('orders')
@UseGuards(IdentityGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersRepository) {}

  @Get()
  listOrders(@Req() req) {
    return this.orders.findForUser(req.user.id);
  }

  @Post()
  createOrder(@Req() req, @Body() body: { shippingAddressId: string }) {
    return this.orders.create(req.user.id, body.shippingAddressId);
  }

  @Post(':id/cancel')
  cancelOrder(@Param('id') id: string) {
    return this.orders.updateStatus(id, 'cancelled');
  }
}
