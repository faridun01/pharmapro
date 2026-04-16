import { PharmacyProvider } from '../context';
import AuthenticatedShell from './AuthenticatedShell';

export default function AuthenticatedApp({ 
  onSignedOut, 
  onClose 
}: { 
  onSignedOut: () => void;
  onClose?: () => void;
}) {
  return (
    <PharmacyProvider>
      <AuthenticatedShell onSignedOut={onSignedOut} onClose={onClose} />
    </PharmacyProvider>
  );
}