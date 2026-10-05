import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OrdersClient {
  private readonly baseUrl: string;

  constructor(private readonly http: HttpService, config: ConfigService) {
    this.baseUrl = config.getOrThrow('ORDER_API_URL');
  }

  listOrders(userToken: string) {
    return this.http.get(`${this.baseUrl}/orders`, { headers: { authorization: userToken } });
  }

  createOrder(userToken: string, body: { shippingAddressId: string }) {
    return this.http.post(`${this.baseUrl}/orders`, body, { headers: { authorization: userToken } });
  }

  cancelOrder(userToken: string, id: string) {
    return this.http.post(`${this.baseUrl}/orders/${id}/cancel`, {}, { headers: { authorization: userToken } });
  }
}
