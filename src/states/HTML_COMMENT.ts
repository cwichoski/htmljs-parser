import { CODE, StateDefinition, ExpressionPart } from "../internal";

// We enter STATE.HTML_COMMENT after we encounter a "<--"
// while in the STATE.HTML_CONTENT.
// We leave STATE.HTML_COMMENT when we see a "-->".
export const HTML_COMMENT: StateDefinition<ExpressionPart> = {
  name: "HTML_COMMENT",

  enter() {
    this.endText();
    this.skip(2); // skip --
  },

  exit(comment) {
    this.notify("comment", {
      pos: comment.pos,
      endPos: comment.endPos,
      value: {
        pos: comment.pos + 4, // strip <!--
        endPos: comment.endPos - 3 // strip -->
      }
    });
  },

  eof(comment) {
    this.notifyError(
      comment,
      "MALFORMED_COMMENT",
      "EOF reached while parsing comment"
    );
  },

  char(_, code) {
    if (code === CODE.HYPHEN) {
      let offset = 1;
      let next: number;
      while ((next = this.lookAtCharCodeAhead(offset)) === CODE.HYPHEN) offset++;

      if (next === CODE.CLOSE_ANGLE_BRACKET) {
        offset += 1;
        this.skip(offset);
        this.exitState();
      } else {
        this.skip(offset);
      }
    }
  },
};
