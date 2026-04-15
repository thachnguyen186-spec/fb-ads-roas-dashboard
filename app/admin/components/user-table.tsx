'use client';

import { useState } from 'react';
import type { ManagedUser, UserRole } from '@/lib/types';

interface Props {
  initialUsers: ManagedUser[];
}

const ROLES: UserRole[] = ['staff', 'leader', 'admin'];

const roleBadge: Record<UserRole, string> = {
  admin: 'bg-purple-900/60 text-purple-300',
  leader: 'bg-blue-900/60 text-blue-300',
  staff: 'bg-slate-700 text-slate-300',
};

export default function UserTable({ initialUsers }: Props) {
  const [users, setUsers] = useState<ManagedUser[]>(initialUsers);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('staff');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleRoleChange(userId: string, role: UserRole) {
    setUpdatingId(userId);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
    }
    setUpdatingId(null);
  }

  async function handleDelete(userId: string, email: string) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    setDeletingId(userId);
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== userId));
    setDeletingId(null);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg('');
    setInviteError('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    const data = await res.json();
    if (!res.ok) {
      setInviteError(data.error ?? 'Failed to create user');
    } else {
      setUsers((prev) => [...prev, data.user]);
      setInviteEmail('');
      setInviteMsg(`User ${data.user.email} created. Share login credentials securely.`);
    }
    setInviting(false);
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-4">
        <h3 className="font-medium text-slate-100">Add new user</h3>
        <form onSubmit={handleInvite} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="employee@company.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as UserRole)}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {inviting ? 'Creating…' : 'Create user'}
          </button>
        </form>
        {inviteMsg && <p className="text-sm text-emerald-400">{inviteMsg}</p>}
        {inviteError && <p className="text-sm text-red-400">{inviteError}</p>}
        <p className="text-xs text-slate-500">
          User is created without a password. Share a temporary login link or set a password via Supabase dashboard.
        </p>
      </div>

      {/* User list */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 border-b border-slate-700">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-400">Email</th>
              <th className="text-left px-4 py-3 font-medium text-slate-400">Role</th>
              <th className="text-left px-4 py-3 font-medium text-slate-400">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-800/50 transition-colors">
                <td className="px-4 py-3 text-slate-100">{u.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    disabled={updatingId === u.id}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                    className={`text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 ${roleBadge[u.role]}`}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleDelete(u.id, u.email)}
                    disabled={deletingId === u.id}
                    className="text-xs text-slate-600 hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    {deletingId === u.id ? '…' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500 text-sm">No users yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
