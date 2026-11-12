import { useCallback, useEffect, useState } from 'react';
import { api, type AdminUser, type Me } from '../api';
import { when } from './shared';

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
    <section>
      <h2>Users</h2>
      <p className="muted small">People appear here after their first sign-in. Jellyfin admins are admins here too unless that’s switched off in the config.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Admin</th>
              <th>Auto-approve</th>
              <th>Limit</th>
              <th>Used</th>
              <th>Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.username}
                  {u.jellyfinAdmin && <span className="muted small"> (Jellyfin admin)</span>}
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${u.username} is an admin`}
                    checked={u.isAdmin}
                    disabled={u.id === me.user.id}
                    onChange={(e) => update(u, { isAdmin: e.target.checked })}
                  />
                  {!u.isAdmin && u.effectiveAdmin && <span className="muted small"> via Jellyfin</span>}
                </td>
                <td>
                  <input type="checkbox" aria-label={`Auto-approve ${u.username}`} checked={u.autoApprove} onChange={(e) => update(u, { autoApprove: e.target.checked })} />
                </td>
                <td>
                  <input
                    className="limit"
                    type="number"
                    min={0}
                    max={1000}
                    placeholder="default"
                    aria-label={`Request limit for ${u.username}`}
                    defaultValue={u.requestLimit ?? ''}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === '' ? null : Number(raw);
                      if (next !== u.requestLimit) void update(u, { requestLimit: next });
                    }}
                  />
                </td>
                <td>{u.limits.limit === 0 ? `${u.limits.used} (no limit)` : `${u.limits.used} / ${u.limits.limit}`}</td>
                <td>{when(u.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
