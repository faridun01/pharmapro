import './lib/i18n';
import App from './App';

window.pharmaproDesktop?.markRuntime?.('app-root-module-evaluated', {
  ts: Date.now(),
});

export default function AppRoot() {
  return <App />;
}
