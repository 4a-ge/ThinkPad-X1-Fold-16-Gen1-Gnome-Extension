import {register} from 'node:module';
globalThis.__log = []; globalThis.__pending = []; globalThis.__gestures = []; globalThis.__fail = false;
globalThis.__keyboardNode = undefined; globalThis.__warns = [];
console.warn = (...a) => globalThis.__warns.push(a.join(' '));
register('./loader.mjs', import.meta.url);
