// État vide : une icône, une phrase qui dit quoi faire, une action.
import React from 'react';

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, children, action }) => (
  <div className="text-center py-12 px-6">
    <span className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-secondary-container text-on-secondary-container flex items-center justify-center">
      <Icon className="w-7 h-7" aria-hidden="true" />
    </span>
    <p className="text-lg font-medium text-on-surface">{title}</p>
    {children && <p className="mt-1 text-sm text-on-surface-variant max-w-md mx-auto">{children}</p>}
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>
);
