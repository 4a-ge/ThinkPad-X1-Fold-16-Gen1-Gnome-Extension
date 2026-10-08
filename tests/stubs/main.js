export const panel = {addToStatusArea(uuid, b) { globalThis.__button = b; }};
const mon = {index: 0, x: 0, y: 0, width: 2048, height: 2560};
export const layoutManager = {primaryMonitor: mon, monitors: [mon], chrome: [],
    connect() { return 1; }, disconnect() {}, addChrome(w) { this.chrome.push(w); },
    removeChrome(w) { this.chrome = this.chrome.filter(x => x !== w); },
    modalDialogGroup: {dialogs: [], connect(n, f) { this.onAdd = f; return 6; }, disconnect() {}, get_children() { return this.dialogs; }}};
export const wm = {kb: [], addKeybinding(n, s, f, m, cb) { if (globalThis.__noSchema) throw new Error('no schema'); if (globalThis.__refuse) return 0; this.kb.push({n, cb}); return 7; },
    removeKeybinding(n) { this.kb = this.kb.filter(k => k.n !== n); }};
const sigs = () => ({connect() { return 7; }, disconnect() {}});
export const overview = {_overview: {controls: {margin_bottom: 0, relayouts: 0, queue_relayout() { this.relayouts++; }}}, ...sigs()};
export const sessionMode = {...sigs()};
class Box { constructor() { this.constraints = [{monitor: true}]; this.relayouts = 0; }
    get_constraints() { return this.constraints; } add_constraint(c) { c.actor = this; this.constraints.push(c); }
    remove_constraint(c) { this.constraints = this.constraints.filter(x => x !== c); } queue_relayout() { this.relayouts++; }
    connect(n, f) { this.onDestroy = f; return 1; } }
const dialog = {get_last_child() { return dialog.box; }, box: null};
export const screenShield = {_lockDialogGroup: {dialogs: [], connect(n, f) { this.onAdd = f; return 5; }, disconnect() {},
    get_children() { return this.dialogs; }}};
export const makeDialog = () => { const d = {box: new Box(), get_last_child() { return this.box; }}; screenShield._lockDialogGroup.dialogs.push(d); screenShield._lockDialogGroup.onAdd(); return d; };
globalThis.global = {backend: {get_monitor_manager: () => ({get_monitor_for_connector: c => c === 'eDP-1' ? 0 : -1})}};

export const makeModal = index => { const d = {_backgroundBin: new Box(), _monitorConstraint: {index}, get_last_child() { return null; }};
    layoutManager.modalDialogGroup.dialogs.push(d); layoutManager.modalDialogGroup.onAdd(); return d; };

export const uiGroup = {kids: [], add_child(c) { this.kids.push(c); }, remove_child(c) { this.kids = this.kids.filter(k => k !== c); }};

export const osdWindowManager = {_osdWindows: [Object.assign(new Box(), {_monitorIndex: 0})], shown: [],
    showOne(...args) { this.shown.push(args); }};
