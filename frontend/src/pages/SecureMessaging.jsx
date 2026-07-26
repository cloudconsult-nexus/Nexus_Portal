import { ShieldCheck } from 'lucide-react';
import { PageHeader, EmptyState } from '../components/ui.jsx';

// Nav/permission scaffolding only (CLAUDE.md) — no backend route exists yet.
// This page exists so the nav item and role gating (navConfig.js's
// messagingOnly) have somewhere to land.
export default function SecureMessaging() {
  return (
    <div>
      <PageHeader title="Secure Messaging" description="Encrypted messaging, coming to Nexus Portal." />
      <div className="p-8">
        <EmptyState icon={ShieldCheck} title="Not yet available" description="Secure Messaging is reserved in the navigation for a future integration." />
      </div>
    </div>
  );
}
