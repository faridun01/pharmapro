export type ReportRangePreset = 'month' | 'q1' | 'q2' | 'q3' | 'q4' | 'year' | 'all';
export type ReportTab = 'pl' | 'cashflow' | 'balance' | 'ar' | 'ap';

export type CompanyReportProfile = {
  pharmacyName: string;
  legalName: string;
  address: string;
  taxId: string;
  phone: string;
  email: string;
  directorName: string;
  chiefAccountantName: string;
  reportPreparedBy: string;
  logoDataUrl: string;
  approvalTitle: string;
  approvalRole: string;
  stampLabel: string;
};

export type ReportTemplate = {
  id: string;
  name: string;
  preset: ReportRangePreset;
  fromDate: string;
  toDate: string;
  activeTab: ReportTab;
  createdAt: string;
};

export type ReportUserPreferences = {
  lastPreset: ReportRangePreset;
  lastFromDate: string;
  lastToDate: string;
  lastActiveTab: ReportTab;
};

const COMPANY_KEY = 'pharmapro_company_report_profile';
const templateKey = (userId: string) => `pharmapro_report_templates_${userId}`;
const preferencesKey = (userId: string) => `pharmapro_report_preferences_${userId}`;

export const defaultCompanyReportProfile: CompanyReportProfile = {
  pharmacyName: 'Аптека PharmaPro',
  legalName: 'ООО PharmaPro',
  address: 'Dushanbe',
  taxId: '000000000',
  phone: '',
  email: '',
  directorName: 'Директор',
  chiefAccountantName: 'Главный бухгалтер',
  reportPreparedBy: 'Финансовый менеджер',
  logoDataUrl: '',
  approvalTitle: 'УТВЕРЖДАЮ',
  approvalRole: 'Директор',
  stampLabel: 'М.П.',
};

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const parseJson = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const getCompanyReportProfile = (): CompanyReportProfile => {
  if (!canUseStorage()) return defaultCompanyReportProfile;
  return {
    ...defaultCompanyReportProfile,
    ...parseJson<Partial<CompanyReportProfile>>(window.localStorage.getItem(COMPANY_KEY), {}),
  };
};

export const saveCompanyReportProfile = (profile: CompanyReportProfile) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(COMPANY_KEY, JSON.stringify(profile));
};

export const getReportTemplates = (userId: string): ReportTemplate[] => {
  if (!canUseStorage() || !userId) return [];
  return parseJson<ReportTemplate[]>(window.localStorage.getItem(templateKey(userId)), []);
};

export const saveReportTemplate = (userId: string, template: Omit<ReportTemplate, 'id' | 'createdAt'>) => {
  if (!canUseStorage() || !userId) return [] as ReportTemplate[];
  const templates = getReportTemplates(userId);
  const nextTemplate: ReportTemplate = {
    ...template,
    id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  const next = [nextTemplate, ...templates].slice(0, 12);
  window.localStorage.setItem(templateKey(userId), JSON.stringify(next));
  return next;
};

export const deleteReportTemplate = (userId: string, templateId: string) => {
  if (!canUseStorage() || !userId) return [] as ReportTemplate[];
  const next = getReportTemplates(userId).filter((item) => item.id !== templateId);
  window.localStorage.setItem(templateKey(userId), JSON.stringify(next));
  return next;
};

export const getReportUserPreferences = (userId: string): ReportUserPreferences | null => {
  if (!canUseStorage() || !userId) return null;
  return parseJson<ReportUserPreferences | null>(window.localStorage.getItem(preferencesKey(userId)), null);
};

export const saveReportUserPreferences = (userId: string, preferences: ReportUserPreferences) => {
  if (!canUseStorage() || !userId) return;
  window.localStorage.setItem(preferencesKey(userId), JSON.stringify(preferences));
};
