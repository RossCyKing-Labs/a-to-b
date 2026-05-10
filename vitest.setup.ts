import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

/*
  jsdom 25 ships a File / Blob implementation whose slice() result is missing
  arrayBuffer(). Node 20+ has a fully-spec'd File in node:buffer that handles
  slicing correctly. Swap jsdom's globals for Node's so our magic-byte tests
  (and any future File-based logic) work the same way they do in browsers.
*/
globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob;
globalThis.File = NodeFile as unknown as typeof globalThis.File;

// Auto-cleanup the DOM after each test so cases don't pollute each other.
afterEach(() => {
  cleanup();
});
