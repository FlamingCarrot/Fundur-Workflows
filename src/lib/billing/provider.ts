import type { PlanKey } from "./plans";

/**
 * Where payments plug in. Nothing is charged yet: the app is free during the
 * beta, and the Admin assigns plans by hand. The provider is Whop (Andre's
 * decision, 2026-10-07). Wiring it is one file implementing this interface,
 * returned by `paymentProvider()` once WHOP_API_KEY and the plan ids are set;
 * Whop's webhook then writes subscriptions with source 'provider' through the
 * same store the Admin uses, so plans and limits don't change.
 */
export interface CheckoutRequest {
  workspaceId: string;
  email: string | null;
  plan: Exclude<PlanKey, "free">;
  extraSeats: number;
  /** Where the provider sends the person back to. */
  returnUrl: string;
}

export interface PaymentProvider {
  /** e.g. "paddle"; stored on the subscription. */
  id: string;
  name: string;
  /** A page to pay on. */
  startCheckout(req: CheckoutRequest): Promise<{ url: string }>;
  /** Changes the seat count on a running subscription, prorated by the provider. */
  updateSeats(providerSubscriptionId: string, extraSeats: number): Promise<void>;
  /** Stops renewal; the plan runs to the end of the paid period. */
  cancel(providerSubscriptionId: string): Promise<void>;
  /** A page where the customer manages cards and invoices. */
  customerPortal(providerCustomerId: string): Promise<{ url: string }>;
}

export class PaymentsUnavailableError extends Error {
  constructor() {
    super("Payments aren't switched on yet. Fundur is free during the beta.");
  }
}

/** The provider in use, or null while payments are off. */
export function paymentProvider(): PaymentProvider | null {
  return null;
}

export function paymentsEnabled(): boolean {
  return paymentProvider() !== null;
}
