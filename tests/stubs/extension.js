export class Extension { constructor() { this.uuid = 'bottom-half-blocker@local'; this.path = '/ext'; }
    getSettings(id) { return {id}; } }

export class InjectionManager {
    constructor() { this._saved = []; }
    overrideMethod(prototype, name, factory) {
        const original = prototype[name];
        prototype[name] = factory(original);
        this._saved.push([prototype, name, original]);
    }
    clear() {
        for (const [prototype, name, original] of this._saved.reverse())
            prototype[name] = original;
        this._saved = [];
    }
}
