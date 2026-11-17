import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TextProvider } from '../web/i18n';
import '../web/styles.css';
import './verifier.css';
import { VerifierApp } from './VerifierApp';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><TextProvider><VerifierApp /></TextProvider></StrictMode>);
