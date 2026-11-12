import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';

// Real network round trips: allow findBy* more than the 1s default
configure({ asyncUtilTimeout: 6000 });

// Animations finish instantly so tests never wait on them
MotionGlobalConfig.skipAnimations = true;

// jsdom gaps the app (or its libraries) touch
if (!window.matchMedia) {
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  localStorage.clear();
});
