# Adapters Multi-Relógio — PontoWebDesk Agent

## Estrutura

```
agent/adapters/
├── types.ts              # Interfaces e tipos
├── index.ts              # Factory (getAdapter, listSupportedBrands)
├── controlid.adapter.ts  # Control iD (HTTP + iDClass)
├── dimep.adapter.ts        # Dimep (AFD)
├── henry.adapter.ts         # Henry (AFD + placeholder TCP)
└── apiPunch.adapter.ts      # API intermediária (já existente)
```

## Interface ClockAdapter

```typescript
export interface ClockAdapter {
  /**
   * Retorna lista de batidas do relógio.
   * @param device Configuração do dispositivo
   * @param lastSync Data/hora do último sync (ISO string) - opcional
   * @returns Promise com array de batidas normalizadas
   */
  getPunches(device: DeviceConfig, lastSync?: string): Promise<Punch[]>;
}
```

## Tipos

### DeviceConfig
```typescript
interface DeviceConfig {
  id: string;              // ID único do dispositivo
  company_id: string;      // ID da empresa (tenant)
  brand: ClockBrand;       // 'controlid' | 'dimep' | 'henry' | 'topdata'
  ip: string;              // IP do relógio
  port?: number;           // Porta (opcional)
  username?: string;       // Usuário para auth
  password?: string;       // Senha para auth
  extra?: Record<string, unknown>; // Configurações extras específicas
}
```

### Punch
```typescript
interface Punch {
  employee_id: string;     // PIS/CPF/Matrícula
  timestamp: string;       // ISO 8601
  event_type: 'entrada' | 'saída' | 'pausa' | 'batida' | string;
  device_id: string;       // ID do dispositivo
  company_id: string;      // ID da empresa
  raw?: Record<string, unknown>; // Dados brutos
  nsr?: number;            // Número Sequencial de Registro
  dedupe_hash?: string;    // Hash para deduplicação
}
```

## Adapters Implementados

### 1. Control iD (`controlid.adapter.ts`)

**Protocolos:**
- `/load_objects` (HTTP JSON) - preferencial
- `/get_afd.fcgi` (iDClass legado) - fallback

**Configuração:**
```typescript
{
  brand: 'controlid',
  ip: '192.168.1.100',
  port: 80,
  username: 'admin',
  password: 'admin',
  extra: {
    controlid_use_fcgi_only: false,  // forçar modo legado
    load_objects_body: { object: 'access_logs' }
  }
}
```

### 2. Dimep (`dimep.adapter.ts`)

**Protocolo:** AFD (Arquivo Fonte de Dados)

**Fontes de dados:**
1. `extra.afd_text` - conteúdo em memória
2. `extra.afd_mock` - mock para testes
3. `extra.afd_file` - caminho para arquivo

**Configuração:**
```typescript
{
  brand: 'dimep',
  ip: '192.168.1.101',
  extra: {
    afd_file: '/path/to/afd.txt',
    afd_timezone: 'America/Sao_Paulo'
  }
}
```

### 3. Henry (`henry.adapter.ts`)

**Protocolos:**
- AFD (implementado)
- TCP/IP (placeholder - aguardando especificação)
- HTTP API (placeholder - aguardando especificação)

**Configuração:**
```typescript
{
  brand: 'henry',
  ip: '192.168.1.102',
  port: 4370,
  extra: {
    afd_file: '/path/to/henry.afd',
    timezone: 'America/Sao_Paulo'
  }
}
```

## Uso

### Factory Pattern

```typescript
import { getAdapter, listSupportedBrands } from './agent/adapters';

// Listar marcas suportadas
const brands = listSupportedBrands();
// ['controlid', 'dimep', 'henry', 'topdata']

// Obter adapter
const adapter = getAdapter('controlid');
const punches = await adapter.getPunches(deviceConfig, '2024-01-01T00:00:00Z');
```

### Uso Direto

```typescript
import { controlidAdapter } from './agent/adapters';

const punches = await controlidAdapter.getPunches({
  id: 'relogio-01',
  company_id: 'company-123',
  brand: 'controlid',
  ip: '192.168.1.100',
  username: 'admin',
  password: 'admin'
});
```

## Adicionar Novo Adapter

1. Criar arquivo `nova-marca.adapter.ts`:
```typescript
import type { ClockAdapter, DeviceConfig, Punch } from './types';

export const novaMarcaAdapter: ClockAdapter = {
  async getPunches(device: DeviceConfig, lastSync?: string): Promise<Punch[]> {
    // Implementação aqui
    return [];
  }
};
```

2. Registrar em `index.ts`:
```typescript
import { novaMarcaAdapter } from './nova-marca.adapter';

const registry: Record<ClockBrand, ClockAdapter> = {
  controlid: controlidAdapter,
  dimep: dimepAdapter,
  henry: henryAdapter,
  'nova-marca': novaMarcaAdapter,
  topdata: henryAdapter, // placeholder
};
```

## Mock para Desenvolvimento

Todos os adapters retornam dados mockados quando não há configuração válida:

```typescript
// Dimep com mock padrão
const device = {
  brand: 'dimep',
  ip: '0.0.0.0',
  // sem afd_file
};
// Retorna 1 batida mock com timestamp atual
```

## Integração com Agente

O `syncRunner.service.ts` usa os adapters via `runSyncCycle`:

```typescript
import { getAdapter } from '../adapters';

// No sync de cada device:
const adapter = getAdapter(device.brand);
const records = await adapter.getPunches(deviceConfig, lastSync);
```

## Roadmap

- [x] Control iD (HTTP + iDClass)
- [x] Dimep (AFD)
- [x] Henry (AFD + estrutura para TCP)
- [ ] Topdata (especificar protocolo)
- [ ] Henry TCP/IP (aguardando especificação)
- [ ] Henry HTTP API (aguardando especificação)
