import { Fragment, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import AppRoot from './AppRoot';
import { markRuntimeOnce } from './lib/runtimeMarks';

markRuntimeOnce('renderer-entry');

const RootWrapper = __DEV__ ? Fragment : StrictMode;

createRoot(document.getElementById('root')!).render(
  <RootWrapper>
    <AppRoot />
  </RootWrapper>,
);
