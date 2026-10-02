const { spawnSync } = require('child_process');
const path = require('path');

describe('evaluation harness', () => {
  test('npm run evaluate executes and reports mixed pass/fail in starter code', () => {
    const result = spawnSync(process.execPath, [path.join('scripts', 'evaluate.js')], {
      cwd: path.join(__dirname, '..', '..'),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', ENABLE_CACHE_HOOKS: '1' },
    });

    expect(result.stdout).toMatch(/PASS\s+Redis connection/);
    expect(result.stdout).toMatch(/FAIL/);
    expect(result.status).toBe(1);
  });
});
