class Cancellable { constructor() { this.cancelled = false; } cancel() { this.cancelled = true; } }
const system = {call(name, path, iface, method, params, rt, flags, timeout, cancellable, callback) {
    globalThis.__log.push({method, value: params.value[0], hasCallback: !!callback});
    if (callback) globalThis.__pending.push(() => callback({call_finish() {
        if (globalThis.__fail) { const e = new Error('boom'); e.matches = () => false; throw e; } }}, {}));
}};
globalThis.__lock = false; globalThis.__transform = 1; globalThis.__applied = []; globalThis.__rotateFail = false;
const session = {call(name, path, iface, method, params, rt, flags, timeout, cancellable, callback) {
    if (method === 'GetCurrentState') {
        const state = [7,
            [[['eDP-1', 'v', 'p', 's'], [['m1', 2560, 2024, 60, 1, [1], {}], ['m2', 2560, 2024, 60, 1, [1], {'is-current': true}]], {}]],
            [[0, 0, 1, globalThis.__transform, true, [['eDP-1', 'v', 'p', 's']], {}]], {}];
        globalThis.__pending.push(() => callback({call_finish() {
            if (globalThis.__rotateFail) throw new Error('nope'); return {recursiveUnpack: () => state}; }}, {}));
    } else if (method === 'ApplyMonitorsConfig') {
        globalThis.__applied.push(params.value);
        globalThis.__transform = params.value[2][0][3];
        globalThis.__pending.push(() => callback({call_finish() {}}, {}));
    }
}};
class Settings { constructor(props) { this.props = props; }
    get_boolean() { return globalThis.__lock; } set_boolean(k, v) { globalThis.__lock = v; } }
const SettingsSchemaSource = {get_default: () => ({lookup: () => globalThis.__noOrientationSchema ? null : {}})};
export default {
    Settings, SettingsSchemaSource,
    File: {new_for_path() { return {
        query_exists() { return globalThis.__keyboardNode !== undefined; },
        load_contents() { return [true, new TextEncoder().encode(globalThis.__keyboardNode)]; }}; }},
    icon_new_for_string(p) { return p; }, Cancellable, DBus: {system, session}, DBusCallFlags: {NONE: 0}, IOErrorEnum: {CANCELLED: 19},
};
