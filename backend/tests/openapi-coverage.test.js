import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import app from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.resolve(here, '../src/docs/openapi.json'), 'utf8'));
const yamlSpec = YAML.parse(fs.readFileSync(path.resolve(here, '../../docs/openapi.yaml'), 'utf8'));

// Walks Express's real router stack: this is what is actually served, not what we hope is served
function registeredRoutes() {
  const out = new Set();
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          out.add(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
        }
      } else if (layer.name === 'router' && layer.handle.stack) {
        const mount = layer.regexp.source
          .replace('\\/?(?=\\/|$)', '')
          .replace(/^\^/, '')
          .replace(/\\\//g, '/');
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk(app._router.stack, '');
  return [...out]
    .filter((r) => r.split(' ')[1].startsWith('/api/v1'))
    .map((r) => {
      const [method, p] = r.split(' ');
      const normalised = p
        .replace('/api/v1', '')
        .replace(/\/+$/, '')
        .replace(/:([A-Za-z]+)/g, '{$1}');
      return `${method} ${normalised || '/'}`;
    })
    .sort();
}

function documentedOperations() {
  const ops = [];
  for (const [p, methods] of Object.entries(spec.paths)) {
    for (const m of Object.keys(methods)) ops.push(`${m.toUpperCase()} ${p}`);
  }
  return ops.sort();
}

describe('OpenAPI spec matches the real API', () => {
  it('every registered route is documented', () => {
    const documented = new Set(documentedOperations());
    const missing = registeredRoutes().filter((r) => !documented.has(r));
    expect(missing).toEqual([]);
  });

  it('nothing is documented that does not exist', () => {
    const registered = new Set(registeredRoutes());
    const phantom = documentedOperations().filter((r) => !registered.has(r));
    expect(phantom).toEqual([]);
  });

  it('docs/openapi.yaml is in sync with the JSON source (run: npm run docs:openapi)', () => {
    expect(yamlSpec).toEqual(spec);
  });

  it('every protected operation declares auth and the shared error responses', () => {
    for (const [p, methods] of Object.entries(spec.paths)) {
      for (const [m, op] of Object.entries(methods)) {
        const isPublic = p === '/health' || p === '/auth/login';
        if (!isPublic) {
          expect(op.security, `${m} ${p} security`).toBeTruthy();
          expect(op.responses['401'], `${m} ${p} 401`).toBeTruthy();
        }
        expect(op.tags?.length, `${m} ${p} tag`).toBeGreaterThan(0);
        expect(op.summary, `${m} ${p} summary`).toBeTruthy();
      }
    }
  });

  it('every state-changing booking/billing POST requires the Idempotency-Key header in the spec', () => {
    const idem = ['POST /appointments', 'POST /billing/invoices', 'POST /billing/invoices/{id}/payments'];
    for (const key of idem) {
      const [m, p] = key.split(' ');
      const params = spec.paths[p][m.toLowerCase()].parameters || [];
      expect(params.some((x) => x.$ref === '#/components/parameters/IdempotencyKey'), key).toBe(true);
    }
  });
});
