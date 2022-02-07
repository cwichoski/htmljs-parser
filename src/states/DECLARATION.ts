import { CODE, StateDefinition } from "../internal";

// We enter STATE.DECLARATION after we encounter a "<?"
// while in the STATE.HTML_CONTENT.
// We leave STATE.DECLARATION if we see a "?>" or ">".
export const DECLARATION: StateDefinition = {
  name: "DECLARATION",

  eof(declaration) {
    this.notifyError(
      declaration,
      "MALFORMED_DECLARATION",
      "EOF reached while parsing declaration"
    );
  },

  enter() {
    this.endText();
    this.skip(1);
  },

  char(_, code, declaration) {
    if (code === CODE.QUESTION) {
      // TODO: we shouldn't need two checks here.
      if (this.lookAtCharCodeAhead(1) === CODE.CLOSE_ANGLE_BRACKET) {
        this.exitState("?>");
        this.notify("declaration", {
          pos: declaration.pos,
          endPos: declaration.endPos,
          value: {
            pos: declaration.pos + 2, // strip <?
            endPos: declaration.endPos - 2 // ?>
          }
        });
      }
    } else if (code === CODE.CLOSE_ANGLE_BRACKET) {
      this.exitState(">");
      this.notify("declaration", {
        pos: declaration.pos,
        endPos: declaration.endPos,
        value: {
          pos: declaration.pos + 2, // strip <?
          endPos: declaration.endPos - 1 // strip >
        }
      });
    }
  },
};
