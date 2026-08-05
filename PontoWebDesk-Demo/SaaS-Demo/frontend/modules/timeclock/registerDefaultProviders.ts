import { registerTimeClockProvider } from './factory/providerFactory';
import { ControlIdProvider } from './providers/ControlIdProvider';
import { DimepProvider } from './providers/DimepProvider';
import { HenryProvider } from './providers/HenryProvider';
import { TopdataProvider } from './providers/TopdataProvider';

registerTimeClockProvider('control_id', () => new ControlIdProvider());
registerTimeClockProvider('dimep', () => new DimepProvider());
registerTimeClockProvider('topdata', () => new TopdataProvider());
registerTimeClockProvider('henry', () => new HenryProvider());
