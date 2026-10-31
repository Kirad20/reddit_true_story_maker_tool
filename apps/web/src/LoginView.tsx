import { useState, type FormEvent } from "react";
import { authClient } from "./auth";

export function LoginView({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.status === 401 ? "Correo o contraseña incorrectos" : (error.message ?? "No se pudo iniciar sesión"));
    else onSignedIn();
  }

  return (
    <div className="login">
      <form className="panel form login-card" onSubmit={submit}>
        <div className="brand">
          <span className="logo">▶</span> TrueStory<b>Maker</b>
        </div>
        <h2>Iniciar sesión</h2>
        <label className="field">
          <span>Correo</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <p className="hint">
          ¿Primera vez? Entra con el usuario temporal que aparece en los logs del servidor (<code>[auth] TEMPORARY SETUP USER</code>) y crea
          tu cuenta de administrador en <b>Usuarios</b>. El usuario temporal se borra en cuanto lo haces.
        </p>
        <p className="legal-links small muted">
          <a href="/terms">Términos del servicio</a> · <a href="/privacy">Política de privacidad</a>
        </p>
      </form>
    </div>
  );
}
