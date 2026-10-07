class Cancellable { constructor() { this.cancelled = false; } cancel() { this.cancelled = true; } }
const system = {call(name, path, iface, method, params, rt, flags, timeout, cancellable, callback) {
    globalThis.__log.push({method, value: params.value[0], hasCallback: !!callback});
    if (callback) globalThis.__pending.push(() => callback({call_finish() {
        if (globalThis.__fail) { const e = new Error('boom'); e.matches = () => false; throw e; } }}, {}));
}};
export default {
    File: {new_for_path() { return {
        query_exists() { return globalThis.__keyboardNode !== undefined; },
        load_contents() { return [true, new TextEncoder().encode(globalThis.__keyboardNode)]; }}; }},
    icon_new_for_string(p) { return p; }, Cancellable, DBus: {system}, DBusCallFlags: {NONE: 0}, IOErrorEnum: {CANCELLED: 19},
};
