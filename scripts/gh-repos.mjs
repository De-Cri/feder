// Repo names: code (remote "origin") and releases (public, from electron-builder.yml).
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

export function releasesRepo() {
  const yml = readFileSync('electron-builder.yml', 'utf8');
  const owner = yml.match(/^\s*owner:\s*(\S+)/m)?.[1];
  const repo = yml.match(/^\s*repo:\s*(\S+)/m)?.[1];
  if (!owner || !repo || owner === 'OWNER') throw new Error('Repo delle release non configurato in electron-builder.yml');
  return `${owner}/${repo}`;
}

export function codeRepo() {
  const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(\.git)?$/);
  if (!m) throw new Error(`Remote origin non riconosciuto: ${url}`);
  return m[1];
}
