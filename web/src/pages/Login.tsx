import { useState, type FormEvent } from 'react';
import { api, type Me } from '../api';
import { Alert, Mark } from './shared';

export function Login({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(username, password));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="box">
        <div className="brand">
          <span className="mark">
            <Mark />
          </span>
          <h1>g-seekr</h1>
        </div>
        <form onSubmit={submit}>
          <h2>Sign in with your Jellyfin account</h2>
          <p className="hint">The same username and password you watch with.</p>
          <label className="field">
            Username
            <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            Password
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <Alert kind="error">{error}</Alert>}
          <button type="submit" className="btn primary" disabled={busy || !username.trim()}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
