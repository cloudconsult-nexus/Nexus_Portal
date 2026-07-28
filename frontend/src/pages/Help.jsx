import { useNavigate, useParams } from 'react-router-dom';
import { Rocket, ShieldCheck, Database, Code2, BarChart3 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_LABELS } from '../lib/roles.js';
import { PageHeader } from '../components/ui.jsx';
import { HelpSectionNavGroup } from './help/helpUi.jsx';
import BlockRenderer from './help/BlockRenderer.jsx';

import * as GettingStarted from './help/GettingStarted.jsx';
import * as RoleGlobalAdmin from './help/RoleGlobalAdmin.jsx';
import * as RoleCustomerAdmin from './help/RoleCustomerAdmin.jsx';
import * as RoleUser from './help/RoleUser.jsx';
import * as DataDictionary from './help/DataDictionary.jsx';
import * as Reporting from './help/Reporting.jsx';
import * as ApiGuide from './help/ApiGuide.jsx';

const ROLE_PAGES = [RoleGlobalAdmin, RoleCustomerAdmin, RoleUser];

const SECTIONS = {
  'getting-started': { ...GettingStarted, icon: Rocket },
  'role-global-admin': { ...RoleGlobalAdmin, icon: ShieldCheck },
  'role-customer-admin': { ...RoleCustomerAdmin, icon: ShieldCheck },
  'role-user': { ...RoleUser, icon: ShieldCheck },
  'data-dictionary': { ...DataDictionary, icon: Database },
  'reporting': { ...Reporting, icon: BarChart3 },
  'api-guide': { ...ApiGuide, icon: Code2 },
};

function NavItem({ section, icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left ${
        active ? 'bg-signal-amber/10 text-ink font-medium' : 'text-ink/80 hover:bg-surface'
      }`}
    >
      <Icon size={14} className="text-muted shrink-0" /> {label}
    </button>
  );
}

export default function Help() {
  const { section } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const activeKey = SECTIONS[section] ? section : 'getting-started';
  const active = SECTIONS[activeKey];

  // Everyone can read every role's guide (it's documentation, not data),
  // but your own role's guide is listed first.
  const orderedRolePages = [...ROLE_PAGES].sort((a, b) => (a.role === user?.role ? -1 : b.role === user?.role ? 1 : 0));

  return (
    <div>
      <PageHeader title="Help" description="Guides for using OnCall Pro, by topic and by role." />
      <div className="flex" style={{ minHeight: 'calc(100vh - 73px)' }}>
        <div className="w-64 shrink-0 border-r border-line p-4">
          <HelpSectionNavGroup title="Overview">
            <NavItem section="getting-started" icon={SECTIONS['getting-started'].icon} label={GettingStarted.title}
              active={activeKey === 'getting-started'} onClick={() => navigate('/help/getting-started')} />
          </HelpSectionNavGroup>

          <HelpSectionNavGroup title="Role guides">
            {orderedRolePages.map((page) => {
              const key = Object.keys(SECTIONS).find((k) => SECTIONS[k].role === page.role);
              return (
                <NavItem key={page.role} section={key} icon={ShieldCheck}
                  label={`${page.title}${page.role === user?.role ? ' (you)' : ''}`}
                  active={activeKey === key} onClick={() => navigate(`/help/${key}`)} />
              );
            })}
          </HelpSectionNavGroup>

          <HelpSectionNavGroup title="Reference">
            <NavItem section="data-dictionary" icon={Database} label={DataDictionary.title}
              active={activeKey === 'data-dictionary'} onClick={() => navigate('/help/data-dictionary')} />
            <NavItem section="reporting" icon={BarChart3} label={Reporting.title}
              active={activeKey === 'reporting'} onClick={() => navigate('/help/reporting')} />
            <NavItem section="api-guide" icon={Code2} label={ApiGuide.title}
              active={activeKey === 'api-guide'} onClick={() => navigate('/help/api-guide')} />
          </HelpSectionNavGroup>
        </div>

        <div className="flex-1 max-w-2xl px-8 py-6">
          <BlockRenderer blocks={active.blocks} />
        </div>
      </div>
    </div>
  );
}
