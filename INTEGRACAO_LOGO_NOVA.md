# 🎨 Integração da Nova Logo na Página Principal

## Opções de Integração

### 1️⃣ Hero Banner (Recomendado para primeira visita)

Substituir o `PageHeader` atual pelo novo `DashboardHero`:

```tsx
import DashboardHero from '../components/DashboardHero';

// No seu Dashboard:
<DashboardHero
  userName={user.nome}
  companyName={company?.name}
  isAdmin={user.role === 'admin'}
/>
```

**Efeito:** Banner gradiente com logo destacada, badges de segurança e mensagem de boas-vindas.

---

### 2️⃣ Header Compacto (Recomendado para uso diário)

Substituir o `PageHeader` por `DashboardHeaderCompact`:

```tsx
import DashboardHeaderCompact from '../components/DashboardHeaderCompact';

// No seu Dashboard:
<DashboardHeaderCompact
  userName={user.nome}
  isAdmin={user.role === 'admin'}
/>
```

**Efeito:** Header minimalista com logo, nome do usuário e indicadores de status.

---

### 3️⃣ Cards com Logo Marca d'Água

Usar `StatCardWithLogo` nos cards de estatísticas:

```tsx
import StatCardWithLogo from '../components/StatCardWithLogo';

// No seu Dashboard:
<div className="grid grid-cols-1 md:grid-cols-4 gap-4">
  <StatCardWithLogo
    label="Status de hoje"
    value="Em jornada"
    tone="indigo"
    showLogo={true}
  />
  <StatCardWithLogo
    label="Último registro"
    value="08:30"
    helperText="Origem: App Mobile"
    tone="slate"
    showLogo={true}
  />
  {/* ... */}
</div>
```

**Efeito:** Cards com logo sutil como marca d'água no fundo.

---

## 🎯 Implementação Sugerida no Dashboard.tsx

```tsx
import React from 'react';
import DashboardHero from '../components/DashboardHero';
import DashboardHeaderCompact from '../components/DashboardHeaderCompact';
import StatCardWithLogo from '../components/StatCardWithLogo';

const DashboardPage: React.FC = () => {
  const { user } = useCurrentUser();
  
  // Estado para controlar se é primeira visita
  const [isFirstVisit, setIsFirstVisit] = useState(() => {
    return !localStorage.getItem(`dashboard_seen_${user?.id}`);
  });

  useEffect(() => {
    if (isFirstVisit && user?.id) {
      localStorage.setItem(`dashboard_seen_${user.id}`, 'true');
    }
  }, [isFirstVisit, user?.id]);

  return (
    <div className="space-y-6">
      {/* Opção 1: Hero na primeira visita */}
      {isFirstVisit ? (
        <DashboardHero
          userName={user.nome}
          companyName={user.company?.name}
          isAdmin={user.role === 'admin'}
        />
      ) : (
        /* Opção 2: Header compacto nas visitas seguintes */
        <DashboardHeaderCompact
          userName={user.nome}
          isAdmin={user.role === 'admin'}
        />
      )}

      {/* Opção 3: Cards com logo marca d'água */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCardWithLogo
          label="Status de hoje"
          value={lastPunch ? 'Em jornada' : 'Fora'}
          tone="indigo"
          showLogo={true}
        />
        <StatCardWithLogo
          label="Último registro"
          value={lastRecordSummary?.at.toLocaleTimeString() || '--:--'}
          helperText={lastRecordSummary?.originLabel}
          tone="slate"
          showLogo={true}
        />
        <StatCardWithLogo
          label="Horas hoje"
          value={todayHours}
          tone="emerald"
          showLogo={true}
        />
        <StatCardWithLogo
          label="Saldo mensal"
          value={`${balance?.final_balance || 0}h`}
          tone="amber"
          showLogo={true}
        />
      </div>

      {/* Resto do dashboard... */}
    </div>
  );
};
```

---

## 🎨 Estilos Visuais Disponíveis

| Componente | Tamanho da Logo | Efeitos | Uso Recomendado |
|------------|-----------------|---------|-----------------|
| `DashboardHero` | 80-100px | Glow, gradiente, badges | Primeira visita, destaque máximo |
| `DashboardHeaderCompact` | 40px | Sutil, profissional | Uso diário, não intrusivo |
| `StatCardWithLogo` | 24px (watermark) | Opacidade reduzida | Cards de stats, branding sutil |

---

## 🔧 Customização

### Ajustar tamanho da logo no Hero:
```tsx
// DashboardHero.tsx - linha 35
<img
  src="/logo.svg"
  width={100}  // Ajuste aqui (padrão: 80-100px)
  height={100}
  className="w-20 h-20 md:w-24 md:h-24"
/>
```

### Mudar gradiente do Hero:
```tsx
// DashboardHero.tsx - linha 10
className="bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-700"
```

### Alterar posição da logo nos cards:
```tsx
// StatCardWithLogo.tsx - ajustar classes absolute
<div className="absolute right-2 bottom-2 w-16 h-16 opacity-5">
```

---

## ✅ Checklist de Integração

- [ ] Escolher versão (Hero, Compact ou Cards)
- [ ] Importar componente no Dashboard.tsx
- [ ] Ajustar props (userName, companyName, isAdmin)
- [ ] Testar em mobile e desktop
- [ ] Verificar dark mode
- [ ] Validar performance (lazy loading se necessário)

---

## 🚀 Resultado Esperado

A nova logo biométrica aparecerá de forma:
- **Profissional:** Com efeitos de glow e gradientes
- **Integrada:** Como parte natural da interface
- **Memorável:** Reforçando a identidade do sistema
- **Funcional:** Comunicando segurança e tecnologia

A logo comunica: *"Controle de ponto inteligente + Verificação biométrica + Conformidade legal"*
