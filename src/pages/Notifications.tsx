import React from 'react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import PageHeader from '../components/PageHeader';
import { Bell } from 'lucide-react';
import NotificationCenter from '../../components/NotificationCenter';
import { LoadingState } from '../../components/UI';

const NotificationsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();

  if (loading || !user) {
    return <LoadingState message="Carregando..." />;
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Your notifications"
        icon={Bell}
      />
      <div className="mt-6 max-w-2xl">
        <NotificationCenter userId={user.id} />
      </div>
    </div>
  );
};

export default NotificationsPage;
