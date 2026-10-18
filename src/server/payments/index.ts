import { randomBytes } from "node:crypto";
import { env } from "../env";
import { daraja } from "./daraja";
import type { PaymentProvider } from "./types";

/** Local development: every push is accepted and the status query reports success. No money moves. */
export const mockMpesa: PaymentProvider = {
  name: "mpesa",
  async startPayment() {
    const id = randomBytes(8).toString("hex");
    return { providerRef: `ws_CO_mock_${id}`, merchantRef: `mock-${id}`, customerMessage: "Success. Request accepted for processing (test mode)" };
  },
  async queryStatus(ref) {
    return { state: "success", code: "0", description: "The service request is processed successfully. (test mode)", receipt: `MOCK${ref.slice(-6).toUpperCase()}` };
  },
  parseCallback: daraja.parseCallback,
};

export function mpesaProvider(): PaymentProvider {
  return env().MPESA_ENV === "mock" ? mockMpesa : daraja;
}

export * from "./types";
