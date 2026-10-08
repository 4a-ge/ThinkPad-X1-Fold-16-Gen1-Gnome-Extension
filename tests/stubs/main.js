export const panel = {addToStatusArea(uuid, b) { globalThis.__button = b; }};
import {MonitorConstraint} from './layout.js';
import {SwitcherPopup} from './switcherPopup.js';
const mon = {index: 0, x: 0, y: 0, width: 2048, height: 2560};
export const layoutManager = {focusIndex: 0, overviewGroup: {children: []},primaryMonitor: mon, monitors: [mon], chrome: [],
    connect() { return 1; }, disconnect() {}, addChrome(w) { this.chrome.push(w); },
    removeChrome(w) { this.chrome = this.chrome.filter(x => x !== w); },
    modalDialogGroup: {dialogs: [], connect(n, f) { this.onAdd = f; return 6; }, disconnect() {}, get_children() { return this.dialogs; }}};
export const wm = {kb: [], addKeybinding(n, s, f, m, cb) { if (globalThis.__noSchema) throw new Error('no schema'); if (globalThis.__refuse) return 0; this.kb.push({n, cb}); return 7; },
    removeKeybinding(n) { this.kb = this.kb.filter(k => k.n !== n); }};
const sigs = () => ({connect() { return 7; }, disconnect() {}});
export const overview = {_overview: {controls: {margin_bottom: 0, relayouts: 0, queue_relayout() { this.relayouts++; }}}, ...sigs()};
export const sessionMode = {...sigs()};
// props: the MonitorConstraint to create, or null for an actor without one
class Box { constructor(props = {primary: true}) { this.constraints = []; this.relayouts = 0; this.children = []; this.parent = null;
    if (props) this.add_constraint(new MonitorConstraint(props)); }
get_children() { return this.children; } get_parent() { return this.parent; }
add_child(c) { c.parent = this; this.children.push(c); return c; }
get_constraints() { return this.constraints; }
add_constraint(c) { this.constraints.push(c); c.actor = this; c.setActor?.(this); }
remove_constraint(c) { this.constraints = this.constraints.filter(x => x !== c); } queue_relayout() { this.relayouts++; }
connect(n, f) { this.onDestroy = f; return 1; } }
export const screenShield = {_lockDialogGroup: new Box(null)};
export const makeDialog = () => { const d = new Box(null); d.box = new Box(); d.add_child(d.box);
    screenShield._lockDialogGroup.add_child(d); return d; };
globalThis.global = {backend: {get_monitor_manager: () => ({get_monitor_for_connector: c => c === 'eDP-1' ? 0 : -1})}};

export const makeModal = index => { const d = new Box(null); d._backgroundBin = new Box({index}); d.add_child(d._backgroundBin);
    layoutManager.modalDialogGroup.add_child(d); return d; };

export const uiGroup = new Box(null);
layoutManager.modalDialogGroup = new Box(null);
uiGroup.add_child(layoutManager.modalDialogGroup);
uiGroup.add_child(screenShield._lockDialogGroup);

export const osdWindowManager = {_osdWindows: [Object.assign(new Box({index: 0}), {_monitorIndex: 0})], shown: [],
    showOne(...args) { this.shown.push(args); }};
osdWindowManager._osdWindows.forEach(w => uiGroup.add_child(w));

// the screenshot UI: a widget holding a primary-monitor bin and a bin per monitor
export const makeScreenshotUI = () => { const ui = new Box(null);
    ui.primaryBin = ui.add_child(new Box({primary: true})); ui.monitorBin = ui.add_child(new Box({index: 0}));
    uiGroup.add_child(ui); return ui; };

// every constrained actor is shrunk, also nested ones; work-area and overview ones are left alone
export const makeNested = () => { const outer = new Box({primary: true}); outer.inner = outer.add_child(new Box({primary: true}));
    const work = new Box({primary: true, work_area: true});
    const inOverview = new Box({primary: true}); layoutManager.overviewGroup.children.push(inOverview); inOverview.parent = layoutManager.overviewGroup;
    uiGroup.add_child(outer); uiGroup.add_child(work); return {outer, work, inOverview}; };

export const makeSwitcher = () => { const p = new SwitcherPopup(); p.show(); return p; };
