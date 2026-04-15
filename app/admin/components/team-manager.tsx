'use client';

import { useState } from 'react';
import type { ManagedUser } from '@/lib/types';

interface Assignment {
  leader_id: string;
  staff_id: string;
}

interface Props {
  users: ManagedUser[];
  initialAssignments: Assignment[];
}

export default function TeamManager({ users, initialAssignments }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>(initialAssignments);
  const [selectedLeaderId, setSelectedLeaderId] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const leaders = users.filter((u) => u.role === 'leader' || u.role === 'admin');
  const staff = users.filter((u) => u.role === 'staff');

  const selectedLeader = leaders.find((l) => l.id === selectedLeaderId);
  const leaderStaffIds = new Set(
    assignments.filter((a) => a.leader_id === selectedLeaderId).map((a) => a.staff_id),
  );

  async function toggleAssignment(staffId: string, currentlyAssigned: boolean) {
    setSaving(staffId);
    const method = currentlyAssigned ? 'DELETE' : 'POST';
    const res = await fetch('/api/admin/team', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leaderId: selectedLeaderId, staffId }),
    });
    if (res.ok) {
      setAssignments((prev) =>
        currentlyAssigned
          ? prev.filter((a) => !(a.leader_id === selectedLeaderId && a.staff_id === staffId))
          : [...prev, { leader_id: selectedLeaderId, staff_id: staffId }],
      );
    }
    setSaving(null);
  }

  const leaderSummary = leaders.map((l) => ({
    leader: l,
    staffMembers: staff.filter((s) =>
      assignments.some((a) => a.leader_id === l.id && a.staff_id === s.id),
    ),
  }));

  return (
    <div className="space-y-6">
      {/* Team overview */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h3 className="font-medium text-slate-900">Team overview</h3>
        {leaderSummary.length === 0 && (
          <p className="text-sm text-slate-400">No leaders found. Assign the leader role to users first.</p>
        )}
        {leaderSummary.map(({ leader, staffMembers }) => (
          <div key={leader.id} className="flex items-start gap-3">
            <div className="flex-shrink-0 text-sm font-medium text-indigo-600 w-40 truncate">{leader.email}</div>
            <div className="flex flex-wrap gap-1.5">
              {staffMembers.length === 0 ? (
                <span className="text-xs text-slate-400 italic">No staff assigned</span>
              ) : (
                staffMembers.map((s) => (
                  <span key={s.id} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                    {s.email}
                  </span>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Assignment editor */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h3 className="font-medium text-slate-900">Assign staff to leader</h3>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Select leader</label>
          <select
            value={selectedLeaderId}
            onChange={(e) => setSelectedLeaderId(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full max-w-sm"
          >
            <option value="">— pick a leader —</option>
            {leaders.map((l) => (
              <option key={l.id} value={l.id}>{l.email} ({l.role})</option>
            ))}
          </select>
        </div>

        {selectedLeader && (
          <div>
            <p className="text-xs text-slate-500 mb-2">
              Check which staff members belong to <strong className="text-slate-800">{selectedLeader.email}</strong>:
            </p>
            {staff.length === 0 && (
              <p className="text-sm text-slate-400 italic">No staff users found.</p>
            )}
            <ul className="space-y-2">
              {staff.map((s) => {
                const assigned = leaderStaffIds.has(s.id);
                const isSaving = saving === s.id;
                return (
                  <li key={s.id} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id={`staff-${s.id}`}
                      checked={assigned}
                      disabled={isSaving}
                      onChange={() => toggleAssignment(s.id, assigned)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 bg-white"
                    />
                    <label htmlFor={`staff-${s.id}`} className="text-sm text-slate-900 cursor-pointer select-none">
                      {s.email}
                    </label>
                    {isSaving && <span className="text-xs text-slate-400">saving…</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
