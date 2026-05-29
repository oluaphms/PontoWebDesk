import { getDataProviderMode } from '../config/system';

export const DATA_PROVIDER = {
  get mode() {
    return getDataProviderMode();
  },
};

export type ProviderLoginParams = {
  identifier: string;
  password: string;
};

export type ProviderEmployee = Record<string, unknown>;

export type ProviderPunchPayload = Record<string, unknown>;

export interface IDataProvider {
  login(params: ProviderLoginParams): Promise<any>;
  getEmployees(companyId: string): Promise<ProviderEmployee[]>;
  registerPunch(payload: ProviderPunchPayload): Promise<any>;
  registerPunchBatch(payload: { punches: ProviderPunchPayload[] }): Promise<any>;
  getAccessToken(): Promise<string | null>;
}

