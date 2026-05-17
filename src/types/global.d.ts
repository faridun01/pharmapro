/**
 * Global type definitions
 */

declare const __DEV__: boolean;

interface Window {
	pharmaproDesktop?: {
		platform?: string;
		startupStartedAt?: number | null;
		versions?: {
			chrome?: string;
			electron?: string;
			node?: string;
		};
		controls?: {
			minimize: () => void;
			toggleMaximize: () => void;
			close: () => void;
		};
		authHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
		saveDatabaseConfig?: (url: string) => Promise<{ success: boolean; error?: string }>;
		performBackup?: () => Promise<{ success: boolean; path?: string; error?: string }>;
		checkSystemStatus?: () => Promise<{
			pgDumpFound: boolean;
			pgDumpPath: string;
			diskDReady: boolean;
			backupDirReady: boolean;
			backupDirExists: boolean;
			backupDir: string;
		}>;
		markRuntime?: (name: string, details?: Record<string, unknown>) => void;
	};
	__pharmaproRuntimeMarks?: Record<string, boolean>;
}
