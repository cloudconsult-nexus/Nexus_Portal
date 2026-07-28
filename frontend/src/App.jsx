import { useState } from 'react';
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { useBranding } from './context/BrandingContext.jsx';
import { topNav, onCallProNav, bottomNav, filterNavItems } from './navConfig.js';
import { ROLE_LABELS } from './lib/roles.js';
import BrandedHeader from './components/BrandedHeader.jsx';
import Login from './pages/Login.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Customers from './pages/Customers.jsx';
import People from './pages/People.jsx';
import CustomerMessages from './pages/CustomerMessages.jsx';
import SecureMessaging from './pages/SecureMessaging.jsx';
import NexusReports from './pages/NexusReports.jsx';
import StatusAlerts from './pages/StatusAlerts.jsx';
import Calendars from './pages/Calendars.jsx';
import Schedule from './pages/Schedule.jsx';
import ShiftSwaps from './pages/ShiftSwaps.jsx';
import OnCallReports from './pages/OnCallReports.jsx';
import AuditLogs from './pages/AuditLogs.jsx';
import Settings from './pages/Settings.jsx';
import BrandingPreview from './pages/BrandingPreview.jsx';
import Invitations from './pages/Invitations.jsx';
import BulkImport from './pages/BulkImport.jsx';
import ReportMappings from './pages/ReportMappings.jsx';
import TasSettings from './pages/TasSettings.jsx';
import Help from './pages/Help.jsx';
import { Settings as SettingsIcon, LogOut, Menu, X } from 'lucide-react';

function navLinkClass({ isActive }) {
  return `flex items-center gap-3 pl-2.5 pr-3 py-2 rounded-lg text-sm font-medium transition-colors border-l-2 ${
    isActive ? 'bg-white/10 text-white' : 'border-transparent text-white/70 hover:text-white hover:bg-white/5'
  }`;
}

function NavList({ items, user, accentColor, onNavigate }) {
  return filterNavItems(items, user)
    .map(({ to, label, icon: Icon, end }) => (
      <NavLink key={to} to={to} end={end} className={navLinkClass} style={({ isActive }) => (isActive ? { borderLeftColor: accentColor } : undefined)} onClick={onNavigate}>
        <Icon size={17} strokeWidth={1.5} />
        {label}
      </NavLink>
    ));
}

// Below the `lg` breakpoint the sidebar becomes a slide-out drawer (fixed +
// translate-x, toggled by the hamburger in the mobile header bar) instead of
// a permanently-visible column — on a phone-width screen a static 256px
// sidebar would otherwise eat a third of the screen on every single page.
// `lg:static lg:translate-x-0` restores the original always-visible desktop
// layout untouched.
function Shell({ children }) {
  const { user, logout } = useAuth();
  const branding = useBranding();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen flex bg-surface">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={closeSidebar} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-ink text-white flex flex-col transform transition-transform duration-200 ease-in-out
          lg:static lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="relative shrink-0">
          <BrandedHeader branding={branding} />
          <button onClick={closeSidebar} className="lg:hidden absolute top-4 right-4 text-ink/60 hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <NavList items={topNav} user={user} accentColor={branding.accentColor} onNavigate={closeSidebar} />

          <div className="pt-4 mt-2 border-t border-white/10">
            <p className="px-3 pb-1.5 pt-3 text-[15px] font-semibold tracking-tight">OnCall Pro</p>
            <NavList items={onCallProNav} user={user} accentColor={branding.accentColor} onNavigate={closeSidebar} />
          </div>

          <div className="pt-4 mt-2 border-t border-white/10">
            <NavList items={bottomNav} user={user} accentColor={branding.accentColor} onNavigate={closeSidebar} />
          </div>
        </nav>
        <div className="px-3 py-4 border-t border-white/10 shrink-0">
          <div className="px-3 py-2 mb-1">
            <p className="text-sm font-medium truncate">{user?.display_name}</p>
            <p className="text-xs text-white/50 truncate font-mono">
              {ROLE_LABELS[user?.role]}
            </p>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/5"
          >
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-ink text-white shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="text-white/80 hover:text-white">
            <Menu size={22} />
          </button>
          <span className="text-sm font-semibold tracking-tight">{branding.nameOverride || 'Nexus Portal'}</span>
        </div>
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/customers" element={<Protected><Customers /></Protected>} />
      <Route path="/people" element={<Protected><People /></Protected>} />
      <Route path="/invitations" element={<Protected><Invitations /></Protected>} />
      <Route path="/bulk-import" element={<Protected><BulkImport /></Protected>} />
      <Route path="/customer-messages" element={<Protected><CustomerMessages /></Protected>} />
      <Route path="/secure-messaging" element={<Protected><SecureMessaging /></Protected>} />
      <Route path="/reports" element={<Protected><NexusReports /></Protected>} />
      <Route path="/status-alerts" element={<Protected><StatusAlerts /></Protected>} />
      <Route path="/calendars" element={<Protected><Calendars /></Protected>} />
      <Route path="/schedule" element={<Protected><Schedule /></Protected>} />
      <Route path="/shift-swaps" element={<Protected><ShiftSwaps /></Protected>} />
      <Route path="/oncall-reports" element={<Protected><OnCallReports /></Protected>} />
      <Route path="/audit-logs" element={<Protected><AuditLogs /></Protected>} />
      <Route path="/branding" element={<Protected><BrandingPreview /></Protected>} />
      <Route path="/report-mappings" element={<Protected><ReportMappings /></Protected>} />
      <Route path="/tas-settings" element={<Protected><TasSettings /></Protected>} />
      <Route path="/help/:section" element={<Protected><Help /></Protected>} />
      <Route path="/help" element={<Navigate to="/help/getting-started" replace />} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
