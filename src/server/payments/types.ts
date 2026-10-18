/**
 * Every payment rail (M-Pesa today; Airtel Money, Vodacom M-Pesa, card
 * aggregators later) implements this interface, so billing logic never
 * changes when a new country or provider is added.
 */
export interface StartPaymentInput {
  phone: string; // 2547XXXXXXXX
  amount: number; // whole KES
  reference: string; // shown to the customer (Daraja: max 12 chars)
  description: string;
}

export interface StartPaymentResult {
  providerRef: string; // id we match the callback / status query on
  merchantRef?: string;
  customerMessage: string;
}

export type PaymentState = "pending" | "success" | "failed";

export interface StatusResult {
  state: PaymentState;
  code: string;
  description: string;
  receipt?: string;
}

export interface CallbackResult {
  providerRef: string;
  success: boolean;
  code: string;
  description: string;
  amount?: number;
  receipt?: string;
  phone?: string;
}

export interface PaymentProvider {
  readonly name: string;
  startPayment(input: StartPaymentInput): Promise<StartPaymentResult>;
  queryStatus(providerRef: string): Promise<StatusResult>;
  parseCallback(payload: unknown): CallbackResult | null;
}

export class PaymentError extends Error {}
