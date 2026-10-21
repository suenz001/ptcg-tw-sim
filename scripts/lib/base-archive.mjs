// 測試用BASE封存：不經shell解析Windows路徑；任何讀取、解壓或連結失敗都向上拋出。
import { execFileSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
export function extractBaseArchive(root, sha, paths, destination) {
  const bytes = execFileSync('git', ['-C', root, 'archive', '--format=tar', sha, '--', ...paths],
    { maxBuffer: 128 * 1024 * 1024, windowsHide: true });
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-x', '-C', destination], { input: bytes, maxBuffer: 128 * 1024 * 1024, windowsHide: true });
}
export function linkBaseModules(root, destination) {
  symlinkSync(resolve(root, 'node_modules'), join(destination, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
}
