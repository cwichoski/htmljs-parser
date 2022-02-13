import {
  CODE,
  STATE,
  isWhitespaceCode,
  StateDefinition,
  Part,
  ExpressionPos,
  TemplatePos,
  TemplatePart,
} from "../internal";

const enum TAG_STATE {
  VAR,
  ARGUMENT,
  PARAMS,
}

export interface OpenTagPart extends Part {
  type: "tag";
  state: TAG_STATE | undefined;
  concise: boolean;
  beginMixedMode?: boolean;
  tagName: TemplatePos;
  selfClosed: boolean;
  openTagOnly: boolean;
  shorthandId?: TemplatePos;
  shorthandClassNames?: TemplatePos[];
  var?: ExpressionPos;
  params?: ExpressionPos;
  argument?: ExpressionPos;
  attributes: STATE.AttrPart[];
  indent: string;
  nestedIndent?: string;
}

export const OPEN_TAG: StateDefinition<OpenTagPart> = {
  name: "OPEN_TAG",

  enter(tag) {
    tag.type = "tag";
    tag.state = undefined;
    tag.attributes = [];
    tag.argument = undefined;
    tag.params = undefined;
    tag.var = undefined;
    tag.indent = this.indent;
    tag.concise = this.isConcise;
    tag.beginMixedMode = this.beginMixedMode || this.endingMixedModeAtEOL;
    tag.selfClosed = false;
    tag.openTagOnly = false;
    tag.shorthandId = undefined;
    tag.shorthandClassNames = undefined;

    this.beginMixedMode = false;
    this.endingMixedModeAtEOL = false;
    this.currentOpenTag = tag;
    this.blockStack.push(tag);
  },

  exit(tag) {
    const tagName = tag.tagName;
    const selfClosed = tag.selfClosed;
    const literalTagNamePos =
      tagName.quasis.length === 1 ? tagName.quasis[0] : undefined;
    const literalTagName = literalTagNamePos && this.read(literalTagNamePos); // TODO: avoid read
    const openTagOnly = (tag.openTagOnly = literalTagName
      ? this.isOpenTagOnly(literalTagName)
      : false);
    this.notifiers.notifyOpenTag(tag);

    if (!this.isConcise && (selfClosed || openTagOnly)) {
      this.closeTag();
    } else {
      switch (literalTagName) {
        case "script":
          this.enterJsContentState();
          break;
        case "style":
          this.enterCssContentState();
          break;
      }
    }

    this.currentOpenTag = undefined;
  },

  return(childState, childPart, tag) {
    switch (childState) {
      case STATE.TAG_NAME: {
        tag.tagName = childPart as TemplatePart;
        this.notifiers.notifyOpenTagName(tag);
        break;
      }
      case STATE.JS_COMMENT_BLOCK: {
        /* Ignore comments within an open tag */
        break;
      }
      case STATE.EXPRESSION: {
        switch (tag.state) {
          case TAG_STATE.VAR: {
            if (childPart.pos === childPart.endPos) {
              return this.notifyError(
                childPart,
                "MISSING_TAG_VARIABLE",
                "A slash was found that was not followed by a variable name or lhs expression"
              );
            }
            tag.var = {
              pos: childPart.pos - 1, // include /,
              endPos: childPart.endPos,
              value: {
                pos: childPart.pos,
                endPos: childPart.endPos,
              },
            };
            break;
          }
          case TAG_STATE.ARGUMENT: {
            const argPos = {
              pos: childPart.pos - 1, // include (
              endPos: this.skip(1), // include )
              value: {
                pos: childPart.pos,
                endPos: childPart.endPos,
              },
            };

            if (this.lookPastWhitespaceFor("{")) {
              this.consumeWhitespace();
              const attr = this.enterState(STATE.ATTRIBUTE);
              attr.argument = argPos;
              attr.pos = attr.argument!.pos;
              tag.attributes.push(attr);
              this.rewind(1);
            } else {
              tag.argument = argPos;
            }
            break;
          }
          case TAG_STATE.PARAMS: {
            tag.params = {
              pos: childPart.pos - 1, // include leading |
              endPos: this.skip(1), // include closing |
              value: {
                pos: childPart.pos,
                endPos: childPart.endPos,
              },
            };
            break;
          }
        }
        break;
      }
    }
  },

  eol(linebreak) {
    if (this.isConcise && !this.withinAttrGroup) {
      // In concise mode we always end the open tag
      this.exitState();
      this.skip(linebreak.length);
    }
  },

  eof(tag) {
    if (this.isConcise) {
      if (this.withinAttrGroup) {
        this.notifyError(
          tag,
          "MALFORMED_OPEN_TAG",
          'EOF reached while within an attribute group (e.g. "[ ... ]").'
        );
        return;
      }

      // If we reach EOF inside an open tag when in concise-mode
      // then we just end the tag and all other open tags on the stack
      this.exitState();
    } else {
      // Otherwise, in non-concise mode we consider this malformed input
      // since the end '>' was not found.
      this.notifyError(
        tag,
        "MALFORMED_OPEN_TAG",
        "EOF reached while parsing open tag"
      );
    }
  },

  char(_, code, tag) {
    if (this.isConcise) {
      if (code === CODE.SEMICOLON) {
        this.exitState(";");
        if (!this.consumeWhitespaceOnLine(0)) {
          switch (this.lookAtCharCodeAhead(0)) {
            case CODE.FORWARD_SLASH:
              if (this.lookAheadFor("/")) {
                this.enterState(STATE.JS_COMMENT_LINE);
                this.skip(2);
                return;
              } else if (this.lookAheadFor("*")) {
                this.enterState(STATE.JS_COMMENT_BLOCK);
                this.skip(2);
                return;
              }
              break;
            case CODE.OPEN_ANGLE_BRACKET:
              if (this.lookAheadFor("!--")) {
                // html comment
                this.enterState(STATE.HTML_COMMENT);
                this.skip(4);
                return;
              }
              break;
          }

          this.notifyError(
            this.pos,
            "INVALID_CODE_AFTER_SEMICOLON",
            "A semicolon indicates the end of a line. Only comments may follow it."
          );
        }

        return;
      }

      if (code === CODE.HTML_BLOCK_DELIMITER) {
        if (this.lookAtCharCodeAhead(1) !== CODE.HTML_BLOCK_DELIMITER) {
          this.notifyError(
            tag,
            "MALFORMED_OPEN_TAG",
            '"-" not allowed as first character of attribute name'
          );
          return;
        }

        if (this.withinAttrGroup) {
          this.notifyError(
            this.pos,
            "MALFORMED_OPEN_TAG",
            "Attribute group was not properly ended"
          );
          return;
        }

        // The open tag is complete
        this.exitState();

        this.htmlBlockDelimiter = "";
        const indentMatch = /[^\n]*\n(\s+)/.exec(this.substring(this.pos));
        if (indentMatch) {
          const whitespace = indentMatch[1].split(/\n/g);
          const nextIndent = whitespace[whitespace.length - 1];
          if (nextIndent > this.indent) {
            this.indent = nextIndent;
          }
        }

        this.enterState(STATE.BEGIN_DELIMITED_HTML_BLOCK);
        return;
      } else if (code === CODE.OPEN_SQUARE_BRACKET) {
        if (this.withinAttrGroup) {
          this.notifyError(
            this.pos,
            "MALFORMED_OPEN_TAG",
            'Unexpected "[" character within open tag.'
          );
          return;
        }

        this.withinAttrGroup = true;
        return;
      } else if (code === CODE.CLOSE_SQUARE_BRACKET) {
        if (!this.withinAttrGroup) {
          this.notifyError(
            this.pos,
            "MALFORMED_OPEN_TAG",
            'Unexpected "]" character within open tag.'
          );
          return;
        }

        this.withinAttrGroup = false;
        return;
      }
    } else {
      if (code === CODE.CLOSE_ANGLE_BRACKET) {
        this.exitState(">");
        return;
      } else if (code === CODE.FORWARD_SLASH) {
        if (this.lookAtCharCodeAhead(1) === CODE.CLOSE_ANGLE_BRACKET) {
          tag.selfClosed = true;
          this.exitState("/>");
          return;
        }
      }
    }

    if (code === CODE.OPEN_ANGLE_BRACKET) {
      return this.notifyError(
        this.pos,
        "ILLEGAL_ATTRIBUTE_NAME",
        'Invalid attribute name. Attribute name cannot begin with the "<" character.'
      );
    }

    if (
      code === CODE.FORWARD_SLASH &&
      this.lookAtCharCodeAhead(1) === CODE.ASTERISK
    ) {
      // Skip over code inside a JavaScript block comment
      this.enterState(STATE.JS_COMMENT_BLOCK);
      this.skip(1);
      return;
    }

    if (isWhitespaceCode(code)) {
      // ignore whitespace within element...
    } else if (code === CODE.COMMA) {
      this.skip(1);
      this.consumeWhitespace();
      this.rewind(1);
    } else if (code === CODE.FORWARD_SLASH && !tag.attributes.length) {
      tag.state = TAG_STATE.VAR;
      this.skip(1); // skip /
      this.enterState(STATE.EXPRESSION, {
        skipOperators: true,
        terminatedByWhitespace: true,
        terminator: this.isConcise
          ? [";", "(", "|", "=", ":="]
          : [">", "/>", "(", "|", "=", ":="],
      });
      this.rewind(1);
    } else if (code === CODE.OPEN_PAREN && !tag.attributes.length) {
      if (tag.argument != null) {
        this.notifyError(
          this.pos,
          "ILLEGAL_TAG_ARGUMENT",
          "A tag can only have one argument"
        );
        return;
      }
      tag.state = TAG_STATE.ARGUMENT;
      this.skip(1); // skip (
      this.enterState(STATE.EXPRESSION, {
        skipOperators: true,
        terminator: ")",
      });
      this.rewind(1);
    } else if (code === CODE.PIPE && !tag.attributes.length) {
      tag.state = TAG_STATE.PARAMS;
      this.skip(1); // skip |
      this.enterState(STATE.EXPRESSION, {
        skipOperators: true,
        terminator: "|",
      });
      this.rewind(1);
    } else {
      if (tag.tagName) {
        tag.attributes.push(this.enterState(STATE.ATTRIBUTE));
      } else {
        this.enterState(STATE.TAG_NAME);
      }

      this.rewind(1);
    }
  },
};
