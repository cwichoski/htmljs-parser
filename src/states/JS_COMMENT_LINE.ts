import { checkForClosingTag } from ".";
import { CODE, STATE, StateDefinition } from "../internal";

// We enter STATE.JS_COMMENT_LINE after we encounter a "//" sequence
// when parsing JavaScript code.
// We leave STATE.JS_COMMENT_LINE when we see a newline character.
export const JS_COMMENT_LINE: StateDefinition = {
  name: "JS_COMMENT_LINE",

  enter() {
    this.skip(1); // skip /
  },

  eol() {
    this.exitState();
  },

  eof() {
    this.exitState();
  },

  char(_, code, comment) {
    if (comment.parentState === STATE.PARSED_TEXT_CONTENT) {
      if (!this.isConcise && code === CODE.OPEN_ANGLE_BRACKET) {
        // First, see if we need to see if we reached the closing tag
        // eg: <script>//foo</script>
        if (checkForClosingTag(this)) return;
      }
    }
  },
};
