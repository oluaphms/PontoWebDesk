import type { LucideIcon } from 'lucide-react';
import {
  Home,
  Users,
  Clock,
  BarChart3,
  Zap,
  Building2,
  Briefcase,
  Calendar,
  CalendarClock,
  ClipboardList,
  CircleOff,
  ShieldCheck,
  ShieldAlert,
  Building,
  Settings,
  MapPin,
  Scale,
  User,
  Upload,
  Activity,
} from 'lucide-react';

const map: Record<string, LucideIcon> = {
  home: Home,
  users: Users,
  clock: Clock,
  'bar-chart': BarChart3,
  zap: Zap,
  building: Building,
  building2: Building2,
  briefcase: Briefcase,
  calendar: Calendar,
  'calendar-clock': CalendarClock,
  clipboard: ClipboardList,
  circleOff: CircleOff,
  shield: ShieldCheck,
  shieldAlert: ShieldAlert,
  settings: Settings,
  mapPin: MapPin,
  scale: Scale,
  user: User,
  upload: Upload,
  activity: Activity,
};

export function getNavIcon(iconKey: string): LucideIcon {
  return map[iconKey] ?? Zap;
}
