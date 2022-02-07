import { CODE, STATE, StateDefinition } from "../internal";


export const TEMPLATE_STRING: StateDefinition = {
  name: "TEMPLATE_STRING",

  return(_, childPart) {
    if ((childPart as STATE.ExpressionPart).pos === (childPart as STATE.ExpressionPart).endPos) {
      this.notifyError(
        childPart,
        "PLACEHOLDER_EXPRESSION_REQUIRED",
        "Invalid placeholder, the expression cannot be missing"
      );
    }

    this.skip(1);
  },

  eof() {
    this.notifyError(
      this.pos,
      "INVALID_TEMPLATE_STRING",
      "EOF reached while parsing template string expression"
    );
  },

  char(_, code) {
    if (
      code === CODE.DOLLAR &&
      this.lookAtCharCodeAhead(1) === CODE.OPEN_CURLY_BRACE
    ) {
      this.skip(1);
      this.enterState(STATE.EXPRESSION, {
        skipOperators: true,
        terminator: "}",
      });
    } else {
      if (code === CODE.BACK_SLASH) {
        this.skip(1);
      } else if (code === CODE.BACKTICK) {
        this.exitState("`");
      }
    }
  },
};
