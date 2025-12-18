
try {
  const pLimit = require('p-limit');
  console.log('p-limit loaded successfully');
} catch (e) {
  console.error('Failed to load p-limit:', e);
}

try {
  const Parser = require('web-tree-sitter');
  console.log('web-tree-sitter loaded successfully');
} catch (e) {
  console.error('Failed to load web-tree-sitter:', e);
}
