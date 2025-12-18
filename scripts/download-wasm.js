const fs = require('fs');
const path = require('path');
const https = require('https');

const TARGET_DIR = path.join(__dirname, '../resources/tree-sitter');
const BASE_URL = 'https://unpkg.com/tree-sitter-wasms@0.1.11/out/';

const LANGUAGES = [
  'tree-sitter-typescript.wasm',
  'tree-sitter-tsx.wasm',
  'tree-sitter-javascript.wasm',
  'tree-sitter-python.wasm',
  'tree-sitter-go.wasm',
  'tree-sitter-rust.wasm',
  'tree-sitter-java.wasm',
  'tree-sitter-cpp.wasm',
  'tree-sitter-c.wasm',
  'tree-sitter-c_sharp.wasm',
  'tree-sitter-ruby.wasm',
  'tree-sitter-php.wasm',
  'tree-sitter-json.wasm',
];

if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

// Copy tree-sitter.wasm from node_modules if possible
// Note: web-tree-sitter v0.26+ renamed it to web-tree-sitter.wasm
const webTreeSitterDir = path.dirname(require.resolve('web-tree-sitter'));
const possibleWasmNames = ['web-tree-sitter.wasm', 'tree-sitter.wasm'];
const destTreeSitterWasm = path.join(TARGET_DIR, 'tree-sitter.wasm');

let copied = false;
for (const wasmName of possibleWasmNames) {
  const wasmPath = path.join(webTreeSitterDir, wasmName);
  try {
    if (fs.existsSync(wasmPath)) {
      fs.copyFileSync(wasmPath, destTreeSitterWasm);
      console.log(`Copied ${wasmName} from ${wasmPath} to tree-sitter.wasm`);
      copied = true;
      break;
    }
  } catch (e) {
    console.error(`Error copying ${wasmName}:`, e);
  }
}

if (!copied) {
  console.warn('Could not find web-tree-sitter.wasm or tree-sitter.wasm in node_modules');
}

function download(filename) {
  const url = BASE_URL + filename;
  const dest = path.join(TARGET_DIR, filename);

  if (fs.existsSync(dest)) {
    console.log(`Skipping ${filename} (already exists)`);
    return;
  }

  console.log(`Downloading ${filename}...`);
  const file = fs.createWriteStream(dest);

  https.get(url, (response) => {
    if (response.statusCode !== 200) {
      console.error(`Failed to download ${filename}: ${response.statusCode}`);
      file.close();
      fs.unlinkSync(dest);
      return;
    }
    
    response.pipe(file);

    file.on('finish', () => {
      file.close();
      console.log(`Downloaded ${filename}`);
    });
  }).on('error', (err) => {
    fs.unlinkSync(dest);
    console.error(`Error downloading ${filename}:`, err.message);
  });
}

LANGUAGES.forEach(download);
