export interface MenuItemConfig {
  name: string;
  icon: string;
  route: string;
}

export const menuItems: MenuItemConfig[] = [
  { name: 'Dashboard', icon: 'dashboard', route: '/dashboard' },
  { name: 'Productivity Trends', icon: 'av_timer', route: '/productivity-trends' },
  { name: 'Real-Time Insights', icon: 'insights', route: '/real-time-insights' },
  { name: 'Alerts', icon: 'notification_important', route: '/alerts' },
  { name: 'Employees', icon: 'group', route: '/employees' },
  { name: 'Teams', icon: 'groups', route: '/teams' },
  { name: 'Screenshots', icon: 'perm_media', route: '/screenshots' },
  { name: 'Time and Attendance', icon: 'event_note', route: '/time-attendance' },
  { name: 'Activities', icon: 'storage', route: '/activities' },
  { name: 'Projects', icon: 'work_outline', route: '/projects' },
  { name: 'Reports', icon: 'data_usage', route: '/reports' },
  { name: 'Settings', icon: 'settings', route: '/settings' },
];
