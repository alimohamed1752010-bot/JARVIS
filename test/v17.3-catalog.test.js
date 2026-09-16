const test=require('node:test');
const assert=require('node:assert/strict');
const catalog=require('../src/core/pcCatalog');

test('V17.3 catalog contains broad web and app coverage',()=>{
  assert.ok(Object.keys(catalog.WEB_ALIASES).length >= 150);
  assert.ok(catalog.KNOWN_APPS.length >= 200);
  for (const [name,url] of Object.entries(catalog.WEB_ALIASES)) assert.match(url,/^https?:\/\//,name);
});
