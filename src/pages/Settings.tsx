import React from 'react';
import ProfileView from '../../components/ProfileView';
import type { User } from '../../types';

interface SettingsProps {
  user?: User | null;
}

export default function Settings({ user }: SettingsProps) {
  if (user) {
    return <ProfileView user={user} />;
  }
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
    </div>
  );
}
