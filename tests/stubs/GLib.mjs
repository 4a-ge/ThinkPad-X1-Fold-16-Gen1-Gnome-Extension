class Variant { constructor(sig, value) { this.sig = sig; this.value = value; } }
globalThis.__timers = {};
export default {Variant, PRIORITY_DEFAULT: 0, SOURCE_CONTINUE: true, SOURCE_REMOVE: false,
    timeout_add_seconds(p, s, f) { globalThis.__timers[s] = f; return s; },
    timeout_add(p, ms, f) { globalThis.__timers['ms' + ms] = f; return 'ms' + ms; },
    idle_add(p, f) { globalThis.__idle = f; return 99; },
    PRIORITY_DEFAULT_IDLE: 200,
    Source: {remove(id) { if (id === 99) globalThis.__idle = null; else delete globalThis.__timers[id]; }}};
