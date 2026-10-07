class ClickGesture { constructor() { this.handlers = {}; globalThis.__gestures.push(this); } connect(n, f) { this.handlers[n] = f; } }
class Constraint { constructor(...a) { this._init(...a); } _init() {} get_actor() { return this.actor; } }
export default {ActorAlign: {CENTER: 'center'}, Orientation: {HORIZONTAL: 0}, ClickGesture, Constraint};
