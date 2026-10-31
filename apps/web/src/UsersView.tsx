import { useCallback, useEffect, useState, type FormEvent } from "react";
import { authClient, isAdmin, type AppUser } from "./auth";

type Role = "admin" | "user";
const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", user: "Usuario" };

const message = (error: { message?: string } | null | undefined) => error?.message ?? "Algo salió mal";

export function UsersView({ me, onSelfRemoved }: { me: AppUser; onSelfRemoved: () => void }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: (me.temporary ? "admin" : "user") as Role });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await authClient.admin.listUsers({ query: { limit: 500, sortBy: "createdAt", sortDirection: "asc" } });
    if (error) setError(message(error));
    else setUsers(data.users as AppUser[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<{ error: { message?: string } | null }>, done?: string) {
    setError(null);
    setNote(null);
    const { error } = await action();
    if (error) setError(message(error));
    else if (done) setNote(done);
    await load();
    return !error;
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await run(
      () => authClient.admin.createUser({ name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role }),
      `Usuario ${form.email.trim()} creado.`,
    );
    setBusy(false);
    if (!ok) return;
    setForm({ name: "", email: "", password: "", role: "user" });
    // Creating a real admin deletes the temporary setup user, and with it this session.
    if (me.temporary && form.role === "admin") {
      alert(`Listo: ${form.email.trim()} es administrador. El usuario temporal se borró; inicia sesión con tu nueva cuenta.`);
      onSelfRemoved();
    }
  }

  async function setPassword(user: AppUser) {
    const newPassword = prompt(`Nueva contraseña para ${user.email} (mínimo 8 caracteres):`);
    if (!newPassword) return;
    await run(() => authClient.admin.setUserPassword({ userId: user.id, newPassword }), `Contraseña de ${user.email} actualizada.`);
  }

  async function remove(user: AppUser) {
    if (!confirm(`¿Borrar a ${user.email}? Perderá el acceso de inmediato.`)) return;
    await run(() => authClient.admin.removeUser({ userId: user.id }), `${user.email} borrado.`);
  }

  const admins = users.filter((u) => isAdmin(u) && !u.banned).length;

  return (
    <div className="settings">
      {me.temporary && (
        <p className="warn-box">
          Estás usando el <b>usuario temporal</b> de instalación. Crea tu propia cuenta con rol <b>Administrador</b>: en cuanto exista, el
          usuario temporal se borrará automáticamente y tendrás que entrar con tu cuenta nueva.
        </p>
      )}

      <section className="panel">
        <h2>Nuevo usuario</h2>
        <form className="grid3" onSubmit={create}>
          <label className="field">
            <span>Nombre</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="field">
            <span>Correo</span>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>Rol</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>&nbsp;</span>
            <button className="primary" disabled={busy}>
              {busy ? "Creando…" : "Crear usuario"}
            </button>
          </div>
        </form>
        <p className="hint">Los administradores gestionan usuarios; los usuarios normales usan la app pero no ven esta sección.</p>
      </section>

      <section className="panel">
        <h2>Usuarios</h2>
        {error && <p className="error">{error}</p>}
        {note && <p className="note">{note}</p>}
        <ul className="users">
          {users.map((u) => {
            const self = u.id === me.id;
            const lastAdmin = isAdmin(u) && admins <= 1;
            return (
              <li key={u.id} className="user-row">
                <div className="account-body">
                  <strong>{u.name}</strong> <span className="muted small">{u.email}</span>
                  <div className="card-head">
                    {u.temporary && <span className="badge candidate">Temporal</span>}
                    {u.banned && <span className="badge failed">Bloqueado</span>}
                    {self && <span className="badge">Tú</span>}
                    <span className="small muted">Alta: {new Date(u.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <select
                  value={isAdmin(u) ? "admin" : "user"}
                  disabled={self || u.temporary === true || lastAdmin}
                  title={lastAdmin ? "Debe quedar al menos un administrador" : undefined}
                  onChange={(e) => run(() => authClient.admin.setRole({ userId: u.id, role: e.target.value as Role }), `Rol de ${u.email} actualizado.`)}
                >
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <div className="actions">
                  <button className="ghost" onClick={() => setPassword(u)} disabled={u.temporary === true}>
                    Contraseña
                  </button>
                  {u.banned ? (
                    <button className="ghost" onClick={() => run(() => authClient.admin.unbanUser({ userId: u.id }), `${u.email} desbloqueado.`)}>
                      Desbloquear
                    </button>
                  ) : (
                    <button
                      className="ghost"
                      disabled={self || lastAdmin}
                      onClick={() => run(() => authClient.admin.banUser({ userId: u.id }), `${u.email} bloqueado; sus sesiones se cerraron.`)}
                    >
                      Bloquear
                    </button>
                  )}
                  <button className="ghost danger" disabled={self || lastAdmin} onClick={() => remove(u)}>
                    Borrar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
