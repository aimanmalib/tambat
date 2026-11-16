import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TextProvider } from './i18n';
import './styles.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><TextProvider><App /></TextProvider></StrictMode>);
