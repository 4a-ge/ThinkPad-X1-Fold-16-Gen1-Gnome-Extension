// A MonitorConstraint like the shell's: created through _init (patched by the
// extension) and told about its actor through notify::actor.
export class MonitorConstraint {
    constructor(props = {}) { this._init(props); }
    _init(props) {
        this.handlers = {};
        Object.assign(this, {primary: false, index: -1, focus_monitor: false, work_area: false}, props);
    }
    get_actor() { return this.actor; }
    connect(name, f) { this.handlers[name] = f; return name; }
    disconnect(id) { delete this.handlers[id]; }
    setActor(actor) { this.actor = actor; this.handlers['notify::actor']?.(); }
}
