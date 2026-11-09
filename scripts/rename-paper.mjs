#!/usr/bin/env node
// Una tantum: rinomina l'app in "Paper" nei file di configurazione delle build.
// (Questi file contengono anche le tue chiavi/nomi dei repo, quindi li modifica
// in modo mirato invece di sovrascriverli.)  Uso:  node scripts/rename-paper.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const NAME = 'Paper';

const confPath = 'src-tauri/tauri.conf.json';
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
conf.productName = NAME;
for (const w of conf.app?.windows ?? []) w.title = NAME;
// L'identificatore NON cambia: così login e impostazioni restano e gli aggiornamenti funzionano.
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');

const ebPath = 'electron-builder.yml';
const eb = readFileSync(ebPath, 'utf8')
  .replace(/^productName: .*$/m, `productName: ${NAME}`)
  .replace(/^copyright: .*$/m, `copyright: ${NAME}`)
  .replace(/^(\s*)maintainer: .*$/m, `$1maintainer: ${NAME}`)
  .replace(/^(\s*)synopsis: .*$/m, `$1synopsis: Chat e vocale privati`)
  .replace(/^(\s*)artifactName: .*$/m, `$1artifactName: ${NAME}-\${version}-\${arch}.\${ext}`);
writeFileSync(ebPath, eb);

const pkgPath = 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.author && typeof pkg.author === 'object') pkg.author.name = NAME;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`Fatto: l'app ora si chiama ${NAME}. Controlla con "git diff" e fai commit.`);
