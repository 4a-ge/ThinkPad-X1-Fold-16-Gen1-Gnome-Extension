class Icon { constructor(p) { this.gicon = p.gicon; } }
class Widget { set_size(w, h) { this.size = [w, h]; } set_position(x, y) { this.pos = [x, y]; } connect() { return 1; } disconnect() {} destroy() { this.destroyed = true; } show() {} hide() {} }
class Label { constructor(p) { this.text = p.text; } }
class BoxLayout { constructor(p) { this.children = []; this.pos = null; } add_child(c) { this.children.push(c); }
    get_preferred_width() { return [0, 200]; } set_position(x, y) { this.pos = [x, y]; } destroy() { this.destroyed = true; } }
export default {Icon, Widget, Label, BoxLayout};
