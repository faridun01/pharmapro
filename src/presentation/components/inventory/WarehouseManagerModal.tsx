import React, { useEffect, useState } from 'react';
import { Building2, Plus, CheckCircle2, AlertCircle, Edit2, Trash2 } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '../../../infrastructure/api';
import { AppModal } from '../AppModal';

type Warehouse = {
  id: string;
  code: string;
  name: string;
  type?: string;
  address?: string;
  description?: string;
  isDefault: boolean;
  isActive: boolean;
};

interface WarehouseManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WarehouseManagerModal: React.FC<WarehouseManagerModalProps> = ({ isOpen, onClose }) => {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('RETAIL');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadWarehouses = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiGet<Warehouse[]>('/api/warehouses?includeInactive=true');
      setWarehouses(data || []);
    } catch (err: any) {
      setError(err?.message || 'Ошибка загрузки списка складов');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadWarehouses();
    }
  }, [isOpen]);

  const resetForm = () => {
    setEditingId(null);
    setCode('');
    setName('');
    setType('RETAIL');
    setAddress('');
    setDescription('');
    setIsDefault(false);
  };

  const handleEdit = (w: Warehouse) => {
    setEditingId(w.id);
    setCode(w.code);
    setName(w.name);
    setType(w.type || 'RETAIL');
    setAddress(w.address || '');
    setDescription(w.description || '');
    setIsDefault(w.isDefault);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      setError('Заполните код и наименование склада');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const payload = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        type,
        address: address.trim() || null,
        description: description.trim() || null,
        isDefault,
      };

      if (editingId) {
        await apiPut(`/api/warehouses/${editingId}`, payload);
      } else {
        await apiPost('/api/warehouses', payload);
      }

      resetForm();
      await loadWarehouses();
    } catch (err: any) {
      setError(err?.message || 'Ошибка при сохранении склада');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!window.confirm('Вы действительно хотите деактивировать этот склад?')) return;
    try {
      setError(null);
      await apiDelete(`/api/warehouses/${id}`);
      await loadWarehouses();
    } catch (err: any) {
      setError(err?.message || 'Ошибка при деактивации склада');
    }
  };

  return (
    <AppModal isOpen={isOpen} onClose={onClose} title="Управление аптеками и складами">
      <div className="space-y-6">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Warehouse List */}
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {loading ? (
            <div className="text-center text-xs text-gray-400 py-4">Загрузка складов...</div>
          ) : warehouses.length === 0 ? (
            <div className="text-center text-xs text-gray-400 py-4">Склады не найдены</div>
          ) : (
            warehouses.map((w) => (
              <div
                key={w.id}
                className={`flex items-center justify-between p-3 rounded-xl border text-xs transition-all ${
                  w.isDefault
                    ? 'bg-[#5A5A40]/5 border-[#5A5A40]/30'
                    : 'bg-white border-gray-200'
                } ${!w.isActive ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <Building2 size={20} className={w.isDefault ? 'text-[#5A5A40]' : 'text-gray-400'} />
                  <div>
                    <div className="font-semibold text-gray-900 flex items-center gap-2">
                      <span>{w.name}</span>
                      <span className="text-[10px] text-gray-500 font-mono">[{w.code}]</span>
                      {w.isDefault && (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold bg-[#5A5A40] text-white rounded">
                          По умолчанию
                        </span>
                      )}
                    </div>
                    {w.address && <div className="text-gray-500 text-[11px] mt-0.5">{w.address}</div>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEdit(w)}
                    className="p-1.5 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
                    title="Редактировать"
                  >
                    <Edit2 size={14} />
                  </button>
                  {!w.isDefault && w.isActive && (
                    <button
                      onClick={() => handleDeactivate(w.id)}
                      className="p-1.5 text-red-500 hover:text-red-700 rounded-lg hover:bg-red-50"
                      title="Деактивировать"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Create/Edit Form */}
        <form onSubmit={handleSubmit} className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-4">
          <div className="text-xs font-bold text-gray-700 uppercase tracking-wider">
            {editingId ? 'Редактировать склад' : 'Добавить новый склад'}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Код склада</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="MAIN, PHARM-1..."
                className="w-full p-2 text-xs bg-white border border-gray-200 rounded-lg"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Наименование</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Центральная Аптека..."
                className="w-full p-2 text-xs bg-white border border-gray-200 rounded-lg"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Тип склада</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full p-2 text-xs bg-white border border-gray-200 rounded-lg"
              >
                <option value="RETAIL">Розница (Аптека)</option>
                <option value="WHOLESALE">Оптовый склад</option>
                <option value="STORAGE">Хранение</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Адрес</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="ул. Главная, 10"
                className="w-full p-2 text-xs bg-white border border-gray-200 rounded-lg"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="rounded text-[#5A5A40] focus:ring-[#5A5A40]"
            />
            <label htmlFor="isDefault" className="text-xs text-gray-700 font-medium cursor-pointer">
              Сделать складом по умолчанию
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-1.5 text-xs text-gray-600 hover:underline"
              >
                Отмена
              </button>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 bg-[#5A5A40] text-white text-xs font-semibold rounded-lg hover:bg-[#4a4a34] disabled:opacity-50"
            >
              {submitting ? 'Сохранение...' : editingId ? 'Обновить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </AppModal>
  );
};
