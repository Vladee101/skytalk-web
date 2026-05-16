import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Landing() {
  const { token, login } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) navigate('/tutor/dashboard', { replace: true });
  }, [token, navigate]);

  async function submit() {
    if (!password || loading) return;
    setLoading(true);
    setError('');
    const result = await login(password);
    setLoading(false);
    if (result.ok) {
      navigate('/tutor/dashboard', { replace: true });
    } else {
      setError(result.message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-80 space-y-4">
        <h1 className="text-center text-2xl font-semibold text-white">SkyTalk</h1>
        <p className="text-center text-sm text-gray-400">Tutor login</p>

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          disabled={loading}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-500 focus:border-sky-500 focus:outline-none disabled:opacity-50"
        />

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!password || loading}
          className="w-full rounded bg-green-500 py-2 text-sm font-medium text-black hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
