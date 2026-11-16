import { useCallback, useEffect, useState } from 'react';
import { api, type AdminUser, type Me } from '../api';
import { ago, Alert, Avatar, Toggle, when } from './shared';

export function AdminUsers({ me }: { me: Me }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers((await api.users()).users);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (u: AdminUser, patch: Parameters<typeof api.updateUser>[1]) => {
    setError(null);
    try {
      const { user } = await api.updateUser(u.id, patch);
      setUsers((prev) => prev?.map((x) => (x.id === user.id ? user : x)) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <div className="page-title">
        <h1>Users</h1>
      </div>
      <Alert kind="info">People appear here after their first sign-in with Jellyfin. Jellyfin admins are admins here too, unless that’s switched off in the config.</Alert>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Admin</th>
              <th>Auto-approve</th>
              <th>Request limit</th>
              <th>Requests used</th>
              <th>Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="user">
                    <Avatar name={u.username} />
                    <span>
                      {u.username}
                      <small>{u.effectiveAdmin ? (u.jellyfinAdmin && !u.isAdmin ? 'Admin via Jellyfin' : 'Admin') : 'User'}</small>
                    </span>
                  </span>
                </td>
                <td>
                  <Toggle label={`${u.username} is an admin`} checked={u.isAdmin} disabled={u.id === me.user.id} onChange={(v) => update(u, { isAdmin: v })} />
                </td>
                <td>
                  <Toggle label={`Auto-approve ${u.username}`} checked={u.autoApprove} onChange={(v) => update(u, { autoApprove: v })} />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={1000}
                    placeholder="Default"
                    aria-label={`Request limit for ${u.username}`}
                    defaultValue={u.requestLimit ?? ''}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === '' ? null : Number(raw);
                      if (next !== u.requestLimit) void update(u, { requestLimit: next });
                    }}
                  />
                </td>
                <td>{u.limits.limit === 0 ? `${u.limits.used} (no limit)` : `${u.limits.used} of ${u.limits.limit} in ${u.limits.days} days`}</td>
                <td title={when(u.lastLoginAt)}>{ago(u.lastLoginAt) || 'Never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
