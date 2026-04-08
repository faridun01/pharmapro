import './lib/i18n';
import { PharmacyProvider } from './presentation/context';
import App from './App';

export default function AppRoot() {
  return (
    <PharmacyProvider>
      <App />
    </PharmacyProvider>
  );
}
