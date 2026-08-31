import { request } from '../../request';

export type SendSupportMessagePayload = {
  message: string;
};

export async function sendSupportMessage(
  payload: SendSupportMessagePayload,
): Promise<void> {
  await request.post('/v1/support/messages', payload);
}
