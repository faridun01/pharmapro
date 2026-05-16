import { PharmacyProvider } from '../context';
import AuthenticatedShell from './AuthenticatedShell';

export default function AuthenticatedApp({ onSignedOut }: { onSignedOut: () => void }) {
  return (
    <PharmacyProvider>
      <AuthenticatedShell onSignedOut={onSignedOut} />
    </PharmacyProvider>
  );
}