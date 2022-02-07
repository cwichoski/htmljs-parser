import {
  STATE,
  CODE,
  isWhitespaceCode,
  Part,
  StateDefinition,
} from "../internal";

const enum ATTR_STATE {
  NAME,
  VALUE,
  ARGUMENT,
  BLOCK,
}

export interface AttrPart extends Part {
  state: undefined | ATTR_STATE;
  name: undefined | Part;
  value: undefined | Part;
  argument: undefined | Part;
  default: boolean;
  spread: boolean;
  method: boolean;
  bound: boolean;
}

// We enter STATE.ATTRIBUTE when we see a non-whitespace
// character after reading the tag name
export const ATTRIBUTE: StateDefinition<AttrPart> = {
  name: "ATTRIBUTE",

  enter(attr) {
    this.currentAttribute = attr;
    attr.state = undefined;
    attr.name = undefined;
    attr.value = undefined;
    attr.bound = false;
    attr.method = false;
    attr.spread = false;
    attr.default = !this.currentOpenTag!.hasAttributes;

    if (attr.argument) {
      attr.pos = attr.argument.pos - 1 // include (
    } else {
      attr.argument = undefined;
    }
  },

  exit(attr) {
    this.currentAttribute = undefined;

    if (attr.spread) {
      this.notify("spreadAttr", {
        pos: attr.pos,
        endPos: attr.endPos,
        value: {
          pos: attr.value!.pos,
          endPos: attr.value!.endPos
        }
      })
    } else {
      // TODO: actually emit these as we parse.
      if (attr.name) {
        this.notify("attrName", {
          pos: attr.name.pos,
          endPos: attr.name.endPos,
          default: attr.default,
        });
      } else {
        this.notify("attrName", {
          pos: attr.pos,
          endPos: attr.pos,
          default: attr.default,
        });
      }

      if (attr.value || attr.argument) {
        this.notify("attrValue", {
          pos: attr.pos,
          endPos: attr.endPos,
          bound: attr.bound,
          method: attr.method,
          argument: attr.argument && {
            pos: attr.argument.pos - 1, // include (
            endPos: attr.argument.endPos + 1, // include )
            value: {
              pos: attr.argument.pos,
              endPos: attr.argument.endPos
            }
          },
          value: attr.value && {
            pos: attr.value.pos,
            endPos: attr.value.endPos
          },
        });
      }
    }
  },

  eol() {
    if (this.isConcise) {
      this.exitState();
    }
  },

  eof(attr) {
    if (this.isConcise) {
      this.exitState();
    } else {
      this.notifyError(
        attr,
        "MALFORMED_OPEN_TAG",
        'EOF reached while parsing attribute "' +
          attr.name +
          '" for the "' +
          this.read(this.currentOpenTag!.tagName) +
          '" tag'
      );
    }
  },

  return(_, childPart, attr) {
    switch (attr.state) {
      case ATTR_STATE.NAME: {
        attr.name = childPart;
        attr.default = false;
        break;
      }
      case ATTR_STATE.ARGUMENT: {
        if (attr.argument) {
          this.notifyError(
            childPart,
            "ILLEGAL_ATTRIBUTE_ARGUMENT",
            "An attribute can only have one set of arguments"
          );
          return;
        }

        attr.argument = childPart;
        this.skip(1); // ignore trailing )
        break;
      }
      case ATTR_STATE.BLOCK: {
        attr.method = true;
        attr.value = childPart;
        this.skip(1); // ignore trailing }
        this.exitState();
        break;
      }

      case ATTR_STATE.VALUE: {
        if (childPart.pos === childPart.endPos) {
          return this.notifyError(
            childPart,
            "ILLEGAL_ATTRIBUTE_VALUE",
            "Missing value for attribute"
          );
        }

        attr.value = childPart;
        this.exitState();
        break;
      }
    }
  },

  char(_, code, attr) {
    if (isWhitespaceCode(code)) {
      return;
    } else if (
      code === CODE.EQUAL ||
      (code === CODE.COLON && this.lookAtCharCodeAhead(1) === CODE.EQUAL) ||
      (code === CODE.PERIOD && this.lookAheadFor(".."))
    ) {
      if (code === CODE.PERIOD) {
        attr.spread = true;
        this.skip(2);
      } else if (code === CODE.COLON) {
        attr.bound = true;
        this.skip(1);
        this.consumeWhitespace();
      } else {
        this.consumeWhitespace();
      }

      attr.state = ATTR_STATE.VALUE;
      this.enterState(STATE.EXPRESSION, {
        terminatedByWhitespace: true,
        terminator: [
          this.isConcise ? "]" : "/>",
          this.isConcise ? ";" : ">",
          ",",
        ],
      });
    } else if (code === CODE.OPEN_PAREN) {
      attr.state = ATTR_STATE.ARGUMENT;
      this.enterState(STATE.EXPRESSION, {
        terminator: ")",
        skipOperators: true
      });
    } else if (
      code === CODE.OPEN_CURLY_BRACE &&
      (!attr.name || attr.argument)
    ) {
      attr.state = ATTR_STATE.BLOCK;
      this.enterState(STATE.EXPRESSION, {
        terminator: "}",
        skipOperators: true,
      });
    } else if (!attr.name) {
      attr.state = ATTR_STATE.NAME;
      this.rewind(1);
      this.enterState(STATE.EXPRESSION, {
        terminatedByWhitespace: true,
        skipOperators: true,
        allowEscapes: true,
        terminator: [
          this.isConcise ? "]" : "/>",
          this.isConcise ? ";" : ">",
          ":=",
          "=",
          ",",
          "(",
        ]
      });
    } else {
      this.exitState();
    }
  },
};
