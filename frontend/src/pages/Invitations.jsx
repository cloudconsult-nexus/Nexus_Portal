import { useEffect, useState } from 'react';
import { Send, Ban } from 'lucide-react';
import { api } from '../lib/api.js';
import { ROLE_LABELS } from '../lib/roles.js';
import { PageHeader, Card, Button, Table, Badge, LoadingBlock, EmptyState, ErrorBanner } from '../components/ui.jsx';

const STATUS_TONE = { pending: 'amber', accepted: 'green', revoked: 'red', expired: 'neutral' };

export default function Invitations() {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get('/invitations');
      setInvitations(data.invitations);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function act(id, action) {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/invitations/${id}/${action}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Invitations" description="Pending and past invitations sent from the People page." />
      <div className="p-8 space-y-4">
        {error && <ErrorBanner message={error} />}
        {loading ? <LoadingBlock /> : invitations.length === 0 ? (
          <EmptyState title="No invitations sent yet" description="Invite people from the People page when creating or editing them." />
        ) : (
          <Card>
            <Table columns={['Name', 'Email', 'Role', 'Status', 'Expires', { label: '' }]}>
              {invitations.map((inv) => (
                <tr key={inv.id} className="hover:bg-surface">
                  <td className="px-4 py-2.5 font-medium text-ink">{inv.name}</td>
                  <td className="px-4 py-2.5 text-muted">{inv.email}</td>
                  <td className="px-4 py-2.5"><Badge>{ROLE_LABELS[inv.role] || inv.role}</Badge></td>
                  <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge></td>
                  <td className="px-4 py-2.5 text-muted text-xs">{new Date(inv.expires_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    {inv.status === 'pending' && (
                      <div className="flex items-center gap-1 justify-end">
                        <Button size="sm" variant="secondary" onClick={() => act(inv.id, 'resend')} loading={busyId === inv.id}><Send size={13} /> Resend</Button>
                        <Button size="sm" variant="danger" onClick={() => act(inv.id, 'revoke')} loading={busyId === inv.id}><Ban size={13} /> Revoke</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
}
