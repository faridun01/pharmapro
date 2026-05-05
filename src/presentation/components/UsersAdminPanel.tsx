import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  Pencil,
  UserX,
  UserCheck,
  X,
  Save,
  Shield,
  Eye,
  EyeOff,
  RefreshCw,
} from 'lucide-react';
import { buildApiHeaders } from '../../infrastructure/api';

type UserRole = 'OWNER' | 'ADMIN' | 'CASHIER' | 'PHARMACIST' | 'WAREHOUSE_STAFF';

type ManagedUser = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  warehouseId: string | null;
  warehouse: { id: string; name: string } | null;
  createdAt: string;
};

type Warehouse = { id: string; name: string };

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  CASHIER: 'Кассир',
  PHARMACIST: 'Фармацевт',
  WAREHOUSE_STAFF: 'Складской работник',
};

const ROLE_COLORS: Record<UserRole, string> = {
  OWNER: 'bg-purple-100 text-purple-700 border-purple-200',
  ADMIN: 'bg-blue-100 text-blue-700 border-blue-200',
  CASHIER: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  PHARMACIST: 'bg-amber-100 text-amber-700 border-amber-200',
  WAREHOUSE_STAFF: 'bg-slate-100 text-slate-700 border-slate-200',
};

type FormState = {
  name: string;
  username: string;
  password: string;
  role: UserRole;
  warehouseId: string;
};

const emptyForm = (): FormState => ({
  name: '',
  username: '',
  password: '',
  role: 'CASHIER',
  warehouseId: '',
});

type ModalMode = 'create' | 'edit';

type UsersAdminPanelProps = {
  currentUserRole: string;
};

