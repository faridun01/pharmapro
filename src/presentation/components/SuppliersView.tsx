import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePharmacy } from '../context';
import { useDebounce } from '../../lib/useDebounce';
import { Search, Plus, Truck, Phone, Mail, MapPin, Edit3, Trash2, Package, DollarSign, X } from 'lucide-react';

function authHeaders() {
  const token = localStorage.getItem('pharmapro_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

type SupplierForm = {
  name: string;
  contact: string;
  email: string;
  address: string;
};

const INITIAL_FORM: SupplierForm = {
  name: '',
  contact: '',
  email: '',
  address: '',
};

export const SuppliersView: React.FC = () => {
  const { t } = useTranslation();
  const { suppliers, refreshSuppliers } = usePharmacy();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<SupplierForm>(INITIAL_FORM);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const filteredSuppliers = suppliers.filter((s) =>
    s.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
    (s.email || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()),
  );

  const openAdd = () => {
    setForm(INITIAL_FORM);
    setEditingSupplierId(null);
    setError('');
    setIsAddOpen(true);
  };

  const openEdit = (supplier: typeof suppliers[number]) => {
    setForm({
      name: supplier.name || '',
      contact: supplier.contact || '',
      email: supplier.email || '',
      address: supplier.address || '',
    });
    setEditingSupplierId(supplier.id);
    setError('');
    setIsAddOpen(true);
  };

  const saveSupplier = async () => {
    if (!form.name.trim()) {
      setError(t('Supplier name is required'));
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(editingSupplierId ? `/api/suppliers/${editingSupplierId}` : '/api/suppliers', {
        method: editingSupplierId ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: form.name.trim(),
          contact: form.contact.trim() || null,
          email: form.email.trim() || null,
          address: form.address.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || t('Failed to save supplier'));
      }
      await refreshSuppliers(true);
      setIsAddOpen(false);
      setEditingSupplierId(null);
    } catch (e: any) {
      setError(e.message || t('Failed to save supplier'));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteSupplier = async (supplierId: string, supplierName: string) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/suppliers/${supplierId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || t('Failed to delete supplier'));
      }
      await refreshSuppliers(true);
    } catch (e: any) {
      setError(e.message || t('Failed to delete supplier'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="rounded-[30px] border border-white/70 bg-white/80 p-4 shadow-[0_18px_45px_rgba(90,90,64,0.08)] backdrop-blur-md md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-[#f1eee3] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/55">
              Поставщиков: {filteredSuppliers.length}
            </span>
            <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#5A5A40]/45 border border-[#5A5A40]/10">
              Контакты и закупки
            </span>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40]/30" size={18} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('Search suppliers...')}
                className="w-full min-w-0 pl-12 pr-4 py-3 bg-white border border-[#5A5A40]/10 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#5A5A40]/20 shadow-sm sm:w-72"
              />
            </div>
            <button onClick={openAdd} className="bg-[#5A5A40] text-white px-6 py-3 rounded-2xl font-medium shadow-lg hover:bg-[#4A4A30] transition-all flex items-center gap-2">
              <Plus size={20} />
              {t('Add Supplier')}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredSuppliers.map((supplier) => (
          <div key={supplier.id} className="bg-white p-6 rounded-3xl shadow-sm border border-[#5A5A40]/5 hover:-translate-y-1 hover:shadow-xl transition-all group">
            <div className="flex justify-between items-start mb-6">
              <div className="w-14 h-14 bg-[#f5f5f0] rounded-2xl flex items-center justify-center text-[#5A5A40] group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
                <Truck size={28} />
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEdit(supplier)}
                  disabled={submitting}
                  className="p-2 text-[#5A5A40]/30 hover:text-[#5A5A40] hover:bg-[#f5f5f0] rounded-xl transition-all disabled:opacity-50"
                  title={t('Edit Supplier')}
                >
                  <Edit3 size={18} />
                </button>
                <button
                  onClick={() => setDeleteTarget({ id: supplier.id, name: supplier.name })}
                  disabled={submitting}
                  className="p-2 text-[#5A5A40]/30 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all disabled:opacity-50"
                  title={t('Delete Supplier')}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>

            <h3 className="text-lg font-bold text-[#5A5A40] mb-4">{supplier.name}</h3>

            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-3 text-sm text-[#5A5A40]/60">
                <Phone size={16} className="text-[#5A5A40]/30" />
                <span>{supplier.contact || '—'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-[#5A5A40]/60">
                <Mail size={16} className="text-[#5A5A40]/30" />
                <span className="truncate">{supplier.email || '—'}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-[#5A5A40]/60">
                <MapPin size={16} className="text-[#5A5A40]/30" />
                <span className="truncate">{supplier.address || '—'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-6 border-t border-[#5A5A40]/5">
              <div className="bg-[#f5f5f0]/50 p-3 rounded-2xl">
                <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest mb-1">{t('Products')}</p>
                <div className="flex items-center gap-2 text-[#5A5A40]">
                  <Package size={14} />
                  <span className="text-sm font-bold">{t('Linked')}</span>
                </div>
              </div>
              <div className="bg-[#f5f5f0]/50 p-3 rounded-2xl">
                <p className="text-[10px] font-bold text-[#5A5A40]/40 uppercase tracking-widest mb-1">{t('Status')}</p>
                <div className="flex items-center gap-2 text-[#5A5A40]">
                  <DollarSign size={14} />
                  <span className="text-sm font-bold">{t('Active')}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-[#5A5A40]/10">
              <h3 className="text-xl font-bold text-[#5A5A40]">{editingSupplierId ? t('Edit Supplier') : t('Add Supplier')}</h3>
            </div>
            <div className="p-6 space-y-4">
              <input className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Name')} value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
              <input className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Contact')} value={form.contact} onChange={(e) => setForm((s) => ({ ...s, contact: e.target.value }))} />
              <input className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl" placeholder="Email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
              <input className="w-full px-4 py-3 border border-[#5A5A40]/10 rounded-xl" placeholder={t('Address')} value={form.address} onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))} />
              {error && <p className="text-red-500 text-sm">{error}</p>}
            </div>
            <div className="p-6 border-t border-[#5A5A40]/10 flex justify-end gap-3">
              <button onClick={() => { setIsAddOpen(false); setEditingSupplierId(null); }} className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl">{t('Cancel')}</button>
              <button onClick={saveSupplier} disabled={submitting} className="px-5 py-2.5 bg-[#5A5A40] text-white rounded-xl disabled:opacity-50">
                {submitting ? t('Saving...') : (editingSupplierId ? t('Update Supplier') : t('Save Supplier'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-[#5A5A40]/10">
            <div className="p-5 bg-red-600 text-white flex items-center justify-between">
              <h3 className="text-lg font-bold">{t('Delete Supplier')}</h3>
              <button onClick={() => setDeleteTarget(null)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-[#5A5A40]/80">
                {t('Delete supplier')}: <span className="font-semibold">{deleteTarget.name}</span>?
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-5 py-2.5 border border-[#5A5A40]/20 rounded-xl">
                  {t('Cancel')}
                </button>
                <button
                  onClick={async () => {
                    const target = deleteTarget;
                    if (!target) return;
                    await deleteSupplier(target.id, target.name);
                    setDeleteTarget(null);
                  }}
                  disabled={submitting}
                  className="px-5 py-2.5 bg-red-600 text-white rounded-xl disabled:opacity-50"
                >
                  {submitting ? t('Deleting...') : t('Delete Supplier')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
