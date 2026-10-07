export class Button { constructor() { this.children = []; this.actions = []; }
    add_child(c) { this.children.push(c); } add_action(a) { this.actions.push(a); } destroy() { this.destroyed = true; } }
