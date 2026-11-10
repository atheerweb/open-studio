import assert from 'node:assert/strict';
import test from 'node:test';
import { classHighlighter, highlightTree } from '@lezer/highlight';

test('the source editor resolves real syntax highlighting for project files', async () => {
  const {sourceLanguage} = await import('../src/source-language.mjs');
  const examples = [
    ['src/App.vue','<template><h1>Hi</h1></template>','h1'],
    ['artisan','<?php echo "Hello";','echo'],
    ['src/main.MJS','export const count = 42;','export'],
    ['src/types.ts','export type Name = string;','type'],
    ['package.json','{"private": true}','true'],
    ['Dockerfile.dev','FROM node:24','FROM'],
    ['settings.yml','enabled: true','enabled'],
    ['.env.example','APP_ENV=local','APP_ENV']
  ];
  for (const [file,source,token] of examples) {
    const support = await sourceLanguage(file);
    assert.ok(support,file);
    const highlighted = [];
    highlightTree(support.language.parser.parse(source),classHighlighter,(from,to) => highlighted.push(source.slice(from,to)));
    assert.ok(highlighted.includes(token),`${file}: expected to highlight ${token}, got ${highlighted.join(', ')}`);
  }
  assert.equal(await sourceLanguage('notes.unknown-format'),undefined);
});