export const UsersAdminPanel: React.FC<UsersAdminPanelProps> = ({ currentUserRole }) => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };
  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, warehousesRes] = await Promise.all([
        fetch('/api/system/users', { headers: await buildApiHeaders(false) }),
        fetch('/api/warehouses', { headers: await buildApiHeaders(false) }),
      ]);
      const usersData = await usersRes.json().catch(() => []);
      const warehousesData = await warehousesRes.json().catch(() => []);
      if (usersRes.ok) setUsers(Array.isArray(usersData) ? usersData : []);
      if (warehousesRes.ok) setWarehouses(Array.isArray(warehousesData) ? warehousesData : []);
    } catch {
      showError('Не удалось загрузить пользователей');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setModalMode('create');
    setForm(emptyForm());
    setShowPassword(false);
    setEditingUser(null);
    setShowModal(true);
  };

  const openEdit = (u: ManagedUser) => {
    setModalMode('edit');
    setForm({
      name: u.name,
      username: u.username ?? '',
      password: '',
      role: u.role,
      warehouseId: u.warehouseId ?? '',
    });
    setShowPassword(false);
    setEditingUser(u);
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditingUser(null); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const trimmedName = form.name.trim();
      const payload: Record<string, any> = {
        name: trimmedName,
        username: form.username,
        role: form.role,
        warehouseId: form.warehouseId || null,
      };

      if (modalMode === 'create') {
        payload.password = form.password;
      } else if (form.password) {
        payload.password = form.password;
      }

      const url = modalMode === 'create' ? '/api/system/users' : `/api/system/users/${editingUser!.id}`;
      const method = modalMode === 'create' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: await buildApiHeaders(),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Ошибка при сохранении');

      showNotice(modalMode === 'create' ? 'Пользователь создан' : 'Данные обновлены');
      closeModal();
      void load();
    } catch (e: any) {
      showError(e?.message || 'Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (u: ManagedUser) => {
    try {
      if (u.isActive) {
        // Deactivate
        const res = await fetch(`/api/system/users/${u.id}`, {
          method: 'DELETE',
          headers: await buildApiHeaders(),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Ошибка деактивации');
        showNotice(`${u.name} деактивирован`);
      } else {
        // Reactivate
        const res = await fetch(`/api/system/users/${u.id}`, {
          method: 'PUT',
          headers: await buildApiHeaders(),
          body: JSON.stringify({ isActive: true }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Ошибка активации');
        showNotice(`${u.name} активирован`);
      }
      void load();
    } catch (e: any) {
      showError(e?.message || 'Ошибка');
    }
  };

  const canEditUser = (u: ManagedUser) => {
    if (u.role === 'OWNER' && currentUserRole !== 'OWNER') return false;
    return true;
  };

  const availableRoles: UserRole[] = currentUserRole === 'OWNER'
    ? ['OWNER', 'ADMIN', 'CASHIER', 'PHARMACIST', 'WAREHOUSE_STAFF']
    : ['ADMIN', 'CASHIER', 'PHARMACIST', 'WAREHOUSE_STAFF'];

  const activeCount = users.filter(u => u.isActive).length;
  const inactiveCount = users.filter(u => !u.isActive).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-[#5A5A40]">
          <div className="w-10 h-10 rounded-2xl bg-[#f5f5f0] flex items-center justify-center">
            <Users size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold">Управление пользователями</h3>
            <p className="text-xs text-[#5A5A40]/55">
              {activeCount} активных · {inactiveCount} деактивированных
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="p-2 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40]/60 hover:bg-[#f5f5f0] transition-colors"
            title="Обновить"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#5A5A40] text-white rounded-xl text-sm font-bold hover:bg-[#4a4a30] transition-colors shadow-sm"
          >
            <UserPlus size={16} />
            Добавить пользователя
          </button>
        </div>
      </div>

      {/* Notice / Error */}
      {(notice || error) && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
          {error || notice}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#5A5A40]/10 overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#5A5A40]/50 text-sm">
            Загрузка...
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-[#5A5A40]/50 gap-3">
            <Users size={40} className="opacity-30" />
            <p className="text-sm">Пользователи не найдены</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#5A5A40]/8 bg-[#f5f5f0]/50">
                <th className="text-left px-5 py-3 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Пользователь</th>
                <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Роль</th>
                <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Склад</th>
                <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Последний вход</th>
                <th className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Статус</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#5A5A40]/5">
              {users.map((u) => (
                <tr key={u.id} className={`hover:bg-[#f5f5f0]/40 transition-colors ${!u.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#5A5A40]/8 flex items-center justify-center text-[#5A5A40] font-bold text-sm shrink-0">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-[#151619] truncate">{u.name}</p>
                        <p className="text-xs text-[#5A5A40]/40 truncate">@{u.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${ROLE_COLORS[u.role]}`}>
                      <Shield size={11} />
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-[#5A5A40]/70 text-xs">
                    {u.warehouse?.name ?? <span className="text-[#5A5A40]/30">—</span>}
                  </td>
                  <td className="px-4 py-4 text-[#5A5A40]/60 text-xs">
                    {new Date(u.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border ${u.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                      {u.isActive ? <UserCheck size={11} /> : <UserX size={11} />}
                      {u.isActive ? 'Активен' : 'Деактивирован'}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center justify-end gap-2">
                      {canEditUser(u) && (
                        <>
                          <button
                            onClick={() => openEdit(u)}
                            className="p-2 rounded-lg hover:bg-[#f5f5f0] text-[#5A5A40]/60 hover:text-[#5A5A40] transition-colors border border-transparent hover:border-[#5A5A40]/10"
                            title="Редактировать"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => void handleToggleActive(u)}
                            className={`p-2 rounded-lg transition-colors border border-transparent ${u.isActive ? 'hover:bg-red-50 text-[#5A5A40]/50 hover:text-red-600 hover:border-red-100' : 'hover:bg-emerald-50 text-[#5A5A40]/50 hover:text-emerald-600 hover:border-emerald-100'}`}
                            title={u.isActive ? 'Деактивировать' : 'Активировать'}
                          >
                            {u.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[#5A5A40]/10">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#5A5A40]/8">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#5A5A40]/8 flex items-center justify-center text-[#5A5A40]">
                  <UserPlus size={18} />
                </div>
                <h4 className="text-base font-bold text-[#151619]">
                  {modalMode === 'create' ? 'Новый пользователь' : `Редактировать: ${editingUser?.name}`}
                </h4>
              </div>
              <button onClick={closeModal} className="p-2 rounded-xl hover:bg-[#f5f5f0] text-[#5A5A40]/60 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-1.5">Полное имя *</label>
                <input
                  className="w-full px-4 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                  placeholder="Иванов Иван"
                  value={form.name}
                  onChange={e => setForm(s => ({ ...s, name: e.target.value }))}
                />
              </div>



              {/* Username */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-1.5">Логин *</label>
                <input
                  className="w-full px-4 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                  placeholder="ivanov"
                  value={form.username}
                  onChange={e => setForm(s => ({ ...s, username: e.target.value }))}
                />
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-1.5">Роль *</label>
                <select
                  className="w-full px-4 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                  value={form.role}
                  onChange={e => setForm(s => ({ ...s, role: e.target.value as UserRole }))}
                >
                  {availableRoles.map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>

              {/* Warehouse (optional) */}
              {warehouses.length > 0 && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-1.5">Склад (необязательно)</label>
                  <select
                    className="w-full px-4 py-2.5 border border-[#5A5A40]/15 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                    value={form.warehouseId}
                    onChange={e => setForm(s => ({ ...s, warehouseId: e.target.value }))}
                  >
                    <option value="">— без привязки —</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Password */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#5A5A40]/50 mb-1.5">
                  {modalMode === 'create' ? 'Пароль *' : 'Новый пароль (оставьте пустым, чтобы не менять)'}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="w-full px-4 py-2.5 pr-10 border border-[#5A5A40]/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                    placeholder={modalMode === 'create' ? 'Минимум 6 символов' : 'Новый пароль...'}
                    value={form.password}
                    onChange={e => setForm(s => ({ ...s, password: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5A5A40]/40 hover:text-[#5A5A40]"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2.5 rounded-xl border border-[#5A5A40]/15 text-[#5A5A40] text-sm font-semibold hover:bg-[#f5f5f0] transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#5A5A40] text-white rounded-xl text-sm font-bold hover:bg-[#4a4a30] disabled:opacity-50 transition-colors"
              >
                <Save size={15} />
                {saving ? 'Сохранение...' : modalMode === 'create' ? 'Создать' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
