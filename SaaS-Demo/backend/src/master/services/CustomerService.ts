import { conflict, invalid, notFound } from '../errors.js';
import type { CustomerRepository } from '../ports/repositories.js';
import type { MasterCustomer, MasterId } from '../types.js';
import { newMasterId, nowIso } from '../utils.js';

export type CreateCustomerInput = {
  name: string;
  email: string;
  document?: string | null;
  meta?: Record<string, unknown>;
};

export type UpdateCustomerInput = {
  name?: string;
  email?: string;
  document?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * CustomerService — cadastro de clientes do Painel Master.
 * Desacoplado do domínio de ponto / API pública.
 */
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  async create(input: CreateCustomerInput): Promise<MasterCustomer> {
    const email = String(input.email || '').trim().toLowerCase();
    const name = String(input.name || '').trim();
    if (!email || !name) throw invalid('name and email are required');
    const existing = await this.customers.findByEmail(email);
    if (existing) throw conflict(`customer email already exists: ${email}`);
    const now = nowIso();
    const row: MasterCustomer = {
      id: newMasterId(),
      name,
      email,
      document: input.document ?? null,
      createdAt: now,
      updatedAt: now,
      meta: input.meta,
    };
    return this.customers.save(row);
  }

  async get(id: MasterId): Promise<MasterCustomer> {
    const row = await this.customers.findById(id);
    if (!row) throw notFound('customer', id);
    return row;
  }

  async update(id: MasterId, input: UpdateCustomerInput): Promise<MasterCustomer> {
    const current = await this.get(id);
    if (input.email) {
      const email = input.email.trim().toLowerCase();
      const other = await this.customers.findByEmail(email);
      if (other && other.id !== id) throw conflict(`customer email already exists: ${email}`);
      current.email = email;
    }
    if (input.name != null) {
      const name = input.name.trim();
      if (!name) throw invalid('name cannot be empty');
      current.name = name;
    }
    if (input.document !== undefined) current.document = input.document;
    if (input.meta !== undefined) current.meta = input.meta;
    current.updatedAt = nowIso();
    return this.customers.save(current);
  }

  async list(): Promise<MasterCustomer[]> {
    return this.customers.list();
  }
}
