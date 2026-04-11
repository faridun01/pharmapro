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
		markRuntime?: (name: string, details?: Record<string, unknown>) => void;
	};
	__pharmaproRuntimeMarks?: Record<string, boolean>;
}
