import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const jsonPath = path.join(rootDir, 'backend/src/docs/openapi.json');
const yamlPath = path.join(rootDir, 'docs/openapi.yaml');

console.log('[OpenAPI] Validating and syncing OpenAPI specification...');

if (!fs.existsSync(jsonPath)) {
  console.error(`[OpenAPI Error] Source JSON spec not found at: ${jsonPath}`);
  process.exit(1);
}

try {
  const jsonContent = fs.readFileSync(jsonPath, 'utf8');
  const doc = JSON.parse(jsonContent);

  // Structural sanity check
  if (!doc.openapi || !doc.info || !doc.paths) {
    throw new Error("Missing required root OpenAPI fields ('openapi', 'info', 'paths')");
  }

  // Convert to YAML
  const yamlString = YAML.stringify(doc);
  fs.writeFileSync(yamlPath, yamlString, 'utf8');

  // Verify YAML is parseable
  const parsedBack = YAML.parse(yamlString);
  if (!parsedBack.openapi) {
    throw new Error('Failed to verify parsed YAML structure.');
  }

  console.log(`[OpenAPI] Successfully verified and written: ${yamlPath}`);
  console.log(`[OpenAPI] API Version: ${doc.info.version}, Endpoints: ${Object.keys(doc.paths).length}`);
  process.exit(0);
} catch (err) {
  console.error('[OpenAPI Validation Error]:', err.message);
  process.exit(1);
}
