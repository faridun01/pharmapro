import path from 'path';
import { promises as fs } from 'fs';

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

type ReportSettingsState = {
  companyProfile: CompanyReportProfile;
  userTemplates: Record<string, ReportTemplate[]>;
  userPreferences: Record<string, ReportUserPreferences>;
};

const storageDir = path.join(process.cwd(), 'data');
const storagePath = path.join(storageDir, 'report-settings.json');

const defaultState: ReportSettingsState = {
  companyProfile: {
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
  },
  userTemplates: {},
  userPreferences: {},
};

const normalizePreset = (value: unknown): ReportRangePreset => {
  switch (String(value || '').toLowerCase()) {
    case 'year':
      return 'year';
    case 'all':
      return 'all';
    case 'q1':
      return 'q1';
    case 'q2':
      return 'q2';
    case 'q3':
      return 'q3';
    case 'q4':
      return 'q4';
    case '7d':
    case '30d':
    case '90d':
    case 'month':
    default:
      return 'month';
  }
};

const normalizeTemplate = (template: Partial<ReportTemplate>): ReportTemplate => ({
  id: String(template.id || `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
  name: String(template.name || 'Шаблон отчета'),
  preset: normalizePreset(template.preset),
  fromDate: String(template.fromDate || ''),
  toDate: String(template.toDate || ''),
  activeTab: (['pl', 'cashflow', 'balance', 'ar', 'ap'].includes(String(template.activeTab)) ? template.activeTab : 'pl') as ReportTab,
  createdAt: String(template.createdAt || new Date().toISOString()),
});

const normalizeUserPreferences = (preferences: Partial<ReportUserPreferences>): ReportUserPreferences => ({
  lastPreset: normalizePreset(preferences.lastPreset),
  lastFromDate: String(preferences.lastFromDate || ''),
  lastToDate: String(preferences.lastToDate || ''),
  lastActiveTab: (['pl', 'cashflow', 'balance', 'ar', 'ap'].includes(String(preferences.lastActiveTab)) ? preferences.lastActiveTab : 'pl') as ReportTab,
});

async function ensureStorage() {
  await fs.mkdir(storageDir, { recursive: true });
  try {
    await fs.access(storagePath);
  } catch {
    await fs.writeFile(storagePath, JSON.stringify(defaultState, null, 2), 'utf8');
  }
}

export async function readReportSettings() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(storagePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ReportSettingsState>;
    return {
      companyProfile: { ...defaultState.companyProfile, ...(parsed.companyProfile || {}) },
      userTemplates: Object.fromEntries(
        Object.entries(parsed.userTemplates || {}).map(([userId, templates]) => [
          userId,
          Array.isArray(templates) ? templates.map((template) => normalizeTemplate(template)) : [],
        ]),
      ),
      userPreferences: Object.fromEntries(
        Object.entries(parsed.userPreferences || {}).map(([userId, preferences]) => [
          userId,
          normalizeUserPreferences((preferences || {}) as Partial<ReportUserPreferences>),
        ]),
      ),
    } satisfies ReportSettingsState;
  } catch {
    return { ...defaultState };
  }
}

export async function writeReportSettings(state: ReportSettingsState) {
  await ensureStorage();
  await fs.writeFile(storagePath, JSON.stringify(state, null, 2), 'utf8');
}
