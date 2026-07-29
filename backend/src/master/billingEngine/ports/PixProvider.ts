import type {
  BillingProviderName,
  CreatePixChargeInput,
  PixCharge,
} from '../types.js';

/** Port — cobranças PIX (mock; futuro Asaas/PagSeguro/Stripe). */
export interface PixProvider {
  readonly name: BillingProviderName;
  createPixCharge(input: CreatePixChargeInput): Promise<PixCharge>;
  getPixCharge(id: string): Promise<PixCharge | null>;
  listPixCharges(): Promise<PixCharge[]>;
  markPixPaid(id: string): Promise<PixCharge>;
  cancelPixCharge(id: string): Promise<PixCharge>;
}
