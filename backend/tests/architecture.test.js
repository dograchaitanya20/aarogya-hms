import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listJsFiles(full) : entry.name.endsWith('.js') ? [full] : [];
  });
}

const rel = (f) => path.relative(srcDir, f);

// AGENTS.md: routes -> controllers -> services -> repositories. SQL lives ONLY in repositories.
describe('Architecture guards', () => {
  const upperLayers = ['routes', 'controllers', 'services', 'middleware']
    .flatMap((d) => listJsFiles(path.join(srcDir, d)));

  it('no route, controller, service or middleware touches the database layer directly', () => {
    const offenders = upperLayers.filter((f) => /from '\.\.\/config\/db\.js'/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('no raw SQL statements outside repositories', () => {
    const sql = /\b(SELECT\s.+\sFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/s;
    const offenders = upperLayers.filter((f) => {
      const code = fs
        .readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return sql.test(code);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('no hardcoded secrets or fallback credentials in source', () => {
    const offenders = listJsFiles(srcDir).filter((f) =>
      /(JWT_SECRET|COOKIE_SECRET)\s*\|\|\s*['"`]|dev-jwt|dev-cookie|password\s*[:=]\s*['"][^'"]{6,}['"]/i.test(
        fs.readFileSync(f, 'utf8')
      )
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('routes never leak implementation details: no console.log in source (structured logger only)', () => {
    const offenders = listJsFiles(srcDir).filter((f) => /\bconsole\.(log|error|warn)\(/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map(rel)).toEqual([]);
  });
});
